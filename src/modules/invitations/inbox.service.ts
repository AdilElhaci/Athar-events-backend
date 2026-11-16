import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import type { EnvironmentVariables } from '../../config/env.validation';
import {
  badRequest,
  notFound,
  serviceUnavailable,
  unprocessable,
} from '../../shared/exceptions/app.exception';
import { buildMeta, Paginated } from '../../shared/pagination';
import { AdminAction } from '../admin-actions/admin-action.entity';
import { detectImageType } from '../articles/article-image';
import {
  ConversationContact,
  ConversationDetail,
  ConversationsQueryDto,
  ConversationView,
  InboxMessageView,
  InboxTemplateView,
  SendAttachmentDto,
  SendReplyDto,
  SendTemplateDto,
} from './dto/inbox.dto';
import {
  InboundDetails,
  WhatsappInboundType,
} from './entities/whatsapp-inbound.entity';
import { WhatsappMediaState } from './entities/whatsapp-media.entity';
import { WhatsappMessageState } from './entities/whatsapp-message.entity';
import {
  ReplyMessageType,
  WhatsappReply,
} from './entities/whatsapp-reply.entity';
import { InboxMediaService } from './inbox-media.service';
import {
  MessageTemplate,
  SendOutcome,
  WhatsappClient,
} from './whatsapp/whatsapp.client';

/** Meta's customer-service window is 24 h from the last inbound message; same margin as the QR sender. */
const WINDOW_MS = 23 * 60 * 60 * 1000;
/** Meta: "more than 24 hours have passed since the customer last replied". */
const META_WINDOW_CLOSED = 'meta_131047';
const CONVERSATION_ID = /^\d{6,15}$/;
/** D-47 outbound limits (Meta: images 5 MB; documents up to 100 MB, capped lower here). */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 16 * 1024 * 1024;
const VARIABLE = /\{\{\s*(\d+)\s*\}\}/g;
/** Buttons that need nothing at send time when their URL has no variable. */
const STATIC_BUTTONS = new Set(['QUICK_REPLY', 'URL', 'PHONE_NUMBER']);

const failure = (code: string | null) =>
  unprocessable(
    code === META_WINDOW_CLOSED ? 'replies.window_closed' : 'replies.failed',
  );

/** Every message of every number, both directions; `$`-free so it can be embedded. */
const MESSAGES_SQL = `
  SELECT i.id, i.from_phone AS phone, 'IN' AS direction, i.type::text AS type, i.meta_type,
         i.body, i.button_payload, i.outcome::text AS outcome, NULL AS state,
         NULL AS delivery_status, NULL AS error_code, NULL AS sent_by_user_id, i.event_id,
         i.received_at AS at, i.details, NULL AS template_name, NULL AS template_category
    FROM whatsapp_inbound i
   WHERE i.from_phone IS NOT NULL
  UNION ALL
  SELECT r.id, r.to_phone, 'OUT', CASE WHEN r.message_type = 'text' THEN 'TEXT' ELSE 'OTHER' END,
         r.message_type, r.body, NULL, NULL, r.state::text, r.delivery_status::text,
         r.error_code, r.sent_by_user_id, r.event_id, r.created_at, NULL,
         r.template_name, r.template_category
    FROM whatsapp_replies r`;

/** One message with its sender, event and stored file; `m` is a row of MESSAGES_SQL. */
const MESSAGE_ROWS_SQL = `
  SELECT m.id, m.direction, m.type, m.meta_type, m.body, m.button_payload, m.outcome,
         m.state, m.delivery_status, m.error_code, u.name AS sent_by_name,
         e.reference_code AS event_reference, m.at, m.details, m.template_name,
         m.template_category, md.id AS media_id, md.state::text AS media_state,
         md.mime_type AS media_mime, md.file_name AS media_file_name,
         md.size_bytes AS media_size
    FROM (${MESSAGES_SQL}) m
    LEFT JOIN users u ON u.id = m.sent_by_user_id
    LEFT JOIN events e ON e.id = m.event_id
    LEFT JOIN whatsapp_media md
      ON (m.direction = 'IN' AND md.inbound_id = m.id)
      OR (m.direction = 'OUT' AND md.reply_id = m.id)`;

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
  details: InboundDetails | null;
  template_name: string | null;
  template_category: string | null;
  media_id: string | null;
  media_state: WhatsappMediaState | null;
  media_mime: string | null;
  media_file_name: string | null;
  media_size: number | null;
}

