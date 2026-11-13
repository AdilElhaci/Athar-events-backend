import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  notFound,
  serviceUnavailable,
  unprocessable,
} from '../../shared/exceptions/app.exception';
import { buildMeta, Paginated } from '../../shared/pagination';
import { AdminAction } from '../admin-actions/admin-action.entity';
import { Event } from '../events/entities/event.entity';
import { Guest } from '../guests/entities/guest.entity';
import { RepliesQueryDto, ReplyView, SendReplyDto } from './dto/reply.dto';
import {
  WhatsappInbound,
  WhatsappInboundType,
} from './entities/whatsapp-inbound.entity';
import { WhatsappMessageState } from './entities/whatsapp-message.entity';
import { WhatsappReply } from './entities/whatsapp-reply.entity';
import { WhatsappClient } from './whatsapp/whatsapp.client';

/** Meta's customer-service window is 24 h from the guest's last message; same margin as the QR sender. */
const WINDOW_MS = 23 * 60 * 60 * 1000;
/** Meta: "more than 24 hours have passed since the customer last replied". */
const META_WINDOW_CLOSED = 'meta_131047';

const failure = (code: string | null) =>
  unprocessable(
    code === META_WINDOW_CLOSED ? 'replies.window_closed' : 'replies.failed',
  );

interface TimelineRow {
  id: string;
  direction: 'IN' | 'OUT';
  guest_id: string | null;
  phone: string | null;
  type: WhatsappInboundType;
  meta_type: string | null;
  body: string | null;
  button_payload: string | null;
  outcome: ReplyView['outcome'];
  state: ReplyView['state'];
  delivery_status: ReplyView['deliveryStatus'];
  error_code: string | null;
  sent_by_name: string | null;
  at: Date;
}

/**
 * An event's WhatsApp conversation with its guests: what they sent (D-43) and the free-form
 * replies admins send back inside Meta's 24 h window (D-44). A reply is sent once and never
 * retried by the system; an ambiguous outcome stays `UNKNOWN`.
 */
@Injectable()
export class RepliesService {
  private readonly logger = new Logger(RepliesService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly client: WhatsappClient,
  ) {}

