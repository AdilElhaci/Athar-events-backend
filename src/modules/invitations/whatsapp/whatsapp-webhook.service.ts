import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import type { EnvironmentVariables } from '../../../config/env.validation';
import { Event } from '../../events/entities/event.entity';
import { Guest, GuestRsvp } from '../../guests/entities/guest.entity';
import {
  WebhookProvider,
  WebhookReceipt,
} from '../../payments/entities/webhook-receipt.entity';
import {
  WhatsappInbound,
  WhatsappInboundOutcome,
  WhatsappInboundType,
} from '../entities/whatsapp-inbound.entity';
import {
  WhatsappDeliveryStatus,
  WhatsappMessage,
  WhatsappMessageKind,
  WhatsappMessageState,
} from '../entities/whatsapp-message.entity';
import {
  qrKey,
  RSVP_ACCEPT,
  RSVP_DECLINE,
  WhatsappSenderService,
} from './whatsapp-sender.service';

const ID_PATTERN = /^[\w.=+/-]{1,128}$/;
const PHONE_DIGITS = /^\d{6,15}$/;
const STATUSES: Record<string, WhatsappDeliveryStatus> = {
  sent: WhatsappDeliveryStatus.SENT,
  delivered: WhatsappDeliveryStatus.DELIVERED,
  read: WhatsappDeliveryStatus.READ,
  failed: WhatsappDeliveryStatus.FAILED,
};

type Json = Record<string, unknown>;
const obj = (value: unknown): Json | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Json)
    : undefined;
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

/** Unix seconds from Meta, bounded to a sane range; otherwise now. */
const metaTime = (value: unknown): Date => {
  const seconds = Number(str(value));
  const now = Date.now();
  return Number.isFinite(seconds) &&
    Math.abs(seconds * 1000 - now) < 7 * 86_400_000
    ? new Date(seconds * 1000)
    : new Date(now);
};

export interface WebhookSummary {
  statuses: number;
  messages: number;
}

/**
 * Meta webhook handling (SP-04, integrations.md). Signature over the raw body; every item is
 * deduplicated in the database, so Meta's retries and out-of-order batches are safe. Payloads,
 * phones and names are never logged.
 */
