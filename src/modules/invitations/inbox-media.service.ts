import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { notFound } from '../../shared/exceptions/app.exception';
import {
  WhatsappMedia,
  WhatsappMediaState,
} from './entities/whatsapp-media.entity';
import { WhatsappClient } from './whatsapp/whatsapp.client';

/** D-47: the largest file kept (Meta's own cap for video and audio). */
export const MAX_MEDIA_BYTES = 16 * 1024 * 1024;
/** Attempts before an inbound download is given up. */
const MAX_ATTEMPTS = 5;
/** A claim older than this is considered abandoned (process restarted mid-download). */
const CLAIM_TTL = `2 minutes`;
/** Meta keeps inbound media for about 30 days; we stop trying well before. */
const GIVE_UP_AFTER = `7 days`;

/** Shown in the browser as-is; anything else is downloaded as a file. */
const INLINE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/3gpp',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
  'audio/amr',
]);

export interface InboundMediaInfo {
  metaMediaId: string;
  mimeType: string;
  fileName: string | null;
}

export interface StoredFile {
  data: Buffer;
  /** Safe to send as Content-Type. */
  contentType: string;
  /** Show inline (image, video, audio) or download as a file. */
  inline: boolean;
  fileName: string;
}

/** Bare `type/subtype`, lowercase; anything odd becomes a generic binary type. */
const cleanMime = (value: string | null | undefined): string => {
  const base = (value ?? '').split(';')[0].trim().toLowerCase();
  return /^[a-z]+\/[a-z0-9.+-]{1,80}$/.test(base)
    ? base
    : 'application/octet-stream';
};

/**
 * D-47 media of the inbox. Inbound media is recorded `PENDING` with the message and downloaded
 * after commit; the sweeper retries what is left. Claims are conditional updates, so two processes
 * never download the same file. Bytes are never logged.
 */
@Injectable()
export class InboxMediaService {
  private readonly logger = new Logger(InboxMediaService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly client: WhatsappClient,
  ) {}

  /** Inside the webhook transaction: one pending download for the message. */
  async recordInbound(
    manager: EntityManager,
    inboundId: string,
    info: InboundMediaInfo,
  ): Promise<string | null> {
    const inserted = await manager
      .createQueryBuilder()
      .insert()
      .into(WhatsappMedia)
      .values({
        inboundId,
        metaMediaId: info.metaMediaId,
        mimeType: cleanMime(info.mimeType),
        fileName: info.fileName?.slice(0, 255) ?? null,
      })
      .orIgnore()
      .returning(['id'])
      .execute();
    return (inserted.raw as Array<{ id: string }>)[0]?.id ?? null;
  }

  /** What the admin uploaded and sent, kept so the thread can show it. */
  async recordOutbound(
    replyId: string,
    file: { data: Buffer; mimeType: string; fileName: string },
    metaMediaId: string | null,
  ): Promise<void> {
    await this.dataSource.getRepository(WhatsappMedia).insert({
      replyId,
      metaMediaId,
      mimeType: file.mimeType,
      fileName: file.fileName.slice(0, 255),
      sizeBytes: file.data.length,
      data: file.data,
      state: WhatsappMediaState.STORED,
      storedAt: new Date(),
    });
  }

  /** Downloads one pending file if nobody else holds it. Never throws. */
  async download(id: string): Promise<void> {
    try {
      await this.downloadOnce(id);
    } catch (error) {
      this.logger.warn(`Media ${id} download failed: ${(error as Error).name}`);
    }
  }

  /** Sweeper: pending downloads that are free to claim, oldest first. */
  async retryPending(limit: number): Promise<number> {
    await this.dataSource.query(
      `UPDATE whatsapp_media SET state = 'FAILED', error_code = 'gave_up', claimed_at = NULL
        WHERE state = 'PENDING' AND created_at < now() - interval '${GIVE_UP_AFTER}'`,
    );
    const rows = await this.dataSource.query<{ id: string }[]>(
      `SELECT id FROM whatsapp_media
        WHERE state = 'PENDING' AND attempts < $1
          AND (claimed_at IS NULL OR claimed_at < now() - interval '${CLAIM_TTL}')
        ORDER BY created_at
        LIMIT $2`,
      [MAX_ATTEMPTS, limit],
    );
    for (const { id } of rows) await this.download(id);
    return rows.length;
  }

  /** The stored bytes for the admin; 404 unless stored. */
  async file(id: string): Promise<StoredFile> {
    const media = await this.dataSource
      .getRepository(WhatsappMedia)
      .createQueryBuilder('m')
      .addSelect('m.data')
      .where('m.id = :id AND m.state = :state', {
        id,
        state: WhatsappMediaState.STORED,
      })
      .getOne();
    if (!media?.data) throw notFound();
    const inline = INLINE_TYPES.has(media.mimeType);
    return {
      data: media.data,
      contentType: inline ? media.mimeType : cleanMime(media.mimeType),
      inline,
      fileName: media.fileName ?? defaultName(media.mimeType),
    };
  }

  private async downloadOnce(id: string): Promise<void> {
    // An UPDATE … RETURNING through TypeORM answers [rows, affected].
    const [[claimed]] = await this.dataSource.query<
      [Array<{ meta_media_id: string | null; attempts: number }>, number]
    >(
      `UPDATE whatsapp_media SET attempts = attempts + 1, claimed_at = now()
        WHERE id = $1 AND state = 'PENDING' AND attempts < $2
          AND (claimed_at IS NULL OR claimed_at < now() - interval '${CLAIM_TTL}')
      RETURNING meta_media_id, attempts`,
      [id, MAX_ATTEMPTS],
    );
    if (!claimed) return; // stored, given up, or another process has it
    if (!claimed.meta_media_id) {
      await this.finish(id, WhatsappMediaState.FAILED, { code: 'no_media_id' });
      return;
    }
    const result = await this.client.downloadMedia(
      claimed.meta_media_id,
      MAX_MEDIA_BYTES,
    );
    if (result.ok) {
      await this.dataSource.query(
        `UPDATE whatsapp_media
            SET state = 'STORED', data = $2, size_bytes = $3, stored_at = now(),
                mime_type = CASE WHEN mime_type = 'application/octet-stream' THEN $4 ELSE mime_type END,
                claimed_at = NULL, error_code = NULL
          WHERE id = $1 AND state = 'PENDING'`,
        [id, result.data, result.data.length, cleanMime(result.mimeType)],
      );
      return;
    }
    if (result.tooLarge) {
      await this.finish(id, WhatsappMediaState.TOO_LARGE, {
        size: result.size,
        code: 'too_large',
      });
      return;
    }
    const last = !result.retry || claimed.attempts >= MAX_ATTEMPTS;
    this.logger.warn(`Media ${id} download: ${result.code}`);
    await this.finish(
      id,
      last ? WhatsappMediaState.FAILED : WhatsappMediaState.PENDING,
      { code: result.code },
    );
  }

  private async finish(
    id: string,
    state: WhatsappMediaState,
    extra: { code: string; size?: number | null },
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE whatsapp_media
          SET state = $2::whatsapp_media_state, error_code = $3,
              size_bytes = COALESCE($4, size_bytes), claimed_at = NULL
        WHERE id = $1 AND state = 'PENDING'`,
      [id, state, extra.code.slice(0, 60), extra.size ?? null],
    );
  }
}

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'application/pdf': 'pdf',
};

const defaultName = (mime: string) => `file.${EXTENSIONS[mime] ?? 'bin'}`;
