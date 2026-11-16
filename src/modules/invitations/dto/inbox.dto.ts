import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationMeta, PaginationQueryDto } from '../../../shared/pagination';
import {
  InboundDetails,
  WhatsappInboundOutcome,
  WhatsappInboundType,
} from '../entities/whatsapp-inbound.entity';
import { WhatsappMediaState } from '../entities/whatsapp-media.entity';
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

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** D-47: multipart fields sent with the file (image or PDF). */
export class SendAttachmentDto {
  @IsUUID()
  requestId!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1024)
  caption?: string;
}

/** D-47: an approved template to a number, inside or outside the window. */
export class SendTemplateDto {
  @IsUUID()
  requestId!: string;

  @IsString()
  @Matches(/^[a-z0-9_]{1,512}$/)
  name!: string;

  @IsString()
  @Matches(/^[a-zA-Z]{2,3}(_[a-zA-Z]{2,4})?$/)
  language!: string;

  /** Body variables {{1}}…{{n}} in order. */
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(1024, { each: true })
  parameters!: string[];
}

/** D-47: a template the inbox can send as is (no media header, no dynamic URL). */
export interface InboxTemplateView {
  name: string;
  language: string;
  /** `UTILITY` (cheaper, event matters) or `MARKETING`. */
  category: string;
  headerText: string | null;
  body: string;
  footer: string | null;
  buttons: string[];
  /** How many body variables must be filled. */
  variables: number;
}

/** D-47: the stored copy of a message's file. */
export interface InboxMediaView {
  id: string;
  state: WhatsappMediaState;
  mimeType: string;
  fileName: string | null;
  sizeBytes: number | null;
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
  /** D-47: location, contacts or reaction (`IN`). */
  details: InboundDetails | null;
  /** D-47: the image, video, audio, sticker or file, when the message has one. */
  media: InboxMediaView | null;
  /** D-47: `OUT` template sends. */
  templateName: string | null;
  templateCategory: string | null;
}

export interface ConversationDetail {
  conversation: ConversationView;
  messages: InboxMessageView[];
  meta: PaginationMeta;
}
