import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import type { EnvironmentVariables } from '../../../config/env.validation';
import { AdminAction } from '../../admin-actions/admin-action.entity';
import {
  Event,
  EventApprovalStatus,
  EventCampaignStatus,
  EventListStatus,
  EventPaymentStatus,
  EventStatus,
} from '../../events/entities/event.entity';
import {
  GuestAllocationStatus,
  GuestKind,
} from '../../guests/entities/guest.entity';
import { InvitationContent } from '../entities/invitation-content.entity';
import {
  WhatsappMessageKind,
  WhatsappMessageState,
} from '../entities/whatsapp-message.entity';

/**
 * Campaign lifecycle around the sender (SP-04 §4 Sending). The intents are the queue: this service
 * creates them when a campaign is due and closes the campaign when none are left; the sweeper
 * sends them in chunks through `WhatsappSenderService`, which re-checks every precondition after
 * the claim. System transitions are audited with a null actor.
 */
@Injectable()
export class CampaignSenderService {
  private readonly logger = new Logger(CampaignSenderService.name);
  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  /**
   * AC-06-5: nothing goes out once the event has started, even after an outage. Queued intents of
   * started events are cancelled; a campaign that never started is cancelled.
   */
  async cancelStarted(): Promise<{ intents: number; campaigns: number }> {
    const intents = await this.dataSource.query<[unknown[], number]>(
      `UPDATE whatsapp_messages m
          SET state = $1, last_error_code = 'event_started', updated_at = now()
         FROM events e
        WHERE m.event_id = e.id AND m.state = $2 AND e.starts_at <= now()`,
      [WhatsappMessageState.CANCELLED, WhatsappMessageState.QUEUED],
    );
    const campaigns = await this.dataSource.query<[{ id: string }[], number]>(
      `UPDATE events
          SET campaign_status = $1, schedule_version = schedule_version + 1, updated_at = now()
        WHERE campaign_status = $2 AND starts_at <= now()
        RETURNING id`,
      [EventCampaignStatus.CANCELLED, EventCampaignStatus.SCHEDULED],
    );
    for (const { id } of campaigns[0]) {
      this.logger.warn(`Campaign ${id} cancelled: the event started first`);
      await this.dataSource.manager.save(AdminAction, {
        actorUserId: null,
        action: 'campaign.cancel_overdue',
        targetType: 'event',
        targetId: id,
        summary: {},
      });
    }
    return { intents: intents[1], campaigns: campaigns[0].length };
  }

  /** Starts every due campaign; returns how many started. */
  async startDue(): Promise<number> {
    const due = await this.dataSource.query<{ id: string }[]>(
      `SELECT id FROM events
        WHERE campaign_status = $1 AND send_at <= now() AND starts_at > now()
        ORDER BY send_at`,
      [EventCampaignStatus.SCHEDULED],
    );
    let started = 0;
    for (const { id } of due) {
      try {
        if (await this.start(id)) started++;
      } catch (error) {
        this.logger.error(
          `Campaign ${id} failed to start: ${(error as Error).name}`,
        );
      }
    }
    return started;
  }

  /** `SENDING` with no invitation left to send → `SENT`. */
  async completeFinished(): Promise<number> {
    const done = await this.dataSource.query<[{ id: string }[], number]>(
      `UPDATE events e
          SET campaign_status = $1, updated_at = now()
        WHERE e.campaign_status = $2
          AND NOT EXISTS (
            SELECT 1 FROM whatsapp_messages m
             WHERE m.event_id = e.id AND m.kind = $3 AND m.state IN ($4, $5))
        RETURNING e.id`,
      [
        EventCampaignStatus.SENT,
        EventCampaignStatus.SENDING,
        WhatsappMessageKind.INVITATION,
        WhatsappMessageState.QUEUED,
        WhatsappMessageState.SENDING,
      ],
    );
    for (const { id } of done[0]) this.logger.log(`Campaign ${id} sent`);
    return done[0].length;
  }

  /**
   * Under the event lock: re-check eligibility, allocate the initial guests, create one invitation
   * intent per guest (the logical key makes this idempotent, and a guest already invited with this
   * version, e.g. by the tracer, is not invited again), then `SENDING`.
   */
  private start(eventId: string): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const event = await manager.findOne(Event, {
        where: { id: eventId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!event || event.campaignStatus !== EventCampaignStatus.SCHEDULED)
        return false;
      if (!event.sendAt || event.sendAt > new Date()) return false;
      if (event.startsAt <= new Date()) return false; // cancelStarted() handles it
      const reason = this.ineligible(event);
      if (reason) {
        // Stays SCHEDULED and visible as overdue (operations.md) until an admin acts.
        this.logger.warn(`Campaign ${event.id} not started: ${reason}`);
        return false;
      }
      const content = await manager.findOneByOrFail(InvitationContent, {
        id: event.approvedContentId!,
      });

      await manager.query(
        `UPDATE guests SET allocation_status = $2, allocated_at = now(), updated_at = now()
          WHERE event_id = $1 AND kind = $3 AND deleted_at IS NULL AND allocation_status = $4`,
        [
          event.id,
          GuestAllocationStatus.ALLOCATED,
          GuestKind.INITIAL,
          GuestAllocationStatus.NOT_ALLOCATED,
        ],
      );
      const created = await manager.query<{ id: string }[]>(
        `INSERT INTO whatsapp_messages (event_id, guest_id, kind, logical_key, schedule_version)
         SELECT g.event_id, g.id, $2, 'invitation:' || g.id || ':' || $3::int, $4
           FROM guests g
          WHERE g.event_id = $1 AND g.kind = $5 AND g.deleted_at IS NULL AND g.phone IS NOT NULL
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [
          event.id,
          WhatsappMessageKind.INVITATION,
          content.version,
          event.scheduleVersion,
          GuestKind.INITIAL,
        ],
      );
      await manager.update(
        Event,
        { id: event.id },
        { campaignStatus: EventCampaignStatus.SENDING },
      );
      await audit(manager, event.id, 'campaign.start', {
        scheduleVersion: event.scheduleVersion,
        contentVersion: content.version,
        intents: created.length,
      });
      this.logger.log(
        `Campaign ${event.id} started: ${created.length} invitations queued`,
      );
      return true;
    });
  }

  private ineligible(event: Event): string | null {
    if (
      event.status === EventStatus.CANCELLED ||
      event.status === EventStatus.CLOSED
    )
      return 'event_closed';
    if (event.paymentStatus !== EventPaymentStatus.PAID) return 'not_paid';
    if (event.listStatus !== EventListStatus.READY) return 'list_not_ready';
    // An admin correction can reset approval without unscheduling (T-P3-07).
    if (
      event.approvalStatus !== EventApprovalStatus.APPROVED ||
      !event.approvedContentId
    )
      return 'not_approved';
    if (
      this.config.get('WHATSAPP_INVITATION_TEMPLATE_STATUS', {
        infer: true,
      }) !== 'APPROVED'
    )
      return 'template_not_approved';
    return null;
  }
}

const audit = (
  manager: EntityManager,
  eventId: string,
  action: string,
  summary: Record<string, unknown>,
) =>
  manager.save(AdminAction, {
    actorUserId: null,
    action,
    targetType: 'event',
    targetId: eventId,
    summary,
  });
