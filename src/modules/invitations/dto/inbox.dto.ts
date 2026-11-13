import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationMeta, PaginationQueryDto } from '../../../shared/pagination';
import {
  WhatsappInboundOutcome,
  WhatsappInboundType,
} from '../entities/whatsapp-inbound.entity';
import {
  WhatsappDeliveryStatus,
  WhatsappMessageState,
} from '../entities/whatsapp-message.entity';

const toBool = ({ value }: { value: unknown }) =>
  value === true || value === 'true'
    ? true
    : value === false || value === 'false'
      ? false
      : value;

export class ConversationsQueryDto extends PaginationQueryDto {
  /** Only conversations with an unread guest message. */
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  unread?: boolean;

  /** Part of the phone number (any form) or of a guest's name. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(60)
  declare search?: string;
}

export class SendReplyDto {
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

/** Who a number belongs to: the guest it was most recently invited as, if any. */
export interface ConversationContact {
  guestId: string | null;
  guestName: string | null;
  eventId: string | null;
  eventName: string | null;
  eventReference: string | null;
}

/** One row of the inbox list (D-45); admins only (full phone). */
export interface ConversationView extends ConversationContact {
  /** `9665…`, the id used in the conversation URLs. */
  id: string;
  phone: string;
  lastAt: string;
  lastDirection: 'IN' | 'OUT';
  lastType: WhatsappInboundType;
  lastMetaType: string | null;
  lastBody: string | null;
  unread: number;
  /** Until when an admin can still write (Meta's 24 h window, with a margin); null when closed. */
  replyWindowClosesAt: string | null;
}

/** One message of a conversation: `IN` from the number, `OUT` an admin's reply. */
export interface InboxMessageView {
  id: string;
  direction: 'IN' | 'OUT';
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
  eventReference: string | null;
  at: string;
}

export interface ConversationDetail {
  conversation: ConversationView;
  messages: InboxMessageView[];
  meta: PaginationMeta;
}
