import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import type { EnvironmentVariables } from '../../../config/env.validation';
import {
  Event,
  EventCampaignStatus,
  EventPaymentStatus,
  EventStatus,
} from '../../events/entities/event.entity';
import {
  GuestAllocationStatus,
  GuestRsvp,
} from '../../guests/entities/guest.entity';
import {
  JourneyKind,
  WhatsappDeliveryStatus,
  WhatsappMessageKind,
  WhatsappMessageState,
} from '../entities/whatsapp-message.entity';
import { JourneyTemplatesService } from './journey-templates.service';
import { isJourney, journeyTimeline, JourneyStep } from './journey-schedule';

export const journeyKey = (
  kind: JourneyKind,
  guestId: string,
  scheduleVersion: number,
) => `${kind.toLowerCase()}:${guestId}:${scheduleVersion}`;

/** Campaigns whose journey runs: the invitations went (or are going) out. */
const RUNNING = [EventCampaignStatus.SENDING, EventCampaignStatus.SENT];
/** The thank-you is created the day after; look a little further back than that. */
const LOOKBACK_DAYS = 3;

/**
 * Creates the guest journey's messages when they fall due (SP-07). One pass per sweep: for every
 * running journey, each step whose due time passed less than `JOURNEY_MISSED_GRACE_MINUTES` ago
 * gets one intent per eligible guest (`ON CONFLICT DO NOTHING` on the logical key, so passes and
 * processes never double it). A step found later is never created (rule 1, no retroactive sends).
 * The sender re-checks every intent after the claim.
 */
@Injectable()
export class JourneyService {
  private readonly logger = new Logger(JourneyService.name);
  private readonly graceMs: number;

  constructor(
    private readonly dataSource: DataSource,
    private readonly templates: JourneyTemplatesService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.graceMs =
      config.get('JOURNEY_MISSED_GRACE_MINUTES', { infer: true }) * 60_000;
  }

  async createDue(now = new Date()): Promise<number> {
    const events = await this.dataSource
      .getRepository(Event)
      .createQueryBuilder('e')
      .where('e.journey IS NOT NULL AND e.sendAt IS NOT NULL')
      .andWhere('e.campaignStatus IN (:...running)', { running: RUNNING })
      .andWhere('e.status NOT IN (:...closed)', {
        closed: [EventStatus.CANCELLED, EventStatus.CLOSED],
      })
      .andWhere('e.paymentStatus = :paid', { paid: EventPaymentStatus.PAID })
      .andWhere(`e.startsAt > :since`, {
        since: new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000),
      })
      .getMany();

    let created = 0;
    for (const event of events) {
      try {
        created += await this.createForEvent(event, now);
      } catch (error) {
        this.logger.error(
          `Journey of event ${event.id} failed: ${(error as Error).name}`,
        );
      }
    }
    return created;
  }

  private async createForEvent(event: Event, now: Date): Promise<number> {
    if (!isJourney(event.journey) || !event.sendAt) return 0;
    const timeline = journeyTimeline({
      journey: event.journey,
      startsAt: event.startsAt,
      timeZone: event.timezone,
      sendAt: event.sendAt,
    });
    let created = 0;
    for (const step of Object.keys(timeline) as JourneyStep[]) {
      const dueAt = timeline[step];
      if (dueAt > now || now.getTime() - dueAt.getTime() > this.graceMs)
        continue;
      const kind: JourneyKind = WhatsappMessageKind[step];
      if (step !== 'THANK_YOU' && dueAt >= event.startsAt) continue;
      if (
        (step === 'FOLLOW_UP_1' || step === 'FOLLOW_UP_2') &&
        event.rsvpClosesAt &&
        dueAt >= event.rsvpClosesAt
      )
        continue;
      if (!(await this.templates.isApproved(kind))) continue;
      created += await this.insert(event, kind, dueAt);
    }
    if (created)
      this.logger.log(`Journey of event ${event.id}: ${created} messages due`);
    return created;
  }

  /** One intent per eligible guest; the same rules as `journeySkipReason`, in SQL. */
  private async insert(
    event: Event,
    kind: JourneyKind,
    dueAt: Date,
  ): Promise<number> {
    const params: unknown[] = [
      event.id,
      kind,
      kind.toLowerCase(),
      event.scheduleVersion,
      dueAt,
    ];
    let eligible: string;
    if (
      kind === WhatsappMessageKind.FOLLOW_UP_1 ||
      kind === WhatsappMessageKind.FOLLOW_UP_2
    ) {
      params.push(
        GuestRsvp.PENDING,
        GuestAllocationStatus.ALLOCATED,
        WhatsappMessageKind.INVITATION,
        WhatsappMessageState.SENT,
        WhatsappDeliveryStatus.FAILED,
      );
      eligible = `g.rsvp = $6 AND g.allocation_status = $7
        AND EXISTS (SELECT 1 FROM whatsapp_messages i
                     WHERE i.guest_id = g.id AND i.kind = $8 AND i.state = $9
                       AND i.delivery_status <> $10
                       AND i.sent_at <= $5::timestamptz - interval '24 hours')`;
    } else if (kind === WhatsappMessageKind.THANK_YOU) {
      eligible = `g.checked_in_at IS NOT NULL`;
    } else {
      params.push(GuestRsvp.ACCEPTED);
      eligible = `g.rsvp = $6 AND g.qr_token_hash IS NOT NULL
        AND g.rsvp_at <= $5::timestamptz - interval '24 hours'`;
    }
    const rows = await this.dataSource.query<{ id: string }[]>(
      `INSERT INTO whatsapp_messages (event_id, guest_id, kind, logical_key, schedule_version, scheduled_for)
       SELECT g.event_id, g.id, $2, $3 || ':' || g.id || ':' || $4::int, $4, $5
         FROM guests g
        WHERE g.event_id = $1 AND g.deleted_at IS NULL AND g.phone IS NOT NULL AND ${eligible}
       ON CONFLICT DO NOTHING
       RETURNING id`,
      params,
    );
    return rows.length;
  }
}
