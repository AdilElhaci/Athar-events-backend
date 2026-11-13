import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  notFound,
  serviceUnavailable,
  unprocessable,
} from '../../shared/exceptions/app.exception';
import { buildMeta, Paginated } from '../../shared/pagination';
import { AdminAction } from '../admin-actions/admin-action.entity';
import {
  ConversationContact,
  ConversationDetail,
  ConversationsQueryDto,
  ConversationView,
  InboxMessageView,
  SendReplyDto,
} from './dto/inbox.dto';
import { WhatsappInboundType } from './entities/whatsapp-inbound.entity';
import { WhatsappMessageState } from './entities/whatsapp-message.entity';
import { WhatsappReply } from './entities/whatsapp-reply.entity';
import { WhatsappClient } from './whatsapp/whatsapp.client';

/** Meta's customer-service window is 24 h from the last inbound message; same margin as the QR sender. */
const WINDOW_MS = 23 * 60 * 60 * 1000;
/** Meta: "more than 24 hours have passed since the customer last replied". */
const META_WINDOW_CLOSED = 'meta_131047';
const CONVERSATION_ID = /^\d{6,15}$/;

const failure = (code: string | null) =>
  unprocessable(
    code === META_WINDOW_CLOSED ? 'replies.window_closed' : 'replies.failed',
  );

/** Every message of every number, both directions; `$`-free so it can be embedded. */
const MESSAGES_SQL = `
  SELECT i.id, i.from_phone AS phone, 'IN' AS direction, i.type::text AS type, i.meta_type,
         i.body, i.button_payload, i.outcome::text AS outcome, NULL AS state,
         NULL AS delivery_status, NULL AS error_code, NULL AS sent_by_user_id, i.event_id,
         i.received_at AS at
    FROM whatsapp_inbound i
   WHERE i.from_phone IS NOT NULL
  UNION ALL
  SELECT r.id, r.to_phone, 'OUT', 'TEXT', 'text', r.body, NULL, NULL, r.state::text,
         r.delivery_status::text, r.error_code, r.sent_by_user_id, r.event_id, r.created_at
    FROM whatsapp_replies r`;

/** Guest messages that need a human: everything but RSVP buttons. */
const UNREAD_SQL = `seen_at IS NULL AND type <> 'BUTTON'`;

interface LastRow {
  phone: string;
  direction: 'IN' | 'OUT';
  type: WhatsappInboundType;
  meta_type: string | null;
  body: string | null;
  at: Date;
  unread: string;
  last_in: Date | null;
}

interface MessageRow {
  id: string;
  direction: 'IN' | 'OUT';
  type: WhatsappInboundType;
  meta_type: string | null;
  body: string | null;
  button_payload: string | null;
  outcome: InboxMessageView['outcome'];
  state: InboxMessageView['state'];
  delivery_status: InboxMessageView['deliveryStatus'];
  error_code: string | null;
  sent_by_name: string | null;
  event_reference: string | null;
  at: Date;
}

/**
 * D-45 WhatsApp inbox: one conversation per phone number across all events, guests or not.
 * Admins read what numbers sent (D-43) and reply with free text inside Meta's 24 h window
 * (D-44). A reply is sent once per `requestId` and never retried; `UNKNOWN` stays as it is.
 */
@Injectable()
export class InboxService {
  private readonly logger = new Logger(InboxService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly client: WhatsappClient,
  ) {}

