import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { EnvironmentVariables } from '../../../config/env.validation';
import { renderQrCardPng } from '../../checkin/qr-card';
import { deriveQrToken, hashQrToken, qrUrl } from '../../checkin/qr-token';
import {
  Event,
  EventCampaignStatus,
  EventPaymentStatus,
  EventStatus,
} from '../../events/entities/event.entity';
import { Guest, GuestRsvp } from '../../guests/entities/guest.entity';
import { InvitationContent } from '../entities/invitation-content.entity';
import {
  JOURNEY_KINDS,
  JourneyKind,
  WhatsappDeliveryStatus,
  WhatsappMessage,
  WhatsappMessageKind,
  WhatsappMessageState,
} from '../entities/whatsapp-message.entity';
import { journeySkipReason } from '../journey/journey-eligibility';
import {
  APOLOGY_TEXT,
  arabicDate,
  arabicDateTime,
  arabicTime,
  confirmationCaption,
  todayOrTomorrow,
  venueLine,
} from '../journey/journey-messages';
import { JourneyTemplatesService } from '../journey/journey-templates.service';
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
/** The campaign key, or an admin resend of it (`…:r<n>`, SCR-25). */
export const isInvitationKeyFor = (
  key: string,
  guestId: string,
  contentVersion: number,
) => {
  const base = invitationKey(guestId, contentVersion);
  return key === base || new RegExp(`^${base}:r\\d+$`).test(key);
};
export const qrKey = (guestId: string, qrVersion: number) =>
  `qr:${guestId}:${qrVersion}`;
/** M02 by template after the window (an admin accepted a late reply, SP-07). */
export const qrTemplateKey = (guestId: string, qrVersion: number) =>
  `qr_template:${guestId}:${qrVersion}`;
/** M03: once per guest, ever (SP-07 rule 3). */
export const apologyKey = (guestId: string) => `apology:${guestId}`;

/**
 * Business-initiated templates: they go through the template lane, wait while the campaign is
 * paused (except the thank-you) and count towards the rolling daily limit (SP-07 rule 7).
 */
export const TEMPLATE_KINDS: WhatsappMessageKind[] = [
  WhatsappMessageKind.INVITATION,
  WhatsappMessageKind.QR_TEMPLATE,
  ...JOURNEY_KINDS,
];
const isJourneyKind = (kind: WhatsappMessageKind): kind is JourneyKind =>
  (JOURNEY_KINDS as readonly WhatsappMessageKind[]).includes(kind);

/**
 * Sends one intent at a time. Claims are conditional updates (`QUEUED` → `SENDING`), so two workers
 * or a sweeper and an inline kick never send the same row twice. Every precondition is re-checked
 * after the claim; nothing is sent once the event has started.
 */
