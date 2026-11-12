import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import type { EnvironmentVariables } from '../../config/env.validation';
import {
  conflict,
  notFound,
  unprocessable,
} from '../../shared/exceptions/app.exception';
import { AdminAction } from '../admin-actions/admin-action.entity';
import {
  Event,
  EventApprovalStatus,
  EventCampaignStatus,
  EventListStatus,
  EventPaymentStatus,
  EventStatus,
} from '../events/entities/event.entity';
import {
  AdminInvitationView,
  CampaignPreconditions,
  CreateInvitationDto,
  OwnerInvitationView,
  toContentView,
} from './dto/invitation.dto';
import {
  InvitationContent,
  InvitationVariables,
} from './entities/invitation-content.entity';
import {
  contentHash,
  INVITATION_BODY,
  INVITATION_BUTTONS,
  renderInvitation,
  suggestVariables,
  TEMPLATE_LANGUAGE,
} from './invitation-template';

/** Sending is scheduled, running or finished: content and schedule changes stop here. */
const STARTED = [
  EventCampaignStatus.SENDING,
  EventCampaignStatus.PAUSED,
  EventCampaignStatus.SENT,
];

/** One line, at most one space in a row (Meta refuses new lines, tabs and space runs). */
const cleanVariable = (value: string): string => {
  const text = value.trim();
  if (text.length < 2 || text.length > 120 || /[\n\r\t]| {2}/.test(text))
    throw unprocessable('invitation.variable_invalid');
  return text;
};

/**
 * Invitation versions, approval (D-15) and scheduling (SP-04). The owner approves an exact
 * version; an admin may approve instead with a recorded reason (OQ-02, owner 2026-11-07).
 * Every write holds the event row lock.
 */
