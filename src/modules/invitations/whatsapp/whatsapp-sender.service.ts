import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { EnvironmentVariables } from '../../../config/env.validation';
import {
  hashQrToken,
  newQrToken,
  qrUrl,
  renderQrPng,
} from '../../checkin/qr-token';
import {
  Event,
  EventCampaignStatus,
  EventPaymentStatus,
  EventStatus,
} from '../../events/entities/event.entity';
import { Guest, GuestRsvp } from '../../guests/entities/guest.entity';
import { InvitationContent } from '../entities/invitation-content.entity';
import {
  WhatsappDeliveryStatus,
  WhatsappMessage,
  WhatsappMessageKind,
  WhatsappMessageState,
} from '../entities/whatsapp-message.entity';
import { SendOutcome, WhatsappClient } from './whatsapp.client';

export const RSVP_ACCEPT = 'RSVP_ACCEPT';
export const RSVP_DECLINE = 'RSVP_DECLINE';

const MAX_ATTEMPTS = 3;
/** Meta's customer-service window is 24 h from the guest's reply; keep a margin. */
const WINDOW_MS = 23 * 60 * 60 * 1000;

/** `HOLD`: the campaign was paused after the claim; the intent goes back to the queue untouched. */
type Prepared =
  SendOutcome | { outcome: 'CANCELLED'; code: string } | { outcome: 'HOLD' };

export class TracerError extends Error {}

export const invitationKey = (guestId: string, contentVersion: number) =>
  `invitation:${guestId}:${contentVersion}`;
export const qrKey = (guestId: string, qrVersion: number) =>
  `qr:${guestId}:${qrVersion}`;

/**
 * Sends one intent at a time. Claims are conditional updates (`QUEUED` → `SENDING`), so two workers
 * or a sweeper and an inline kick never send the same row twice. Every precondition is re-checked
 * after the claim; nothing is sent once the event has started.
 */
@Injectable()
export class WhatsappSenderService {
  private readonly logger = new Logger(WhatsappSenderService.name);
  private readonly appOrigin: string;
  private readonly dailyLimit: number;
  private limitWarnedAt = 0;

  constructor(
    @InjectRepository(WhatsappMessage)
    private readonly messages: Repository<WhatsappMessage>,
    @InjectRepository(Guest) private readonly guests: Repository<Guest>,
    @InjectRepository(Event) private readonly events: Repository<Event>,
    @InjectRepository(InvitationContent)
    private readonly contents: Repository<InvitationContent>,
    private readonly client: WhatsappClient,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.appOrigin = config.get('APP_ORIGIN', { infer: true });
    this.dailyLimit = config.get('WHATSAPP_DAILY_INVITATION_LIMIT', {
      infer: true,
    });
  }

  /**
   * P1 tracer (integrations.md step 1): the approved invitation to one guest, outside any
   * campaign. CLI only. Returns the intent and its state after the attempt.
   */
  async sendTracerInvitation(
    guestId: string,
  ): Promise<{ intentId: string; state: WhatsappMessageState }> {
    const guest = await this.guests.findOneBy({ id: guestId });
    if (!guest || guest.deletedAt || !guest.phone)
      throw new TracerError('Guest not found');
    const event = await this.events.findOneByOrFail({ id: guest.eventId });
    if (event.startsAt <= new Date())
      throw new TracerError('The event has already started');
    if (!event.approvedContentId)
      throw new TracerError('The event has no approved invitation');
    const content = await this.contents.findOneByOrFail({
      id: event.approvedContentId,
    });

    await this.messages
      .createQueryBuilder()
      .insert()
      .values({
        eventId: event.id,
        guestId: guest.id,
        kind: WhatsappMessageKind.INVITATION,
        logicalKey: invitationKey(guest.id, content.version),
        scheduleVersion: event.scheduleVersion,
      })
      .orIgnore()
      .execute();
    const intent = await this.messages.findOneByOrFail({
      logicalKey: invitationKey(guest.id, content.version),
    });
    await this.process(intent.id);
    const after = await this.messages.findOneByOrFail({ id: intent.id });
    return { intentId: after.id, state: after.state };
  }

  /** Claims and sends one queued intent; a no-op if another process holds or finished it. */
  async process(intentId: string): Promise<void> {
    const claimed = await this.messages
      .createQueryBuilder()
      .update()
      .set({
        state: WhatsappMessageState.SENDING,
        claimedAt: () => 'now()',
        attemptCount: () => 'attempt_count + 1',
      })
      .where('id = :id AND state = :queued', {
        id: intentId,
        queued: WhatsappMessageState.QUEUED,
      })
      .execute();
    if (!claimed.affected) return;
    const message = await this.messages.findOneByOrFail({ id: intentId });

    let outcome: Prepared;
    try {
      outcome = await this.deliver(message);
    } catch (error) {
      // deliver() throws only before Meta is called (the client never throws), so nothing left.
      this.logger.warn(
        `Intent ${message.id} preparation failed: ${(error as Error).name}`,
      );
      outcome = { outcome: 'RETRY', code: 'internal' };
    }
    await this.record(message, outcome);
  }