@Injectable()
export class WhatsappWebhookService {
  private readonly logger = new Logger(WhatsappWebhookService.name);
  private readonly appSecret: string | null;
  private readonly verifyToken: Buffer | null;

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @InjectRepository(WebhookReceipt)
    private readonly receipts: Repository<WebhookReceipt>,
    @InjectRepository(WhatsappMessage)
    private readonly messages: Repository<WhatsappMessage>,
    private readonly sender: WhatsappSenderService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.appSecret = config.get('WHATSAPP_APP_SECRET', { infer: true }) ?? null;
    const token = config.get('WHATSAPP_VERIFY_TOKEN', { infer: true });
    this.verifyToken = token ? Buffer.from(token) : null;
  }

  /** The subscription handshake; false when no verify token is configured. */
  verifyHandshake(mode: unknown, token: unknown): boolean {
    if (mode !== 'subscribe' || typeof token !== 'string' || !this.verifyToken)
      return false;
    const candidate = Buffer.from(token);
    return (
      candidate.length === this.verifyToken.length &&
      timingSafeEqual(candidate, this.verifyToken)
    );
  }

  /** `X-Hub-Signature-256: sha256=<hex HMAC of the raw body with the app secret>`. */
  verifySignature(rawBody: Buffer | undefined, header: unknown): boolean {
    if (!this.appSecret || !rawBody || typeof header !== 'string') return false;
    const match = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
    if (!match) return false;
    const expected = createHmac('sha256', this.appSecret)
      .update(rawBody)
      .digest();
    const received = Buffer.from(match[1], 'hex');
    return timingSafeEqual(received, expected);
  }

  /** Applies one verified delivery. Throws on a database failure so Meta retries. */
  async handle(body: unknown): Promise<WebhookSummary> {
    const summary: WebhookSummary = { statuses: 0, messages: 0 };
    const kicks: string[] = [];
    if (str(obj(body)?.object) !== 'whatsapp_business_account') return summary;

    for (const entry of arr(obj(body)?.entry)) {
      for (const change of arr(obj(entry)?.changes)) {
        if (str(obj(change)?.field) !== 'messages') continue;
        const value = obj(obj(change)?.value);
        for (const status of arr(value?.statuses)) {
          await this.applyStatus(obj(status));
          summary.statuses++;
        }
        for (const message of arr(value?.messages)) {
          const intentId = await this.applyMessage(obj(message));
          if (intentId) kicks.push(intentId);
          summary.messages++;
        }
      }
    }
    // After every commit: send the QR now; the sweeper picks up anything this misses.
    for (const id of kicks)
      void this.sender
        .process(id)
        .catch((error: Error) =>
          this.logger.warn(`QR intent ${id} kick failed: ${error.name}`),
        );
    return summary;
  }

  /** Monotonic: `NONE < SENT < DELIVERED < READ`; `FAILED` only from NONE/SENT. */
  private async applyStatus(status: Json | undefined): Promise<void> {
    const id = str(status?.id);
    const next = STATUSES[str(status?.status) ?? ''];
    if (!id || !ID_PATTERN.test(id) || !next) return;
    const at = metaTime(status?.timestamp);
    const code = obj(arr(status?.errors)[0])?.code;

    const dedupeKey = `${id}:${next}`.slice(0, 200);
    await this.receipts
      .createQueryBuilder()
      .insert()
      .values({ provider: WebhookProvider.META, dedupeKey })
      .orIgnore()
      .execute();
    const receipt = await this.receipts.findOneByOrFail({
      provider: WebhookProvider.META,
      dedupeKey,
    });
    if (receipt.processedAt) return;

    const update = this.messages
      .createQueryBuilder()
      .update()
      .where('provider_message_id = :id', { id });
    if (next === WhatsappDeliveryStatus.FAILED) {
      update
        .set({
          deliveryStatus: next,
          failedAt: at,
          lastErrorCode:
            typeof code === 'number' ? `meta_${code}` : 'meta_failed',
        })
        .andWhere('delivery_status IN (:...from)', {
          from: [WhatsappDeliveryStatus.NONE, WhatsappDeliveryStatus.SENT],
        });
    } else {
      update
        .set({
          deliveryStatus: next,
          deliveredAt:
            next === WhatsappDeliveryStatus.SENT
              ? undefined
              : () => 'COALESCE(delivered_at, :at)',
          readAt:
            next === WhatsappDeliveryStatus.READ
              ? () => 'COALESCE(read_at, :at)'
              : undefined,
        })
        // The enum is declared in rank order and FAILED is last, so `<` is the monotonic rule.
        .andWhere('delivery_status < :next::whatsapp_delivery_status', {
          next,
        })
        .setParameter('at', at);
    }
    const result = await update.execute();
    // Meta's failure code is the only way to learn why a message was not delivered,
    // including for messages sent outside the platform (manual tests). Code only, never a payload.
    const errorCode =
      next === WhatsappDeliveryStatus.FAILED
        ? typeof code === 'number'
          ? `meta_${code}`
          : 'meta_failed'
        : null;
    if (errorCode)
      this.logger.warn(
        `WhatsApp delivery failed: ${errorCode} (${result.affected ? 'matched' : 'unmatched'})`,
      );
    await this.receipts.update(receipt.id, {
      processedAt: new Date(),
      outcome: result.affected ? 'applied' : 'no_change',
      errorCode,
    });
  }

  /**
   * One inbound message, recorded and applied in a single transaction: the unique inbound id makes
   * a retried delivery a no-op. Returns a QR intent to send after commit, if one was created.
   */
  private async applyMessage(
    message: Json | undefined,
  ): Promise<string | null> {
    const providerId = str(message?.id);
    if (!providerId || !ID_PATTERN.test(providerId)) return null;
    const fromDigits = str(message?.from);
    const fromPhone =
      fromDigits && PHONE_DIGITS.test(fromDigits) ? `+${fromDigits}` : null;
    const contextId = str(obj(message?.context)?.id);
    const type = str(message?.type);
    const payload =
      type === 'button' ? str(obj(message?.button)?.payload) : undefined;

    return this.db.transaction(async (manager) => {
      const inserted = await manager
        .createQueryBuilder()
        .insert()
        .into(WhatsappInbound)
        .values({
          providerMessageId: providerId,
          contextMessageId:
            contextId && ID_PATTERN.test(contextId) ? contextId : null,
          fromPhone,
          type:
            type === 'button'
              ? WhatsappInboundType.BUTTON
              : type === 'text'
                ? WhatsappInboundType.TEXT
                : WhatsappInboundType.OTHER,
          buttonPayload: payload?.slice(0, 64) ?? null,
          outcome: WhatsappInboundOutcome.IGNORED,
        })
        .orIgnore()
        .returning(['id'])
        .execute();
      const inboundId = (inserted.raw as Array<{ id: string }>)[0]?.id;
      if (!inboundId) return null; // already handled

      const { outcome, guestId, intentId } = await this.applyReply(manager, {
        payload,
        contextId,
        fromPhone,
      });
      await manager.update(WhatsappInbound, inboundId, { outcome, guestId });
      return intentId;
    });
  }

  private async applyReply(
    manager: EntityManager,
    reply: {
      payload: string | undefined;
      contextId: string | undefined;
      fromPhone: string | null;
    },
  ): Promise<{
    outcome: WhatsappInboundOutcome;
    guestId: string | null;
    intentId: string | null;
  }> {
    const none = { guestId: null, intentId: null };
    if (reply.payload !== RSVP_ACCEPT && reply.payload !== RSVP_DECLINE)
      return { outcome: WhatsappInboundOutcome.IGNORED, ...none };
    if (!reply.contextId || !reply.fromPhone)
      return { outcome: WhatsappInboundOutcome.UNMATCHED, ...none };

    // The reply must answer one of our invitations, from the number it was sent to.
    const invitation = await manager.findOneBy(WhatsappMessage, {
      providerMessageId: reply.contextId,
      kind: WhatsappMessageKind.INVITATION,
    });
    if (!invitation)
      return { outcome: WhatsappInboundOutcome.UNMATCHED, ...none };
    const guest = await manager
      .getRepository(Guest)
      .createQueryBuilder('g')
      .setLock('pessimistic_write')
      .where('g.id = :id', { id: invitation.guestId })
      .getOne();
    if (!guest || guest.deletedAt || guest.phone !== reply.fromPhone)
      return { outcome: WhatsappInboundOutcome.UNMATCHED, ...none };

    const matched = { guestId: guest.id, intentId: null };
    const event = await manager.findOneByOrFail(Event, { id: guest.eventId });
    if (event.startsAt <= new Date())
      return { outcome: WhatsappInboundOutcome.AFTER_EVENT, ...matched };
    if (guest.rsvpLocked)
      return { outcome: WhatsappInboundOutcome.LOCKED, ...matched };

    if (reply.payload === RSVP_DECLINE) {
      if (guest.rsvp !== GuestRsvp.DECLINED)
        await manager.update(Guest, guest.id, {
          rsvp: GuestRsvp.DECLINED,
          rsvpAt: new Date(),
          qrTokenHash: null, // a declined guest's QR no longer admits anyone
        });
      await manager.update(
        WhatsappMessage,
        {
          guestId: guest.id,
          kind: WhatsappMessageKind.QR,
          state: WhatsappMessageState.QUEUED,
        },
        { state: WhatsappMessageState.CANCELLED, lastErrorCode: 'declined' },
      );
      return { outcome: WhatsappInboundOutcome.APPLIED, ...matched };
    }

    if (guest.rsvp !== GuestRsvp.ACCEPTED)
      await manager.update(Guest, guest.id, {
        rsvp: GuestRsvp.ACCEPTED,
        rsvpAt: new Date(),
      });
    const latest = await manager.findOne(WhatsappMessage, {
      where: { guestId: guest.id, kind: WhatsappMessageKind.QR },
      order: { qrVersion: 'DESC' },
    });
    // A QR is on its way, or a valid one was sent (or may have been): nothing new.
    if (
      latest &&
      (latest.state === WhatsappMessageState.QUEUED ||
        latest.state === WhatsappMessageState.SENDING ||
        (guest.qrTokenHash &&
          (latest.state === WhatsappMessageState.SENT ||
            latest.state === WhatsappMessageState.UNKNOWN)))
    )
      return { outcome: WhatsappInboundOutcome.APPLIED, ...matched };

    // After a decline, a failure or a cancellation: a new version, so a new token.
    const qrVersion = Math.max(guest.qrVersion, latest?.qrVersion ?? 0) + 1;
    await manager
      .createQueryBuilder()
      .insert()
      .into(WhatsappMessage)
      .values({
        eventId: guest.eventId,
        guestId: guest.id,
        kind: WhatsappMessageKind.QR,
        logicalKey: qrKey(guest.id, qrVersion),
        qrVersion,
      })
      .orIgnore()
      .execute();
    const intent = await manager.findOneByOrFail(WhatsappMessage, {
      logicalKey: qrKey(guest.id, qrVersion),
    });
    return {
      outcome: WhatsappInboundOutcome.APPLIED,
      guestId: guest.id,
      intentId: intent.state === WhatsappMessageState.QUEUED ? intent.id : null,
    };
  }
}
