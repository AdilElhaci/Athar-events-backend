import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  IsNull,
  LessThan,
  Repository,
} from 'typeorm';
import { conflict, notFound } from '../../shared/exceptions/app.exception';
import { Event } from '../events/entities/event.entity';
import { ImportRowsQueryDto } from './dto/guest.dto';
import {
  GuestImport,
  GuestImportRow,
  GuestImportStatus,
  ImportCounts,
  ImportRowResult,
} from './entities/guest-import.entity';
import { Guest, GuestKind, GuestSource } from './entities/guest.entity';
import {
  audit,
  isUniqueViolation,
  liveCounts,
  lockWritableEvent,
  markInProgress,
} from './guests.service';
import { parseGuestSheet } from './utils/guest-sheet';

const PREVIEW_TTL_MS = 30 * 60_000;
const DAY_MS = 86_400_000;
const CHUNK = 500;

const RESULT_KEY: Record<ImportRowResult, keyof ImportCounts> = {
  VALID: 'valid',
  INVALID: 'invalid',
  DUPLICATE_IN_FILE: 'duplicateInFile',
  DUPLICATE_EXISTING: 'duplicateExisting',
  OVER_LIMIT: 'overLimit',
};

const CONTROL_OR_BIDI = /[\p{Cc}\p{Cf}]/gu;

/** Shown in the admin UI only; strips paths and control characters from the client's name. */
const safeFileName = (name: string | undefined) =>
  (name ?? 'guests.xlsx')
    .split(/[\\/]/)
    .pop()!
    .replace(CONTROL_OR_BIDI, '')
    .slice(0, 120) || 'guests.xlsx';

/**
 * Preview → review → apply (SP-03 §4). The preview stores classified rows and adds nothing; apply
 * re-checks every valid row against the list as it is now, under the event lock, so two imports
 * (or an import and manual entry) can never exceed the allowance together (TC-IMP-07).
 */
@Injectable()
export class GuestImportService {
  private readonly logger = new Logger(GuestImportService.name);

  constructor(
    @InjectRepository(GuestImport)
    private readonly imports: Repository<GuestImport>,
    @InjectRepository(GuestImportRow)
    private readonly rows: Repository<GuestImportRow>,
    private readonly dataSource: DataSource,
  ) {}

  async preview(
    actorUserId: string,
    eventId: string,
    file: { buffer: Buffer; originalname?: string },
  ): Promise<GuestImport> {
    const parsed = await parseGuestSheet(file.buffer);
    return this.dataSource.transaction(async (manager) => {
      const event = await lockWritableEvent(manager, eventId);
      const taken = await livePhones(manager, eventId);
      const room = await roomLeft(manager, event);
      const seen = new Set<string>();
      const counts: ImportCounts = {
        total: parsed.length,
        valid: 0,
        invalid: 0,
        duplicateInFile: 0,
        duplicateExisting: 0,
        overLimit: 0,
      };

      const classified = parsed.map((row) => {
        let result: ImportRowResult;
        if (row.reason) result = ImportRowResult.INVALID;
        else if (seen.has(row.phone!))
          result = ImportRowResult.DUPLICATE_IN_FILE;
        else if (taken.has(row.phone!))
          result = ImportRowResult.DUPLICATE_EXISTING;
        else if (room[row.kind!] <= 0) result = ImportRowResult.OVER_LIMIT;
        else {
          result = ImportRowResult.VALID;
          room[row.kind!] -= 1;
        }
        if (row.phone) seen.add(row.phone);
        (counts[RESULT_KEY[result]] as number) += 1;
        return { ...row, result };
      });

      const saved = await manager.save(
        manager.create(GuestImport, {
          eventId,
          fileName: safeFileName(file.originalname),
          fileSha256: createHash('sha256').update(file.buffer).digest('hex'),
          counts,
          createdByUserId: actorUserId,
          previewExpiresAt: new Date(Date.now() + PREVIEW_TTL_MS),
        }),
      );
      for (let i = 0; i < classified.length; i += CHUNK)
        await manager.insert(
          GuestImportRow,
          classified.slice(i, i + CHUNK).map((row) => ({
            importId: saved.id,
            rowNumber: row.rowNumber,
            rawName: row.rawName,
            rawPhone: row.rawPhone,
            name: row.name,
            phone: row.phone,
            kind: row.kind,
            note: row.note,
            result: row.result,
            reason: row.reason,
          })),
        );
      return saved;
    });
  }