/** An uploaded file the inbox may send: checked by its bytes, not its name. */
export interface UploadedFile {
  buffer: Buffer;
  originalname?: string;
}

/** Highest {{n}} in the text: how many values a send must fill. */
export const variableCount = (text: string | null | undefined): number =>
  Math.max(0, ...[...(text ?? '').matchAll(VARIABLE)].map((m) => Number(m[1])));

/**
 * D-47: a template the inbox can send with body values only. Media headers, header variables,
 * dynamic URLs and other button kinds (copy code, flows) need inputs the inbox does not collect.
 */
export function inboxSendable(
  t: MessageTemplate,
  reservedName: string,
): boolean {
  return (
    t.status === 'APPROVED' &&
    (t.category === 'UTILITY' || t.category === 'MARKETING') &&
    t.name !== reservedName &&
    !!t.body &&
    (!t.headerFormat ||
      (t.headerFormat === 'TEXT' && variableCount(t.headerText) === 0)) &&
    !t.dynamicUrlButton &&
    (t.buttonTypes ?? []).every((type) => STATIC_BUTTONS.has(type))
  );
}

/** Meta refuses parameters with new lines, tabs or more than four consecutive spaces. */
const parameterValid = (value: string) =>
  value.trim().length > 0 && !/[\n\r\t]/.test(value) && !/ {5,}/.test(value);

/**
 * D-45 WhatsApp inbox: one conversation per phone number across all events, guests or not.
 * Admins read what numbers sent (D-43, media and locations D-47) and reply inside Meta's 24 h
 * window with text, an image or a PDF (D-44, D-47), or send an approved template at any time,
 * also to a number that never wrote (D-47). Every send happens once per `requestId` and is never
 * retried; `UNKNOWN` stays as it is.
 */
