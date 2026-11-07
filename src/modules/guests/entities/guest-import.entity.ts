import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { GuestKind } from './guest.entity';

export enum GuestImportStatus {
  PREVIEWED = 'PREVIEWED',
  APPLIED = 'APPLIED',
  EXPIRED = 'EXPIRED',
}

export enum ImportRowResult {
  VALID = 'VALID',
  INVALID = 'INVALID',
  DUPLICATE_IN_FILE = 'DUPLICATE_IN_FILE',
  DUPLICATE_EXISTING = 'DUPLICATE_EXISTING',
  OVER_LIMIT = 'OVER_LIMIT',
}

export interface ImportCounts {
  total: number;
  valid: number;
  invalid: number;
  duplicateInFile: number;
  duplicateExisting: number;
  overLimit: number;
  /** Set on apply. */
  created?: number;
  skipped?: number;
}

/** One uploaded sheet. The file itself is parsed in memory and never stored (SP-03 §7). */
@Entity({ name: 'guest_imports' })
@Index('IDX_guest_imports_event_id', ['eventId'])
export class GuestImport {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'event_id', type: 'uuid' })
  eventId!: string;

  @Column({ name: 'file_name', type: 'varchar', length: 120 })
  fileName!: string;

  @Column({ name: 'file_sha256', type: 'varchar', length: 64 })
  fileSha256!: string;

  @Column({
    type: 'enum',
    enum: GuestImportStatus,
    enumName: 'guest_import_status',
    default: GuestImportStatus.PREVIEWED,
  })
  status!: GuestImportStatus;

  @Column({ type: 'jsonb' })
  counts!: ImportCounts;

  @Column({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId!: string;

  @Column({ name: 'applied_by_user_id', type: 'uuid', nullable: true })
  appliedByUserId!: string | null;

  @Column({ name: 'applied_at', type: 'timestamptz', nullable: true })
  appliedAt!: Date | null;

  @Column({ name: 'preview_expires_at', type: 'timestamptz' })
  previewExpiresAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

@Entity({ name: 'guest_import_rows' })
@Index('IDX_guest_import_rows_import_id_row_number', ['importId', 'rowNumber'])
export class GuestImportRow {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'import_id', type: 'uuid' })
  importId!: string;

  /** The sheet row (header = 1). */
  @Column({ name: 'row_number', type: 'int' })
  rowNumber!: number;

  /** As typed, formula-neutralised and shortened; shown only to admins. */
  @Column({ name: 'raw_name', type: 'varchar', length: 160 })
  rawName!: string;

  @Column({ name: 'raw_phone', type: 'varchar', length: 40 })
  rawPhone!: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  name!: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  phone!: string | null;

  @Column({
    type: 'enum',
    enum: GuestKind,
    enumName: 'guest_kind',
    nullable: true,
  })
  kind!: GuestKind | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  note!: string | null;

  @Column({
    type: 'enum',
    enum: ImportRowResult,
    enumName: 'guest_import_row_result',
  })
  result!: ImportRowResult;

  /** Message key (`imports.row.*`) for INVALID rows. */
  @Column({ type: 'varchar', length: 60, nullable: true })
  reason!: string | null;
}
