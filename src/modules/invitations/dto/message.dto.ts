import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../shared/pagination';
import {
  WhatsappDeliveryStatus,
  WhatsappMessage,
  WhatsappMessageKind,
  WhatsappMessageState,
} from '../entities/whatsapp-message.entity';

const toBool = ({ value }: { value: unknown }) =>
  value === true || value === 'true'
    ? true
    : value === false || value === 'false'
      ? false
      : value;

export class MessagesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(WhatsappMessageState)
  state?: WhatsappMessageState;

  @IsOptional()
  @IsEnum(WhatsappDeliveryStatus)
  delivery?: WhatsappDeliveryStatus;

  @IsOptional()
  @IsEnum(WhatsappMessageKind)
  kind?: WhatsappMessageKind;

  /** `UNKNOWN` or `FAILED` and not resolved yet. */
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  needsAction?: boolean;
}

export const RESOLUTIONS = ['MARK_SENT', 'MARK_FAILED', 'RESEND'] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

export class ResolveMessageDto {
  @IsIn(RESOLUTIONS)
  resolution!: Resolution;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason!: string;
}

export interface MessageView {
  id: string;
  guestId: string;
  guestName: string | null;
  guestPhone: string | null;
  kind: WhatsappMessageKind;
  state: WhatsappMessageState;
  deliveryStatus: WhatsappDeliveryStatus;
  attemptCount: number;
  lastErrorCode: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  failedAt: string | null;
  resolution: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const iso = (date: Date | null) => date?.toISOString() ?? null;

export const toMessageView = (
  message: WhatsappMessage,
  guest: { name: string; phone: string | null } | null,
): MessageView => ({
  id: message.id,
  guestId: message.guestId,
  guestName: guest?.name ?? null,
  guestPhone: guest?.phone ?? null,
  kind: message.kind,
  state: message.state,
  deliveryStatus: message.deliveryStatus,
  attemptCount: message.attemptCount,
  lastErrorCode: message.lastErrorCode,
  sentAt: iso(message.sentAt),
  deliveredAt: iso(message.deliveredAt),
  readAt: iso(message.readAt),
  failedAt: iso(message.failedAt),
  resolution: message.resolution,
  resolvedAt: iso(message.resolvedAt),
  createdAt: message.createdAt.toISOString(),
  updatedAt: message.updatedAt.toISOString(),
});
