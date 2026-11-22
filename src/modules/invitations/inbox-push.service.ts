import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { REDIS } from '../auth/services/rate-limit.service';
import { PushService } from '../push/push.service';
import { InboundDetails } from './entities/whatsapp-inbound.entity';

/** One notification per conversation in this window; later ones replace it on the device anyway. */
const COOLDOWN_SECONDS = 30;
const PREVIEW_MAX = 120;

const TYPE_LABEL: Record<string, string> = {
  image: '📷 صورة',
  video: '🎥 فيديو',
  audio: '🎤 رسالة صوتية',
  document: '📄 ملف',
  sticker: 'ملصق',
  location: '📍 موقع',
  contacts: '👤 جهة اتصال',
};

interface Row {
  from_phone: string;
  body: string | null;
  meta_type: string | null;
  details: InboundDetails | null;
  guest_name: string | null;
}

/** The text of the notification: the caption or message, else what kind of message it is. */
export function previewOf(row: Pick<Row, 'body' | 'meta_type' | 'details'>) {
  const body = row.body?.replace(/\s+/g, ' ').trim();
  if (body)
    return body.length > PREVIEW_MAX
      ? `${body.slice(0, PREVIEW_MAX - 1)}…`
      : body;
  if (row.details?.kind === 'reaction')
    return `تفاعل ${row.details.emoji ?? ''}`.trim();
  return TYPE_LABEL[row.meta_type ?? ''] ?? 'رسالة جديدة';
}

/**
 * Tells the admins' devices about a new inbox message (D-45) by Web Push. Runs after the webhook
 * committed and after the auto-reply menu had its turn: only a message that is still unread (what
 * the sidebar badge counts) is announced, so a message the bot answered stays quiet and a
 * handoff to the team rings. Never throws; never logs a phone or a text.
 */
@Injectable()
export class InboxPushService {
  private readonly logger = new Logger(InboxPushService.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly push: PushService,
  ) {}

  async onInbound(inboundId: string): Promise<void> {
    if (!this.push.publicKey()) return;
    try {
      const [row] = await this.db.query<Row[]>(
        `SELECT i.from_phone, i.body, i.meta_type, i.details, g.name AS guest_name
           FROM whatsapp_inbound i
           LEFT JOIN guests g ON g.id = i.guest_id
          WHERE i.id = $1 AND i.from_phone IS NOT NULL
            AND i.seen_at IS NULL AND i.type <> 'BUTTON'`,
        [inboundId],
      );
      if (!row) return;
      const digits = row.from_phone.replace(/^\+/, '');
      const fresh = await this.redis.set(
        `push:inbox:${digits}`,
        '1',
        'EX',
        COOLDOWN_SECONDS,
        'NX',
      );
      if (!fresh) return;
      await this.push.sendToAdmins(
        {
          title: row.guest_name ?? row.from_phone,
          body: previewOf(row),
          url: `/dashboard/inbox?c=${digits}`,
          tag: `inbox-${digits}`,
        },
        `inbox${digits}`,
      );
    } catch (error) {
      this.logger.warn(`Inbox push failed: ${(error as Error).name}`);
    }
  }
}