@Injectable()
export class InvitationsService {
  constructor(
    @InjectRepository(Event) private readonly events: Repository<Event>,
    @InjectRepository(InvitationContent)
    private readonly contents: Repository<InvitationContent>,
    private readonly dataSource: DataSource,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  private get templateName(): string {
    return this.config.get('WHATSAPP_INVITATION_TEMPLATE', { infer: true });
  }

  /** Read per call: it changes when Meta approves the template (env today, webhook later). */
  private get templateStatus(): 'PENDING' | 'APPROVED' | 'REJECTED' {
    return this.config.get('WHATSAPP_INVITATION_TEMPLATE_STATUS', {
      infer: true,
    });
  }

  async adminView(eventId: string): Promise<AdminInvitationView> {
    const event = await this.events.findOneBy({ id: eventId });
    if (!event) throw notFound();
    const [latest, versions] = await Promise.all([
      this.latest(this.dataSource.manager, eventId),
      this.contents.countBy({ eventId }),
    ]);
    return {
      template: {
        name: this.templateName,
        status: this.templateStatus,
        body: INVITATION_BODY,
        buttons: INVITATION_BUTTONS,
      },
      content: latest
        ? toContentView(latest, INVITATION_BUTTONS, event.ownerId)
        : null,
      versions,
      suggested: suggestVariables(event),
      preconditions: this.preconditions(event),
    };
  }

  async ownerView(
    ownerId: string,
    eventId: string,
  ): Promise<OwnerInvitationView> {
    const event = await this.events.findOneBy({ id: eventId, ownerId });
    if (!event) throw notFound();
    const latest = await this.latest(this.dataSource.manager, eventId);
    return {
      content: latest
        ? toContentView(latest, INVITATION_BUTTONS, ownerId)
        : null,
      approvable:
        !!latest &&
        event.approvalStatus === EventApprovalStatus.AWAITING_OWNER &&
        !isClosed(event),
    };
  }

  /** A new version unless the text is unchanged. Resets approval (D-15). */
  async createVersion(
    actorUserId: string,
    eventId: string,
    dto: CreateInvitationDto,
  ): Promise<void> {
    const variables: InvitationVariables = {
      eventName: cleanVariable(dto.eventName),
      dateText: cleanVariable(dto.dateText),
      venue: cleanVariable(dto.venue),
    };
    await this.dataSource.transaction(async (manager) => {
      const event = await lockEvent(manager, eventId);
      if (isClosed(event)) throw conflict('events.closed');
      if (event.paymentStatus !== EventPaymentStatus.PAID)
        throw unprocessable('campaign.not_paid');
      if (
        event.campaignStatus === EventCampaignStatus.SCHEDULED ||
        STARTED.includes(event.campaignStatus)
      )
        throw conflict('invitation.locked');

      const hash = contentHash(this.templateName, variables);
      const latest = await this.latest(manager, eventId);
      if (latest?.contentHash === hash) return;

      const content = await manager.save(
        manager.create(InvitationContent, {
          eventId,
          version: (latest?.version ?? 0) + 1,
          templateName: this.templateName,
          templateLanguage: TEMPLATE_LANGUAGE,
          variables,
          renderedPreview: renderInvitation(variables),
          contentHash: hash,
          createdByUserId: actorUserId,
        }),
      );
      await manager.update(
        Event,
        { id: eventId },
        {
          approvalStatus: EventApprovalStatus.AWAITING_OWNER,
          approvedContentId: null,
        },
      );
      await audit(manager, actorUserId, 'invitation.version', eventId, {
        contentId: content.id,
        version: content.version,
      });
    });
  }

  /** The owner approves the exact version they saw (`contentHash`). Idempotent. */
  async approve(
    ownerId: string,
    eventId: string,
    contentId: string,
    hash: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const event = await lockEvent(manager, eventId);
      if (event.ownerId !== ownerId) throw notFound();
      await this.approveLatest(manager, event, contentId, hash, ownerId, null);
    });
  }

  /** Admin approval without the owner, with a reason kept on the version and in the log. */
  async override(
    actorUserId: string,
    eventId: string,
    contentId: string,
    reason: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const event = await lockEvent(manager, eventId);
      const latest = await this.latest(manager, eventId);
      await this.approveLatest(
        manager,
        event,
        contentId,
        latest?.id === contentId ? latest.contentHash : '',
        actorUserId,
        reason,
      );
      await audit(manager, actorUserId, 'invitation.override', eventId, {
        contentId,
        reason,
      });
    });
  }

  /** SP-04 preconditions, then `SCHEDULED` with a new schedule version. Rescheduling is allowed. */
  async schedule(
    actorUserId: string,
    eventId: string,
    sendAt: Date,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const event = await lockEvent(manager, eventId);
      if (isClosed(event)) throw conflict('events.closed');
      if (STARTED.includes(event.campaignStatus))
        throw conflict('campaign.already_started');
      const checks = this.preconditions(event);
      if (!checks.paid) throw unprocessable('campaign.not_paid');
      if (!checks.listReady) throw unprocessable('campaign.list_not_ready');
      if (!checks.approved) throw unprocessable('campaign.not_approved');
      if (!checks.templateApproved)
        throw unprocessable('campaign.template_not_approved');
      if (sendAt.getTime() <= Date.now())
        throw unprocessable('events.send_in_past');
      if (sendAt.getTime() >= event.startsAt.getTime())
        throw unprocessable('campaign.send_after_event');

      await manager.update(
        Event,
        { id: eventId },
        {
          campaignStatus: EventCampaignStatus.SCHEDULED,
          sendAt,
          scheduleVersion: event.scheduleVersion + 1,
        },
      );
      await audit(manager, actorUserId, 'campaign.schedule', eventId, {
        sendAt: sendAt.toISOString(),
        previous: event.sendAt?.toISOString() ?? null,
        scheduleVersion: event.scheduleVersion + 1,
      });
    });
  }

  /** Back to "approved, not scheduled" before sending starts; reopens content and list edits. */
  async unschedule(
    actorUserId: string,
    eventId: string,
    reason: string | undefined,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const event = await lockEvent(manager, eventId);
      if (STARTED.includes(event.campaignStatus))
        throw conflict('campaign.already_started');
      if (event.campaignStatus !== EventCampaignStatus.SCHEDULED)
        throw conflict('campaign.not_scheduled');
      await manager.update(
        Event,
        { id: eventId },
        {
          campaignStatus: EventCampaignStatus.NOT_SCHEDULED,
          sendAt: null,
          scheduleVersion: event.scheduleVersion + 1,
        },
      );
      await audit(manager, actorUserId, 'campaign.unschedule', eventId, {
        reason: reason || null,
        scheduleVersion: event.scheduleVersion + 1,
      });
    });
  }

  /**
   * `SENDING` → `PAUSED`. Queued invitations stay queued and are skipped by the sender until
   * resume; at most the message already in flight goes out. `schedule_version` is left alone on
   * purpose: it invalidates intents, and a pause must keep them (SP-04 §4 Sending).
   */
  async pause(
    actorUserId: string,
    eventId: string,
    reason: string | undefined,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const event = await lockEvent(manager, eventId);
      if (event.campaignStatus !== EventCampaignStatus.SENDING)
        throw conflict('campaign.not_sending');
      await manager.update(
        Event,
        { id: eventId },
        { campaignStatus: EventCampaignStatus.PAUSED },
      );
      await audit(manager, actorUserId, 'campaign.pause', eventId, {
        reason: reason || null,
        queued: await queuedInvitations(manager, eventId),
      });
    });
  }

  /** `PAUSED` → `SENDING`; refused once the event is closed or has started (AC-06-5). */
  async resume(actorUserId: string, eventId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const event = await lockEvent(manager, eventId);
      if (event.campaignStatus !== EventCampaignStatus.PAUSED)
        throw conflict('campaign.not_paused');
      if (isClosed(event)) throw conflict('events.closed');
      if (event.startsAt.getTime() <= Date.now())
        throw conflict('campaign.event_started');
      await manager.update(
        Event,
        { id: eventId },
        { campaignStatus: EventCampaignStatus.SENDING },
      );
      await audit(manager, actorUserId, 'campaign.resume', eventId, {
        queued: await queuedInvitations(manager, eventId),
      });
    });
  }

  private preconditions(event: Event): CampaignPreconditions {
    return {
      paid: event.paymentStatus === EventPaymentStatus.PAID,
      listReady: event.listStatus === EventListStatus.READY,
      approved:
        event.approvalStatus === EventApprovalStatus.APPROVED &&
        !!event.approvedContentId,
      templateApproved: this.templateStatus === 'APPROVED',
    };
  }

  private latest(manager: EntityManager, eventId: string) {
    return manager.findOne(InvitationContent, {
      where: { eventId },
      order: { version: 'DESC' },
    });
  }

  private async approveLatest(
    manager: EntityManager,
    event: Event,
    contentId: string,
    hash: string,
    approverId: string,
    overrideReason: string | null,
  ): Promise<void> {
    if (isClosed(event)) throw conflict('events.closed');
    const latest = await this.latest(manager, event.id);
    if (!latest) throw notFound('invitation.missing');
    if (latest.id !== contentId || latest.contentHash !== hash)
      throw conflict('invitation.version_outdated');
    if (
      event.approvalStatus === EventApprovalStatus.APPROVED &&
      event.approvedContentId === latest.id
    )
      return;
    await manager.update(
      InvitationContent,
      { id: latest.id },
      {
        approvedAt: new Date(),
        approvedByUserId: approverId,
        overrideReason,
      },
    );
    await manager.update(
      Event,
      { id: event.id },
      {
        approvalStatus: EventApprovalStatus.APPROVED,
        approvedContentId: latest.id,
      },
    );
  }
}

const isClosed = (event: Event) =>
  event.status === EventStatus.CANCELLED || event.status === EventStatus.CLOSED;

async function lockEvent(
  manager: EntityManager,
  eventId: string,
): Promise<Event> {
  const event = await manager.findOne(Event, {
    where: { id: eventId },
    lock: { mode: 'pessimistic_write' },
  });
  if (!event) throw notFound();
  return event;
}

async function queuedInvitations(
  manager: EntityManager,
  eventId: string,
): Promise<number> {
  const [row] = await manager.query<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM whatsapp_messages
      WHERE event_id = $1 AND kind = 'INVITATION' AND state = 'QUEUED'`,
    [eventId],
  );
  return row.n;
}

const audit = (
  manager: EntityManager,
  actorUserId: string,
  action: string,
  eventId: string,
  summary: Record<string, unknown>,
) =>
  manager.save(AdminAction, {
    actorUserId,
    action,
    targetType: 'event',
    targetId: eventId,
    summary,
  });