@Injectable()
export class InboxService {
  private readonly logger = new Logger(InboxService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly client: WhatsappClient,
    private readonly media: InboxMediaService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
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
      `${MESSAGE_ROWS_SQL}
        WHERE m.phone = $1
        ORDER BY m.at DESC, m.id DESC
        LIMIT $2 OFFSET $3`,
      [phone, limit, (page - 1) * limit],
    );
    return {
      conversation: header,
      messages: rows.map(toMessageView),
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

  /** D-47: approved templates the inbox can send, as Meta reports them now. */
  async templates(): Promise<InboxTemplateView[]> {
    const templates = await this.sendableTemplates();
    return templates
      .map((t) => ({
        name: t.name,
        language: t.language,
        category: t.category,
        headerText: t.headerText ?? null,
        body: t.body ?? '',
        footer: t.footer ?? null,
        buttons: t.buttons,
        variables: variableCount(t.body),
      }))
      .sort(
        (a, b) =>
          a.name.localeCompare(b.name) || a.language.localeCompare(b.language),
      );
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
    const earlier = await this.earlier(phone, dto.requestId);
    if (earlier) return earlier;
    const header = await this.openWindow(phone);
    return this.deliver(actorUserId, phone, {
      requestId: dto.requestId,
      messageType: 'text',
      body: dto.text,
      contact: header,
      action: 'reply.send',
      send: () => this.client.sendText(phone, dto.text),
    });
  }

  /** D-47: one image (JPEG, PNG) or PDF inside the window, with an optional caption. */
  async sendAttachment(
    actorUserId: string,
    id: string,
    dto: SendAttachmentDto,
    file: UploadedFile | undefined,
  ): Promise<InboxMessageView> {
    const phone = toPhone(id);
    const earlier = await this.earlier(phone, dto.requestId);
    if (earlier) return earlier;
    if (!file?.buffer?.length) throw badRequest('replies.file_invalid');
    const image = detectImageType(file.buffer);
    const isPdf = file.buffer.subarray(0, 5).toString('latin1') === '%PDF-';
    if (image !== 'image/jpeg' && image !== 'image/png' && !isPdf)
      throw badRequest('replies.file_invalid');
    if (file.buffer.length > (isPdf ? MAX_DOCUMENT_BYTES : MAX_IMAGE_BYTES))
      throw badRequest('replies.file_too_large');
    const header = await this.openWindow(phone);

    const mimeType = isPdf ? 'application/pdf' : image!;
    const fileName = safeFileName(file.originalname, isPdf);
    const caption = dto.caption || undefined;
    return this.deliver(actorUserId, phone, {
      requestId: dto.requestId,
      messageType: isPdf ? 'document' : 'image',
      body: caption ?? null,
      contact: header,
      action: 'reply.attachment',
      send: async (replyId) => {
        const upload = await this.client.uploadMedia(
          file.buffer,
          mimeType,
          fileName,
        );
        // Kept even when the upload fails, so the thread shows what was attempted.
        await this.media.recordOutbound(
          replyId,
          { data: file.buffer, mimeType, fileName },
          upload.ok ? upload.mediaId : null,
        );
        // Nothing reached the guest: a definite failure, the admin decides whether to try again.
        if (!upload.ok) return { outcome: 'FAILED', code: upload.code };
        return isPdf
          ? this.client.sendDocument(phone, upload.mediaId, fileName, caption)
          : this.client.sendImage(phone, upload.mediaId, caption ?? '');
      },
    });
  }

  /**
   * D-47: an approved template, open window or not, also to a number that never wrote. The
   * template is re-read from Meta so a paused or rejected one is never sent.
   */
  async sendTemplate(
    actorUserId: string,
    id: string,
    dto: SendTemplateDto,
  ): Promise<InboxMessageView> {
    const phone = toPhone(id);
    const earlier = await this.earlier(phone, dto.requestId);
    if (earlier) return earlier;
    if (!this.client.isConfigured())
      throw serviceUnavailable('replies.not_configured');
    const template = (await this.sendableTemplates()).find(
      (t) => t.name === dto.name && t.language === dto.language,
    );
    if (!template) throw unprocessable('replies.template_not_found');
    if (
      dto.parameters.length !== variableCount(template.body) ||
      !dto.parameters.every(parameterValid)
    )
      throw badRequest('replies.template_parameters');

    const parameters = dto.parameters.map((p) => p.trim());
    const body = [
      template.headerText,
      (template.body ?? '').replace(
        VARIABLE,
        (match, n: string) => parameters[Number(n) - 1] ?? match,
      ),
      template.footer,
    ]
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 4096);
    const contact = (await this.contacts([phone])).get(phone);
    return this.deliver(actorUserId, phone, {
      requestId: dto.requestId,
      messageType: 'template',
      body,
      template: {
        name: template.name,
        language: template.language,
        category: template.category,
      },
      contact: {
        eventId: contact?.eventId ?? null,
        guestId: contact?.guestId ?? null,
      },
      action: 'reply.template',
      send: () =>
        this.client.sendTemplate(phone, {
          name: template.name,
          language: template.language,
          bodyParameters: parameters,
          quickReplyPayloads: [],
        }),
    });
  }