  /** `SENDING` rows whose worker died: may have been sent, so `UNKNOWN` (never resent). */
  async recoverStale(olderThanMs = 2 * 60_000): Promise<number> {
    const result = await this.messages
      .createQueryBuilder()
      .update()
      .set({
        state: WhatsappMessageState.UNKNOWN,
        lastErrorCode: 'stale_claim',
      })
      .where('state = :sending AND claimed_at < :before', {
        sending: WhatsappMessageState.SENDING,
        before: new Date(Date.now() - olderThanMs),
      })
      .execute();
    return result.affected ?? 0;
  }

  /**
   * One chunk of queued intents: campaign invitations and anything not picked up inline (crash,
   * retry-later). QR images first, so an accepted guest never waits behind a campaign; then oldest.
   * Invitations of a paused campaign wait, and invitations stop at the rolling daily limit
   * (`WHATSAPP_DAILY_INVITATION_LIMIT`); both stay `QUEUED`. Returns how many were taken.
   */
  async processQueued(limit = 50, settleMs = 10_000): Promise<number> {
    const settled = new Date(Date.now() - settleMs);
    const others = await this.queued('others', limit, settled);
    const budget = await this.invitationBudget();
    const room = Math.min(limit - others.length, budget);
    const invitations =
      room > 0 ? await this.queued('invitations', room, settled) : [];
    if (budget === 0) await this.warnLimitReached(settled);
    for (const id of [...others, ...invitations]) await this.process(id);
    return others.length + invitations.length;
  }