  async get(eventId: string, importId: string): Promise<GuestImport> {
    const found = await this.imports.findOneBy({ id: importId, eventId });
    if (!found) throw notFound();
    return found;
  }

  async listRows(
    eventId: string,
    importId: string,
    { page, limit, result }: ImportRowsQueryDto,
  ): Promise<[GuestImportRow[], number]> {
    await this.get(eventId, importId);
    return this.rows.findAndCount({
      where: { importId, ...(result ? { result } : {}) },
      order: { rowNumber: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });
  }

  /** Idempotent: a second call returns the first result and adds nothing (TC-IMP-04). */
  async apply(
    actorUserId: string,
    eventId: string,
    importId: string,
  ): Promise<GuestImport> {
    return this.dataSource.transaction(async (manager) => {
      const event = await lockWritableEvent(manager, eventId);
      const found = await manager.findOne(GuestImport, {
        where: { id: importId, eventId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!found) throw notFound();
      if (found.status === GuestImportStatus.APPLIED) return found;
      if (
        found.status === GuestImportStatus.EXPIRED ||
        found.previewExpiresAt.getTime() < Date.now()
      )
        throw conflict('imports.expired');

      const valid = await manager.find(GuestImportRow, {
        where: { importId, result: ImportRowResult.VALID },
        order: { rowNumber: 'ASC' },
      });
      // The list may have changed since the preview: check each row again.
      const taken = await livePhones(manager, eventId);
      const room = await roomLeft(manager, event);
      const fitting = valid.filter((row) => {
        if (taken.has(row.phone!) || room[row.kind!] <= 0) return false;
        taken.add(row.phone!);
        room[row.kind!] -= 1;
        return true;
      });
      try {
        for (let i = 0; i < fitting.length; i += CHUNK)
          await manager.insert(
            Guest,
            fitting.slice(i, i + CHUNK).map((row) => ({
              eventId,
              name: row.name!,
              phone: row.phone!,
              kind: row.kind!,
              note: row.note,
              source: GuestSource.IMPORT,
              importId,
            })),
          );
      } catch (error) {
        if (isUniqueViolation(error)) throw conflict('guests.phone_duplicate');
        throw error;
      }

      found.status = GuestImportStatus.APPLIED;
      found.appliedByUserId = actorUserId;
      found.appliedAt = new Date();
      found.counts = {
        ...found.counts,
        created: fitting.length,
        skipped: valid.length - fitting.length,
      };
      await manager.save(found);
      if (fitting.length) await markInProgress(manager, event);
      await audit(manager, actorUserId, 'guests.import_apply', eventId, {
        importId,
        created: fitting.length,
        skipped: valid.length - fitting.length,
        rows: found.counts.total,
      });
      return found;
    });
  }

  /** Row data holds names and phones: applied imports keep it 7 days, unused previews 1 day. */
  @Cron(CronExpression.EVERY_HOUR, { name: 'guest-imports-cleanup' })
  async cleanup(): Promise<void> {
    try {
      const now = Date.now();
      const applied = await this.imports.delete({
        status: GuestImportStatus.APPLIED,
        appliedAt: LessThan(new Date(now - 7 * DAY_MS)),
      });
      const stale = await this.imports.delete({
        appliedAt: IsNull(),
        createdAt: LessThan(new Date(now - DAY_MS)),
      });
      const removed = (applied.affected ?? 0) + (stale.affected ?? 0);
      if (removed) this.logger.log(`removed ${removed} guest imports`);
    } catch (error) {
      this.logger.error(
        `cleanup failed: ${error instanceof Error ? error.name : 'unknown'}`,
      );
    }
  }
}

async function livePhones(
  manager: EntityManager,
  eventId: string,
): Promise<Set<string>> {
  const rows = await manager.find(Guest, {
    select: { phone: true },
    where: { eventId, deletedAt: IsNull() },
  });
  return new Set(rows.map((g) => g.phone).filter((p): p is string => !!p));
}

async function roomLeft(
  manager: EntityManager,
  event: Event,
): Promise<Record<GuestKind, number>> {
  const counts = await liveCounts(manager, event.id);
  return {
    [GuestKind.INITIAL]: event.invitationAllowance - counts.initial,
    [GuestKind.RESERVE]: event.extraMargin - counts.reserve,
  };
}
