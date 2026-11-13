import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../shared/pagination';
import {
  WhatsappInboundOutcome,
  WhatsappInboundType,
} from '../entities/whatsapp-inbound.entity';
import {
  WhatsappDeliveryStatus,
  WhatsappMessageState,
} from '../entities/whatsapp-message.entity';

export class RepliesQueryDto extends PaginationQueryDto {
  /** Filters guest messages; `TEXT` also keeps the admins' replies. */
  @IsOptional()
  @IsEnum(WhatsappInboundType)
  type?: WhatsappInboundType;
}

export class SendReplyDto {
  @IsUUID()
  guestId!: string;

  /** Client-generated per submit: a repeated submit sends once. */
  @IsUUID()
  requestId!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  text!: string;
}

/**
 * One row of the event's WhatsApp conversation (D-43, D-44): `IN` from a guest, `OUT` an admin's
 * reply. Admins only (full phone).
 */
export interface ReplyView {
  id: string;
  direction: 'IN' | 'OUT';
  guestId: string | null;
  guestName: string | null;
  guestPhone: string | null;
  type: WhatsappInboundType;
  metaType: string | null;
  body: string | null;
  buttonPayload: string | null;
  /** `IN` only. */
  outcome: WhatsappInboundOutcome | null;
  /** `OUT` only. */
  state: WhatsappMessageState | null;
  deliveryStatus: WhatsappDeliveryStatus | null;
  errorCode: string | null;
  sentByName: string | null;
  at: string;
  /** Until when an admin can still write to this guest (Meta's 24 h window, with a margin). */
  replyWindowClosesAt: string | null;
}