  /** Invitations still allowed in the rolling 24 h; `Infinity` without a limit. */
  async invitationBudget(): Promise<number> {
    if (!this.dailyLimit) return Infinity;
    const [row] = await this.messages.query<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM whatsapp_messages
        WHERE kind = $1
          AND (state = $2 OR (state IN ($3, $4) AND coalesce(sent_at, claimed_at) > now() - interval '24 hours'))`,
      [
        WhatsappMessageKind.INVITATION,
        WhatsappMessageState.SENDING,
        WhatsappMessageState.SENT,
        WhatsappMessageState.UNKNOWN,
      ],
    );
    return Math.max(0, this.dailyLimit - row.n);
  }

  private async queued(
    which: 'invitations' | 'others',
    limit: number,
    settled: Date,
  ): Promise<string[]> {
    const query = this.messages
      .createQueryBuilder('m')
      .select('m.id', 'id')
      .where('m.state = :queued AND m.updated_at < :settled', {
        queued: WhatsappMessageState.QUEUED,
        settled,
      })
      .orderBy('m.created_at', 'ASC')
      .limit(limit);
    if (which === 'others')
      query.andWhere('m.kind <> :invitation', {
        invitation: WhatsappMessageKind.INVITATION,
      });
    else
      query
        .innerJoin(Event, 'e', 'e.id = m.event_id')
        .andWhere('m.kind = :invitation AND e.campaign_status <> :paused', {
          invitation: WhatsappMessageKind.INVITATION,
          paused: EventCampaignStatus.PAUSED,
        });
    const rows = await query.getRawMany<{ id: string }>();
    return rows.map((row) => row.id);
  }

  /** At most every 10 minutes, and only when invitations are actually waiting. */
  private async warnLimitReached(settled: Date): Promise<void> {
    if (Date.now() - this.limitWarnedAt < 10 * 60_000) return;
    const waiting = await this.queued('invitations', 1, settled);
    if (!waiting.length) return;
    this.limitWarnedAt = Date.now();
    this.logger.warn(
      `Daily invitation limit (${this.dailyLimit}) reached; queued invitations wait for the next window`,
    );
  }

  private async deliver(message: WhatsappMessage): Promise<Prepared> {
    const guest = await this.guests.findOneBy({ id: message.guestId });
    if (!guest || guest.deletedAt || !guest.phone)
      return { outcome: 'CANCELLED', code: 'guest_gone' };
    const event = await this.events.findOneByOrFail({ id: message.eventId });
    if (event.startsAt <= new Date())
      return { outcome: 'CANCELLED', code: 'event_started' };
    if (
      event.status === EventStatus.CANCELLED ||
      event.paymentStatus !== EventPaymentStatus.PAID
    )
      return { outcome: 'CANCELLED', code: 'event_inactive' };

    if (message.kind === WhatsappMessageKind.INVITATION)
      return this.deliverInvitation(message, guest, event);
    if (message.kind === WhatsappMessageKind.QR)
      return this.deliverQr(message, guest, event);
    return { outcome: 'CANCELLED', code: 'unsupported_kind' };
  }

  private async deliverInvitation(
    message: WhatsappMessage,
    guest: Guest,
    event: Event,
  ): Promise<Prepared> {
    if (event.campaignStatus === EventCampaignStatus.PAUSED)
      return { outcome: 'HOLD' };
    if (message.scheduleVersion !== event.scheduleVersion)
      return { outcome: 'CANCELLED', code: 'schedule_changed' };
    const content = event.approvedContentId
      ? await this.contents.findOneBy({ id: event.approvedContentId })
      : null;
    // The key carries the content version: a newer approval must never go out under this intent.
    if (
      !content ||
      message.logicalKey !== invitationKey(guest.id, content.version)
    )
      return { outcome: 'CANCELLED', code: 'not_approved' };
    return this.client.sendTemplate(guest.phone!, {
      name: content.templateName,
      language: content.templateLanguage,
      bodyParameters: [
        guest.name,
        content.variables.eventName,
        content.variables.dateText,
        content.variables.venue,
      ],
      quickReplyPayloads: [RSVP_ACCEPT, RSVP_DECLINE],
    });
  }

  /**
   * Issues the QR at send time so the token only ever exists in memory: the hash is written, the
   * PNG uploaded and sent. A retry issues a fresh token for the same version (the earlier one was
   * never delivered). A decline or a newer version in between cancels this intent.
   */
  private async deliverQr(
    message: WhatsappMessage,
    guest: Guest,
    event: Event,
  ): Promise<Prepared> {
    if (Date.now() - message.createdAt.getTime() > WINDOW_MS)
      return { outcome: 'FAILED', code: 'window_closed' };
    const version = message.qrVersion!;
    const token = newQrToken();
    const issued = await this.guests
      .createQueryBuilder()
      .update()
      .set({
        qrTokenHash: hashQrToken(token),
        qrVersion: version,
        qrIssuedAt: () => 'now()',
      })
      .where(
        // `<=`: versions may skip (a cancelled intent never issued); a newer issue blocks this one.
        'id = :id AND rsvp = :accepted AND deleted_at IS NULL AND qr_version <= :version',
        { id: guest.id, accepted: GuestRsvp.ACCEPTED, version },
      )
      .execute();
    if (!issued.affected) return { outcome: 'CANCELLED', code: 'superseded' };

    const url = qrUrl(this.appOrigin, token);
    const upload = await this.client.uploadPng(await renderQrPng(url));
    if (!upload.ok)
      return { outcome: upload.retry ? 'RETRY' : 'FAILED', code: upload.code };
    const caption = `رمز دخولك إلى ${event.name}.\nيُرجى إبرازه عند الوصول.\n${url}`;
    return this.client.sendImage(guest.phone!, upload.mediaId, caption);
  }

  private async record(message: WhatsappMessage, result: Prepared) {
    const where = { id: message.id, state: WhatsappMessageState.SENDING };
    switch (result.outcome) {
      case 'HOLD':
        // Not an attempt: undo the claim's count so a pause never uses up retries.
        await this.messages
          .createQueryBuilder()
          .update()
          .set({
            state: WhatsappMessageState.QUEUED,
            claimedAt: null,
            attemptCount: () => 'attempt_count - 1',
          })
          .where(where)
          .execute();
        return;
      case 'SENT':
        await this.messages
          .createQueryBuilder()
          .update()
          .set({
            state: WhatsappMessageState.SENT,
            providerMessageId: result.messageId,
            sentAt: () => 'now()',
            lastErrorCode: null,
            // A status webhook may already have moved it further.
            deliveryStatus: () =>
              `CASE WHEN delivery_status = 'NONE' THEN '${WhatsappDeliveryStatus.SENT}'::whatsapp_delivery_status ELSE delivery_status END`,
          })
          // A late answer after stale recovery still records the truth.
          .where('id = :id AND state IN (:...states)', {
            id: message.id,
            states: [
              WhatsappMessageState.SENDING,
              WhatsappMessageState.UNKNOWN,
            ],
          })
          .execute();
        return;
      case 'RETRY':
        if (message.attemptCount < MAX_ATTEMPTS) {
          await this.messages.update(where, {
            state: WhatsappMessageState.QUEUED,
            claimedAt: null,
            lastErrorCode: result.code,
          });
          return;
        }
        await this.messages.update(where, {
          state: WhatsappMessageState.FAILED,
          lastErrorCode: result.code,
        });
        return;
      case 'FAILED':
      case 'UNKNOWN':
      case 'CANCELLED':
        await this.messages.update(where, {
          state: WhatsappMessageState[result.outcome],
          lastErrorCode: result.code,
        });
        if (result.outcome !== 'CANCELLED')
          this.logger.warn(
            `Intent ${message.id} (${message.kind}) ${result.outcome}: ${result.code}`,
          );
    }
  }
}