  async conversations({
    page,
    limit,
    unread,
    search,
  }: ConversationsQueryDto): Promise<Paginated<ConversationView>> {
    const params: unknown[] = [];
    const where: string[] = [];
    if (unread) where.push('l.unread > 0');
    if (search) {
      const digits = search.replace(/\D/g, '').replace(/^0(?=5)/, '966');
      params.push(`%${search.replace(/[\\%_]/g, '\\$&')}%`);
      const name = `$${params.length}`;
      const byName = `EXISTS (SELECT 1 FROM guests g WHERE g.phone = l.phone AND g.deleted_at IS NULL AND g.name ILIKE ${name})`;
      if (digits) {
        params.push(`%${digits}%`);
        where.push(`(l.phone LIKE $${params.length} OR ${byName})`);
      } else where.push(byName);
    }
    const base = `
      WITH m AS (${MESSAGES_SQL}),
      l AS (
        SELECT DISTINCT ON (m.phone) m.phone, m.direction, m.type, m.meta_type, m.body, m.at,
               (SELECT count(*) FROM whatsapp_inbound u
                 WHERE u.from_phone = m.phone AND u.${UNREAD_SQL}) AS unread,
               (SELECT max(i.received_at) FROM whatsapp_inbound i
                 WHERE i.from_phone = m.phone) AS last_in
          FROM m
         ORDER BY m.phone, m.at DESC, m.id DESC)
      SELECT * FROM l ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;
    const [{ total }] = await this.dataSource.query<{ total: string }[]>(
      `SELECT count(*) AS total FROM (${base}) t`,
      params,
    );
    const rows = await this.dataSource.query<LastRow[]>(
      `${base} ORDER BY at DESC, phone LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, (page - 1) * limit],
    );
    const contacts = await this.contacts(rows.map((r) => r.phone));
    return {
      items: rows.map((r) => this.toConversation(r, contacts.get(r.phone))),
      meta: buildMeta(Number(total), page, limit),
    };
  }

  /** The conversation header and one page of its messages, newest first. */
  async conversation(
    id: string,
    page: number,
    limit: number,
  ): Promise<ConversationDetail> {
    const phone = toPhone(id);
    const header = await this.header(phone);
    const [{ total }] = await this.dataSource.query<{ total: string }[]>(
      `SELECT count(*) AS total FROM (${MESSAGES_SQL}) m WHERE m.phone = $1`,
      [phone],
    );
    const rows = await this.dataSource.query<MessageRow[]>(
      `SELECT m.id, m.direction, m.type, m.meta_type, m.body, m.button_payload, m.outcome,
              m.state, m.delivery_status, m.error_code, u.name AS sent_by_name,
              e.reference_code AS event_reference, m.at
         FROM (${MESSAGES_SQL}) m
         LEFT JOIN users u ON u.id = m.sent_by_user_id
         LEFT JOIN events e ON e.id = m.event_id
        WHERE m.phone = $1
        ORDER BY m.at DESC, m.id DESC
        LIMIT $2 OFFSET $3`,
      [phone, limit, (page - 1) * limit],
    );
    return {
      conversation: header,
      messages: rows.map((r) => ({
        id: r.id,
        direction: r.direction,
        type: r.type,
        metaType: r.meta_type,
        body: r.body,
        buttonPayload: r.button_payload,
        outcome: r.outcome,
        state: r.state,
        deliveryStatus: r.delivery_status,
        errorCode: r.error_code,
        sentByName: r.sent_by_name,
        eventReference: r.event_reference,
        at: new Date(r.at).toISOString(),
      })),
      meta: buildMeta(Number(total), page, limit),
    };
  }

  /** Marks every guest message of the number as read. */
  async markSeen(id: string): Promise<void> {
    const phone = toPhone(id);
    await this.dataSource.query(
      `UPDATE whatsapp_inbound SET seen_at = now()
        WHERE from_phone = $1 AND ${UNREAD_SQL}`,
      [phone],
    );
  }

  /** Conversations with at least one unread guest message (sidebar badge). */
  async unreadCount(): Promise<number> {
    const [{ count }] = await this.dataSource.query<{ count: string }[]>(
      `SELECT count(DISTINCT from_phone) AS count FROM whatsapp_inbound
        WHERE from_phone IS NOT NULL AND ${UNREAD_SQL}`,
    );
    return Number(count);
  }

  /**
   * Sends one free-form text to the number. Refused outside the window; a repeated `requestId`
   * returns the first attempt without sending again. Throws on a definite failure (the attempt
   * stays recorded); returns `UNKNOWN` as it is.
   */
  async send(
    actorUserId: string,
    id: string,
    dto: SendReplyDto,
  ): Promise<InboxMessageView> {
    const phone = toPhone(id);
    const repo = this.dataSource.getRepository(WhatsappReply);
    const earlier = await repo.findOneBy({ requestId: dto.requestId });
    if (earlier) return this.repeat(phone, earlier);

    const header = await this.header(phone);
    if (!this.client.isConfigured())
      throw serviceUnavailable('replies.not_configured');
    if (!header.replyWindowClosesAt)
      throw unprocessable('replies.window_closed');

    const inserted = await repo
      .createQueryBuilder()
      .insert()
      .values({
        eventId: header.eventId,
        guestId: header.guestId,
        sentByUserId: actorUserId,
        requestId: dto.requestId,
        toPhone: phone,
        body: dto.text,
      })
      .orIgnore()
      .returning(['id'])
      .execute();
    const replyId = (inserted.raw as Array<{ id: string }>)[0]?.id;
    if (!replyId) {
      // A concurrent submit with the same request id won the insert.
      const first = await repo.findOneByOrFail({ requestId: dto.requestId });
      return this.repeat(phone, first);
    }

    const result = await this.client.sendText(phone, dto.text);
    const state =
      result.outcome === 'SENT'
        ? WhatsappMessageState.SENT
        : result.outcome === 'UNKNOWN'
          ? WhatsappMessageState.UNKNOWN
          : WhatsappMessageState.FAILED; // RETRY too: the admin decides whether to write again
    await repo.update(replyId, {
      state,
      ...(result.outcome === 'SENT'
        ? { providerMessageId: result.messageId, sentAt: new Date() }
        : { errorCode: result.code.slice(0, 60) }),
      ...(state === WhatsappMessageState.FAILED && { failedAt: new Date() }),
    });
    // Answering a conversation reads it.
    await this.markSeen(id);
    await this.dataSource.manager.insert(AdminAction, {
      actorUserId,
      action: 'reply.send',
      targetType: header.guestId ? 'guest' : 'whatsapp_reply',
      targetId: header.guestId ?? replyId,
      summary: { replyId, eventId: header.eventId ?? undefined, state },
    });
    if (state === WhatsappMessageState.FAILED) {
      const code = result.outcome === 'SENT' ? null : result.code;
      this.logger.warn(`Reply ${replyId} failed: ${code}`);
      throw failure(code);
    }
    return this.message(replyId);
  }

  /** The same submit again: the first outcome, a failure included. */
  private async repeat(
    phone: string,
    reply: WhatsappReply,
  ): Promise<InboxMessageView> {
    if (reply.toPhone !== phone) throw notFound();
    if (reply.state === WhatsappMessageState.FAILED)
      throw failure(reply.errorCode);
    return this.message(reply.id);
  }

  private async message(replyId: string): Promise<InboxMessageView> {
    const [row] = await this.dataSource.query<MessageRow[]>(
      `SELECT r.id, r.body, r.state::text AS state, r.delivery_status::text AS delivery_status,
              r.error_code, u.name AS sent_by_name, e.reference_code AS event_reference,
              r.created_at AS at
         FROM whatsapp_replies r
         LEFT JOIN users u ON u.id = r.sent_by_user_id
         LEFT JOIN events e ON e.id = r.event_id
        WHERE r.id = $1`,
      [replyId],
    );
    return {
      id: row.id,
      direction: 'OUT',
      type: WhatsappInboundType.TEXT,
      metaType: 'text',
      body: row.body,
      buttonPayload: null,
      outcome: null,
      state: row.state,
      deliveryStatus: row.delivery_status,
      errorCode: row.error_code,
      sentByName: row.sent_by_name,
      eventReference: row.event_reference,
      at: new Date(row.at).toISOString(),
    };
  }

  private async header(phone: string): Promise<ConversationView> {
    const [row] = await this.dataSource.query<LastRow[]>(
      `SELECT m.phone, m.direction, m.type, m.meta_type, m.body, m.at,
              (SELECT count(*) FROM whatsapp_inbound u
                WHERE u.from_phone = $1 AND u.${UNREAD_SQL}) AS unread,
              (SELECT max(i.received_at) FROM whatsapp_inbound i
                WHERE i.from_phone = $1) AS last_in
         FROM (${MESSAGES_SQL}) m
        WHERE m.phone = $1
        ORDER BY m.at DESC, m.id DESC
        LIMIT 1`,
      [phone],
    );
    if (!row) throw notFound();
    const contacts = await this.contacts([phone]);
    return this.toConversation(row, contacts.get(phone));
  }

  /**
   * Phone → the guest it was most recently messaged as (the latest message tied to an event),
   * else the live guest of the latest event with that number.
   */
  private async contacts(
    phones: string[],
  ): Promise<Map<string, ConversationContact>> {
    if (!phones.length) return new Map();
    const rows = await this.dataSource.query<
      {
        phone: string;
        guest_id: string;
        guest_name: string;
        event_id: string;
        event_name: string;
        reference_code: string;
      }[]
    >(
      `SELECT DISTINCT ON (g.phone) g.phone, g.id AS guest_id, g.name AS guest_name,
              e.id AS event_id, e.name AS event_name, e.reference_code
         FROM guests g
         JOIN events e ON e.id = g.event_id
         LEFT JOIN LATERAL (
           SELECT max(w.created_at) AS last FROM whatsapp_messages w WHERE w.guest_id = g.id
         ) w ON true
        WHERE g.phone = ANY($1) AND g.deleted_at IS NULL
        ORDER BY g.phone, w.last DESC NULLS LAST, e.starts_at DESC`,
      [[...new Set(phones)]],
    );
    return new Map(
      rows.map((r) => [
        r.phone,
        {
          guestId: r.guest_id,
          guestName: r.guest_name,
          eventId: r.event_id,
          eventName: r.event_name,
          eventReference: r.reference_code,
        },
      ]),
    );
  }

  private toConversation(
    row: LastRow,
    contact: ConversationContact | undefined,
  ): ConversationView {
    const closes = row.last_in
      ? new Date(new Date(row.last_in).getTime() + WINDOW_MS)
      : null;
    return {
      id: row.phone.replace(/^\+/, ''),
      phone: row.phone,
      lastAt: new Date(row.at).toISOString(),
      lastDirection: row.direction,
      lastType: row.type,
      lastMetaType: row.meta_type,
      lastBody: row.body,
      unread: Number(row.unread),
      replyWindowClosesAt:
        closes && closes.getTime() > Date.now() ? closes.toISOString() : null,
      guestId: contact?.guestId ?? null,
      guestName: contact?.guestName ?? null,
      eventId: contact?.eventId ?? null,
      eventName: contact?.eventName ?? null,
      eventReference: contact?.eventReference ?? null,
    };
  }
}

/** URL id `9665…` → stored `+9665…`. */
function toPhone(id: string): string {
  if (!CONVERSATION_ID.test(id)) throw notFound();
  return `+${id}`;
}