@Injectable()
export class WhatsappSenderService {
  private readonly logger = new Logger(WhatsappSenderService.name);
  private readonly appOrigin: string;
  private readonly qrSecret: string;
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
    private readonly templates: JourneyTemplatesService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.appOrigin = config.get('APP_ORIGIN', { infer: true });
    this.qrSecret = config.get('QR_TOKEN_SECRET', { infer: true });
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
        WHERE kind = ANY($1::whatsapp_message_kind[])
          AND (state = $2 OR (state IN ($3, $4) AND coalesce(sent_at, claimed_at) > now() - interval '24 hours'))`,
      [
        TEMPLATE_KINDS,
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
      .where('m.state = :queued', { queued: WhatsappMessageState.QUEUED })
      .orderBy('m.created_at', 'ASC')
      .limit(limit);
    // QR images are sent inline by the webhook that created them: give that a moment first.
    // Invitations have no inline sender, so a queue trigger sends them at once (claims are
    // conditional either way, so a race only wastes a query).
    // Templates (invitations, journey messages) are business-initiated: daily limit and pause.
    if (which === 'others')
      query.andWhere(
        'm.kind NOT IN (:...templates) AND m.updated_at < :settled',
        { templates: TEMPLATE_KINDS, settled },
      );
    else
      query
        .innerJoin(Event, 'e', 'e.id = m.event_id')
        .andWhere('m.kind IN (:...templates)', { templates: TEMPLATE_KINDS })
        .andWhere('(e.campaign_status <> :paused OR m.kind = :thanks)', {
          paused: EventCampaignStatus.PAUSED,
          thanks: WhatsappMessageKind.THANK_YOU,
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
    // The thank-you is the one message sent after the start (D-50), to admitted guests only.
    if (
      event.startsAt <= new Date() &&
      message.kind !== WhatsappMessageKind.THANK_YOU
    )
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
    if (message.kind === WhatsappMessageKind.QR_TEMPLATE)
      return this.deliverQrTemplate(message, guest, event);
    if (message.kind === WhatsappMessageKind.APOLOGY)
      return this.deliverApology(message, guest);
    if (isJourneyKind(message.kind))
      return this.deliverJourney(message, message.kind, guest, event);
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
      !isInvitationKeyFor(message.logicalKey, guest.id, content.version)
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
   * M02 inside the window opened by the accept. The token is derived from the guest and version
   * (D-55), so reminders can carry the same QR; only its hash is written. A decline or a newer
   * version in between cancels this intent.
   */
  private async deliverQr(
    message: WhatsappMessage,
    guest: Guest,
    event: Event,
  ): Promise<Prepared> {
    if (Date.now() - message.createdAt.getTime() > WINDOW_MS)
      return { outcome: 'FAILED', code: 'window_closed' };
    const issued = await this.issueQr(guest, message.qrVersion!);
    if (!issued) return { outcome: 'CANCELLED', code: 'superseded' };
    const media = await this.uploadQrCard(issued.url, guest, event);
    if (!media.ok) return media.outcome;
    const content = await this.eventContent(event);
    return this.client.sendImage(
      guest.phone!,
      media.mediaId,
      confirmationCaption({
        eventName: content?.variables.eventName ?? event.name,
        date: arabicDate(event.startsAt, event.timezone),
        time: arabicTime(event.startsAt, event.timezone),
        venue: venueLine(event),
        qrUrl: issued.url,
      }),
    );
  }

  /** M02 by template (`athar_confirmation`) when the window has closed. */
  private async deliverQrTemplate(
    message: WhatsappMessage,
    guest: Guest,
    event: Event,
  ): Promise<Prepared> {
    const issued = await this.issueQr(guest, message.qrVersion!);
    if (!issued) return { outcome: 'CANCELLED', code: 'superseded' };
    const media = await this.uploadQrCard(issued.url, guest, event);
    if (!media.ok) return media.outcome;
    const content = await this.eventContent(event);
    return this.client.sendTemplate(guest.phone!, {
      name: this.templates.nameFor(WhatsappMessageKind.QR_TEMPLATE),
      language: this.templates.language,
      headerImageMediaId: media.mediaId,
      bodyParameters: [
        content?.variables.eventName ?? event.name,
        arabicDate(event.startsAt, event.timezone),
        arabicTime(event.startsAt, event.timezone),
        venueLine(event),
      ],
      quickReplyPayloads: [],
    });
  }

  /** M03: free text inside the window opened by the decline; not if the guest accepted since. */
  private async deliverApology(
    message: WhatsappMessage,
    guest: Guest,
  ): Promise<Prepared> {
    if (guest.rsvp !== GuestRsvp.DECLINED)
      return { outcome: 'CANCELLED', code: 'not_declined' };
    if (Date.now() - message.createdAt.getTime() > WINDOW_MS)
      return { outcome: 'CANCELLED', code: 'window_closed' };
    return this.client.sendText(guest.phone!, APOLOGY_TEXT);
  }

  /** SP-07: follow-ups, reminders, thank-you. Every rule is checked again after the claim. */
  private async deliverJourney(
    message: WhatsappMessage,
    kind: JourneyKind,
    guest: Guest,
    event: Event,
  ): Promise<Prepared> {
    if (
      event.campaignStatus === EventCampaignStatus.PAUSED &&
      kind !== WhatsappMessageKind.THANK_YOU
    )
      return { outcome: 'HOLD' };
    if (event.campaignStatus === EventCampaignStatus.CANCELLED)
      return { outcome: 'CANCELLED', code: 'campaign_cancelled' };
    if (message.scheduleVersion !== event.scheduleVersion)
      return { outcome: 'CANCELLED', code: 'schedule_changed' };
    const invitation =
      kind === WhatsappMessageKind.FOLLOW_UP_1 ||
      kind === WhatsappMessageKind.FOLLOW_UP_2
        ? await this.messages
            .createQueryBuilder('m')
            .where('m.guestId = :guest AND m.kind = :invitation', {
              guest: guest.id,
              invitation: WhatsappMessageKind.INVITATION,
            })
            .andWhere('m.state = :sent AND m.deliveryStatus <> :failed', {
              sent: WhatsappMessageState.SENT,
              failed: WhatsappDeliveryStatus.FAILED,
            })
            .orderBy('m.sentAt', 'ASC')
            .getOne()
        : null;
    const skip = journeySkipReason({
      kind,
      dueAt: message.scheduledFor ?? message.createdAt,
      now: new Date(),
      startsAt: event.startsAt,
      rsvpClosesAt: event.rsvpClosesAt,
      guest,
      invitationSentAt: invitation?.sentAt ?? null,
    });
    if (skip) return { outcome: 'CANCELLED', code: skip };

    const content = await this.eventContent(event);
    const eventName = content?.variables.eventName ?? event.name;
    const name = this.templates.nameFor(kind);
    const language = this.templates.language;
    const tz = event.timezone;
    switch (kind) {
      case WhatsappMessageKind.FOLLOW_UP_1:
        return this.client.sendTemplate(guest.phone!, {
          name,
          language,
          bodyParameters: [eventName, arabicDate(event.startsAt, tz)],
          quickReplyPayloads: [RSVP_ACCEPT, RSVP_DECLINE],
        });
      case WhatsappMessageKind.FOLLOW_UP_2:
        return this.client.sendTemplate(guest.phone!, {
          name,
          language,
          bodyParameters: [
            eventName,
            arabicDateTime(event.rsvpClosesAt ?? event.startsAt, tz),
          ],
          quickReplyPayloads: [RSVP_ACCEPT, RSVP_DECLINE],
        });
      case WhatsappMessageKind.THANK_YOU:
        return this.client.sendTemplate(guest.phone!, {
          name,
          language,
          bodyParameters: [eventName],
          quickReplyPayloads: [],
        });
      default: {
        // Reminders carry the guest's current QR (D-55): the same token as the confirmation.
        const current = await this.currentQr(guest);
        if (!current) return { outcome: 'CANCELLED', code: 'not_accepted' };
        const media = await this.uploadQrCard(current, guest, event);
        if (!media.ok) return media.outcome;
        const venue = venueLine(event);
        const time = arabicTime(event.startsAt, tz);
        return this.client.sendTemplate(guest.phone!, {
          name,
          language,
          headerImageMediaId: media.mediaId,
          bodyParameters:
            kind === WhatsappMessageKind.REMINDER_1
              ? [eventName, arabicDate(event.startsAt, tz), time, venue]
              : [
                  todayOrTomorrow(new Date(), event.startsAt, tz),
                  eventName,
                  time,
                  venue,
                ],
          quickReplyPayloads: [],
        });
      }
    }
  }

  /**
   * Writes the hash of the version's derived token if the guest still accepts and no newer
   * version was issued. Returns the QR URL, or null when superseded.
   */
  private async issueQr(
    guest: Guest,
    version: number,
  ): Promise<{ url: string } | null> {
    const token = deriveQrToken(this.qrSecret, guest.id, version);
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
    return issued.affected ? { url: qrUrl(this.appOrigin, token) } : null;
  }

  /**
   * The URL of the guest's valid QR. A token issued before D-55 cannot be derived again: the
   * guest gets a new version (the old QR stops working, this message carries the new one).
   */
  private async currentQr(guest: Guest): Promise<string | null> {
    if (!guest.qrTokenHash || guest.rsvp !== GuestRsvp.ACCEPTED) return null;
    const token = deriveQrToken(this.qrSecret, guest.id, guest.qrVersion);
    if (hashQrToken(token) === guest.qrTokenHash)
      return qrUrl(this.appOrigin, token);
    const next = guest.qrVersion + 1;
    const nextToken = deriveQrToken(this.qrSecret, guest.id, next);
    const reissued = await this.guests
      .createQueryBuilder()
      .update()
      .set({
        qrTokenHash: hashQrToken(nextToken),
        qrVersion: next,
        qrIssuedAt: () => 'now()',
      })
      .where(
        'id = :id AND rsvp = :accepted AND qr_version = :version AND qr_token_hash = :hash',
        {
          id: guest.id,
          accepted: GuestRsvp.ACCEPTED,
          version: guest.qrVersion,
          hash: guest.qrTokenHash,
        },
      )
      .execute();
    if (!reissued.affected) return null;
    this.logger.log(`Guest ${guest.id}: QR reissued for a reminder (D-55)`);
    return qrUrl(this.appOrigin, nextToken);
  }

  private async uploadQrCard(
    url: string,
    guest: Guest,
    event: Event,
  ): Promise<{ ok: true; mediaId: string } | { ok: false; outcome: Prepared }> {
    const upload = await this.client.uploadPng(
      renderQrCardPng({
        url,
        eventName: event.name,
        guestName: guest.name,
        startsAt: event.startsAt,
        timezone: event.timezone,
        venueName: event.venueName,
      }),
    );
    if (upload.ok) return { ok: true, mediaId: upload.mediaId };
    return {
      ok: false,
      outcome: {
        outcome: upload.retry ? 'RETRY' : 'FAILED',
        code: upload.code,
      },
    };
  }

  private eventContent(event: Event) {
    return event.approvedContentId
      ? this.contents.findOneBy({ id: event.approvedContentId })
      : Promise.resolve(null);
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