  /**
   * Records the attempt, sends it once and records the outcome. A concurrent submit with the same
   * request id returns the first attempt. Throws on a definite failure; `UNKNOWN` is returned.
   */
  private async deliver(
    actorUserId: string,
    phone: string,
    attempt: {
      requestId: string;
      messageType: ReplyMessageType;
      body: string | null;
      template?: { name: string; language: string; category: string };
      contact: { eventId: string | null; guestId: string | null };
      action: string;
      send: (replyId: string) => Promise<SendOutcome>;
    },
  ): Promise<InboxMessageView> {
    const repo = this.dataSource.getRepository(WhatsappReply);
    const inserted = await repo
      .createQueryBuilder()
      .insert()
      .values({
        eventId: attempt.contact.eventId,
        guestId: attempt.contact.guestId,
        sentByUserId: actorUserId,
        requestId: attempt.requestId,
        toPhone: phone,
        messageType: attempt.messageType,
        body: attempt.body,
        templateName: attempt.template?.name ?? null,
        templateLanguage: attempt.template?.language ?? null,
        templateCategory: attempt.template?.category.slice(0, 20) ?? null,
      })
      .orIgnore()
      .returning(['id'])
      .execute();
    const replyId = (inserted.raw as Array<{ id: string }>)[0]?.id;
    if (!replyId) {
      // A concurrent submit with the same request id won the insert.
      const first = await repo.findOneByOrFail({
        requestId: attempt.requestId,
      });
      return this.repeat(phone, first);
    }

    const result = await attempt.send(replyId);
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
    await this.markSeen(phone.slice(1));
    await this.dataSource.manager.insert(AdminAction, {
      actorUserId,
      action: attempt.action,
      targetType: attempt.contact.guestId ? 'guest' : 'whatsapp_reply',
      targetId: attempt.contact.guestId ?? replyId,
      summary: {
        replyId,
        eventId: attempt.contact.eventId ?? undefined,
        state,
        type: attempt.messageType,
        template: attempt.template?.name,
      },
    });
    if (state === WhatsappMessageState.FAILED) {
      const code = result.outcome === 'SENT' ? null : result.code;
      this.logger.warn(`Reply ${replyId} failed: ${code}`);
      throw failure(code);
    }
    return this.message(replyId);
  }

  /** The first attempt of a repeated `requestId`, or null when it is new. */
  private async earlier(
    phone: string,
    requestId: string,
  ): Promise<InboxMessageView | null> {
    const reply = await this.dataSource
      .getRepository(WhatsappReply)
      .findOneBy({ requestId });
    return reply ? this.repeat(phone, reply) : null;
  }

  /** The conversation, when free-form messages are allowed now (D-44 window). */
  private async openWindow(phone: string): Promise<ConversationView> {
    const header = await this.header(phone);
    if (!this.client.isConfigured())
      throw serviceUnavailable('replies.not_configured');
    if (!header.replyWindowClosesAt)
      throw unprocessable('replies.window_closed');
    return header;
  }

  private async sendableTemplates(): Promise<MessageTemplate[]> {
    if (!this.client.canListTemplates())
      throw serviceUnavailable('replies.not_configured');
    const result = await this.client.listTemplates();
    if (!result.ok) {
      this.logger.warn(`Template list failed: ${result.code}`);
      throw serviceUnavailable('whatsapp.templates_unavailable');
    }
    const reserved = this.config.get('WHATSAPP_INVITATION_TEMPLATE', {
      infer: true,
    });
    return result.templates.filter((t) => inboxSendable(t, reserved));
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
      `${MESSAGE_ROWS_SQL} WHERE m.direction = 'OUT' AND m.id = $1`,
      [replyId],
    );
    return toMessageView(row);
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

function toMessageView(r: MessageRow): InboxMessageView {
  return {
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
    details: r.details,
    media: r.media_id
      ? {
          id: r.media_id,
          state: r.media_state!,
          mimeType: r.media_mime ?? 'application/octet-stream',
          fileName: r.media_file_name,
          sizeBytes: r.media_size === null ? null : Number(r.media_size),
        }
      : null,
    templateName: r.template_name,
    templateCategory: r.template_category,
  };
}

/** A name WhatsApp shows the guest: the admin's file name without paths or odd characters. */
function safeFileName(name: string | undefined, pdf: boolean): string {
  const ext = pdf ? '.pdf' : '';
  const base = (name ?? '')
    .split(/[\\/]/)
    .pop()!
    .replace(/["<>|:*?]/g, '')
    .replace(/\p{Cc}/gu, '')
    .trim()
    .slice(0, 120);
  if (!base) return pdf ? 'file.pdf' : 'image';
  return pdf && !base.toLowerCase().endsWith('.pdf') ? `${base}${ext}` : base;
}

/** URL id `9665…` → stored `+9665…`. */
function toPhone(id: string): string {
  if (!CONVERSATION_ID.test(id)) throw notFound();
  return `+${id}`;
}