  async list(
    eventId: string,
    { page, limit, type }: RepliesQueryDto,
  ): Promise<Paginated<ReplyView>> {
    await this.assertEvent(eventId);
    // Admin replies are text; they stay in the "all" and "text" views only.
    const withOut = !type || type === WhatsappInboundType.TEXT;
    const params: unknown[] = [eventId];
    let inFilter = '';
    if (type) {
      params.push(type);
      inFilter = `AND i.type = $2`;
    }
    const union = `
      SELECT i.id, 'IN' AS direction, i.guest_id, i.from_phone AS phone, i.type::text AS type,
             i.meta_type, i.body, i.button_payload, i.outcome::text AS outcome,
             NULL AS state, NULL AS delivery_status, NULL AS error_code, NULL AS sent_by_name,
             i.received_at AS at
        FROM whatsapp_inbound i
       WHERE i.event_id = $1 ${inFilter}
      ${
        withOut
          ? `UNION ALL
      SELECT r.id, 'OUT', r.guest_id, r.to_phone, 'TEXT', 'text', r.body, NULL, NULL,
             r.state::text, r.delivery_status::text, r.error_code, u.name, r.created_at
        FROM whatsapp_replies r
        LEFT JOIN users u ON u.id = r.sent_by_user_id
       WHERE r.event_id = $1`
          : ''
      }`;
    const [{ total }] = await this.dataSource.query<{ total: string }[]>(
      `SELECT count(*) AS total FROM (${union}) t`,
      params,
    );
    const rows = await this.dataSource.query<TimelineRow[]>(
      `SELECT * FROM (${union}) t ORDER BY t.at DESC, t.id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, (page - 1) * limit],
    );

    const guestIds = [
      ...new Set(
        rows.map((r) => r.guest_id).filter((id): id is string => !!id),
      ),
    ];
    const guests = guestIds.length
      ? await this.dataSource
          .getRepository(Guest)
          .createQueryBuilder('g')
          .select(['g.id', 'g.name', 'g.phone'])
          .where('g.id IN (:...ids)', { ids: guestIds })
          .getMany()
      : [];
    const byId = new Map(guests.map((g) => [g.id, g]));
    const windows = await this.windows(
      guests.map((g) => g.phone).filter((p): p is string => !!p),
    );

    return {
      items: rows.map((r): ReplyView => {
        const guest = r.guest_id ? byId.get(r.guest_id) : undefined;
        const phone = guest?.phone ?? r.phone;
        return {
          id: r.id,
          direction: r.direction,
          guestId: r.guest_id,
          guestName: guest?.name ?? null,
          guestPhone: phone,
          type: r.type,
          metaType: r.meta_type,
          body: r.body,
          buttonPayload: r.button_payload,
          outcome: r.outcome,
          state: r.state,
          deliveryStatus: r.delivery_status,
          errorCode: r.error_code,
          sentByName: r.sent_by_name,
          at: new Date(r.at).toISOString(),
          replyWindowClosesAt:
            (guest?.phone && windows.get(guest.phone)?.toISOString()) ?? null,
        };
      }),
      meta: buildMeta(Number(total), page, limit),
    };
  }

  /**
   * Sends one free-form text to a guest of the event. Refused outside the window; a repeated
   * `requestId` returns the first attempt without sending again. Throws on a definite failure
   * (the attempt stays recorded); returns `UNKNOWN` as it is.
   */
  async send(
    actorUserId: string,
    eventId: string,
    dto: SendReplyDto,
  ): Promise<ReplyView> {
    const repo = this.dataSource.getRepository(WhatsappReply);
    const earlier = await repo.findOneBy({ requestId: dto.requestId });
    if (earlier) return this.repeat(eventId, earlier);

    await this.assertEvent(eventId);
    const guest = await this.dataSource
      .getRepository(Guest)
      .findOneBy({ id: dto.guestId, eventId });
    if (!guest || guest.deletedAt) throw notFound();
    if (!guest.phone) throw unprocessable('replies.no_phone');
    if (!this.client.isConfigured())
      throw serviceUnavailable('replies.not_configured');
    const closes = (await this.windows([guest.phone])).get(guest.phone);
    if (!closes) throw unprocessable('replies.window_closed');

    const inserted = await repo
      .createQueryBuilder()
      .insert()
      .values({
        eventId,
        guestId: guest.id,
        sentByUserId: actorUserId,
        requestId: dto.requestId,
        toPhone: guest.phone,
        body: dto.text,
      })
      .orIgnore()
      .returning(['id'])
      .execute();
    const id = (inserted.raw as Array<{ id: string }>)[0]?.id;
    if (!id) {
      // A concurrent submit with the same request id won the insert.
      const first = await repo.findOneByOrFail({ requestId: dto.requestId });
      return this.repeat(eventId, first);
    }

    const result = await this.client.sendText(guest.phone, dto.text);
    const state =
      result.outcome === 'SENT'
        ? WhatsappMessageState.SENT
        : result.outcome === 'UNKNOWN'
          ? WhatsappMessageState.UNKNOWN
          : WhatsappMessageState.FAILED; // RETRY too: the admin decides whether to write again
    await repo.update(id, {
      state,
      ...(result.outcome === 'SENT'
        ? { providerMessageId: result.messageId, sentAt: new Date() }
        : { errorCode: result.code.slice(0, 60) }),
      ...(state === WhatsappMessageState.FAILED && { failedAt: new Date() }),
    });
    await this.dataSource.manager.insert(AdminAction, {
      actorUserId,
      action: 'reply.send',
      targetType: 'guest',
      targetId: guest.id,
      summary: { eventId, replyId: id, state },
    });
    if (state === WhatsappMessageState.FAILED) {
      const code = result.outcome === 'SENT' ? null : result.code;
      this.logger.warn(`Reply ${id} failed: ${code}`);
      throw failure(code);
    }
    return this.view(eventId, id);
  }

  /** The same submit again: the first outcome, a failure included. */
  private repeat(eventId: string, reply: WhatsappReply): Promise<ReplyView> {
    if (reply.eventId !== eventId) throw notFound();
    if (reply.state === WhatsappMessageState.FAILED)
      throw failure(reply.errorCode);
    return this.view(eventId, reply.id);
  }

  /** Phone → when the reply window closes, for phones whose window is still open. */
  private async windows(phones: string[]): Promise<Map<string, Date>> {
    if (!phones.length) return new Map();
    const rows = await this.dataSource
      .getRepository(WhatsappInbound)
      .createQueryBuilder('i')
      .select('i.fromPhone', 'phone')
      .addSelect('MAX(i.receivedAt)', 'last')
      .where('i.fromPhone IN (:...phones)', { phones: [...new Set(phones)] })
      .groupBy('i.fromPhone')
      .getRawMany<{ phone: string; last: Date }>();
    const now = Date.now();
    const open = new Map<string, Date>();
    for (const { phone, last } of rows) {
      const closes = new Date(new Date(last).getTime() + WINDOW_MS);
      if (closes.getTime() > now) open.set(phone, closes);
    }
    return open;
  }

  private async view(eventId: string, replyId: string): Promise<ReplyView> {
    const reply = await this.dataSource
      .getRepository(WhatsappReply)
      .findOneByOrFail({ id: replyId });
    if (reply.eventId !== eventId) throw notFound();
    const guest = await this.dataSource
      .getRepository(Guest)
      .findOneBy({ id: reply.guestId });
    const sender = await this.dataSource.query<{ name: string }[]>(
      `SELECT name FROM users WHERE id = $1`,
      [reply.sentByUserId],
    );
    const windows = guest?.phone
      ? await this.windows([guest.phone])
      : new Map<string, Date>();
    return {
      id: reply.id,
      direction: 'OUT',
      guestId: reply.guestId,
      guestName: guest?.name ?? null,
      guestPhone: guest?.phone ?? reply.toPhone,
      type: WhatsappInboundType.TEXT,
      metaType: 'text',
      body: reply.body,
      buttonPayload: null,
      outcome: null,
      state: reply.state,
      deliveryStatus: reply.deliveryStatus,
      errorCode: reply.errorCode,
      sentByName: sender[0]?.name ?? null,
      at: reply.createdAt.toISOString(),
      replyWindowClosesAt:
        (guest?.phone && windows.get(guest.phone)?.toISOString()) ?? null,
    };
  }

  private async assertEvent(eventId: string): Promise<void> {
    const exists = await this.dataSource
      .getRepository(Event)
      .existsBy({ id: eventId });
    if (!exists) throw notFound();
  }
}
