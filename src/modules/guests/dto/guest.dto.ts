import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../shared/pagination';
import { EventListStatus } from '../../events/entities/event.entity';
import {
  ImportCounts,
  ImportRowResult,
  GuestImport,
  GuestImportRow,
  GuestImportStatus,
} from '../entities/guest-import.entity';
import {
  Guest,
  GuestAllocationStatus,
  GuestKind,
  GuestRsvp,
  GuestSource,
} from '../entities/guest.entity';

/** Content rules (2–120 characters, Saudi mobile) are checked by `validateGuest`, as for imports. */
export class CreateGuestDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsString()
  @MaxLength(40)
  phone!: string;

  @IsOptional()
  @IsEnum(GuestKind)
  kind?: GuestKind;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  note?: string;
}

export class UpdateGuestDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsEnum(GuestKind)
  kind?: GuestKind;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  note?: string;
}

const toBool = ({ value }: { value: unknown }) =>
  value === true || value === 'true'
    ? true
    : value === false || value === 'false'
      ? false
      : value;

export class GuestsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(GuestKind)
  kind?: GuestKind;

  @IsOptional()
  @IsEnum(GuestRsvp)
  rsvp?: GuestRsvp;

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  admitted?: boolean;
}

export class ImportRowsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(ImportRowResult)
  result?: ImportRowResult;
}

export class SetListStatusDto {
  @IsIn([EventListStatus.IN_PROGRESS, EventListStatus.READY])
  status!: EventListStatus.IN_PROGRESS | EventListStatus.READY;
}

export interface GuestCounts {
  initial: number;
  reserve: number;
  allowance: number;
  extraMargin: number;
}

export interface AdminGuestView {
  id: string;
  name: string;
  phone: string | null;
  kind: GuestKind;
  source: GuestSource;
  allocationStatus: GuestAllocationStatus;
  rsvp: GuestRsvp;
  checkedInAt: Date | null;
  note: string | null;
  createdAt: Date;
  replacementForGuestId: string | null;
}

export interface OwnerGuestView {
  id: string;
  name: string;
  maskedPhone: string | null;
  kind: GuestKind;
  rsvp: GuestRsvp;
  admitted: boolean;
}

export const toAdminGuestView = (guest: Guest): AdminGuestView => ({
  id: guest.id,
  name: guest.name,
  phone: guest.phone,
  kind: guest.kind,
  source: guest.source,
  allocationStatus: guest.allocationStatus,
  rsvp: guest.rsvp,
  checkedInAt: guest.checkedInAt,
  note: guest.note,
  replacementForGuestId: guest.replacementForGuestId,
  createdAt: guest.createdAt,
});

/** `+9665•••••123` (api-contracts.md): owners never see a full number. */
export const maskPhone = (phone: string | null): string | null =>
  phone ? `${phone.slice(0, 5)}•••••${phone.slice(-3)}` : null;

export const toOwnerGuestView = (guest: Guest): OwnerGuestView => ({
  id: guest.id,
  name: guest.name,
  maskedPhone: maskPhone(guest.phone),
  kind: guest.kind,
  rsvp: guest.rsvp,
  admitted: guest.checkedInAt !== null,
});

export interface GuestImportView {
  id: string;
  fileName: string;
  status: GuestImportStatus;
  counts: ImportCounts;
  previewExpiresAt: Date;
  appliedAt: Date | null;
}

export const toGuestImportView = (row: GuestImport): GuestImportView => ({
  id: row.id,
  fileName: row.fileName,
  status: row.status,
  counts: row.counts,
  previewExpiresAt: row.previewExpiresAt,
  appliedAt: row.appliedAt,
});

export interface ImportRowView {
  rowNumber: number;
  rawName: string;
  rawPhone: string;
  name: string | null;
  phone: string | null;
  kind: GuestKind | null;
  result: ImportRowResult;
  reason: string | null;
}

export const toImportRowView = (row: GuestImportRow): ImportRowView => ({
  rowNumber: row.rowNumber,
  rawName: row.rawName,
  rawPhone: row.rawPhone,
  name: row.name,
  phone: row.phone,
  kind: row.kind,
  result: row.result,
  reason: row.reason,
});
