import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  WhatsappDeliveryStatus,
  WhatsappMessageState,
} from './whatsapp-message.entity';

export type ReplyMessageType = 'text' | 'image' | 'document' | 'template';

/**
 * D-44/D-45/D-47: a free-form text an admin sent from the inbox inside the 24 h customer-service window.
 * Sent once, never retried by the system; `UNKNOWN` is shown as unconfirmed.
 */
@Entity({ name: 'whatsapp_replies' })
@Index('IDX_whatsapp_replies_event_created', ['eventId', 'createdAt'])
export class WhatsappReply {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The guest's event when the number belongs to a guest; null for any other number (D-45). */
  @Column({ name: 'event_id', type: 'uuid', nullable: true })
  eventId!: string | null;

  @Column({ name: 'guest_id', type: 'uuid', nullable: true })
  guestId!: string | null;

  @Column({ name: 'sent_by_user_id', type: 'uuid' })
  sentByUserId!: string;

  /** Chosen by the client per submit; a repeated submit returns the first row. */
  @Index('UQ_whatsapp_replies_request_id', { unique: true })
  @Column({ name: 'request_id', type: 'uuid' })
  requestId!: string;

  /** `+9665…` at the time of sending. */
  @Column({ name: 'to_phone', type: 'varchar', length: 16 })
  toPhone!: string;

  /** D-47: `text`, `image` or `document` (inside the window), or `template` (any time). */
  @Column({
    name: 'message_type',
    type: 'varchar',
    length: 20,
    default: 'text',
  })
  messageType!: ReplyMessageType;

  /** The text, a media caption, or the template body with its variables filled in. */
  @Column({ type: 'text', nullable: true })
  body!: string | null;

  @Column({
    name: 'template_name',
    type: 'varchar',
    length: 512,
    nullable: true,
  })
  templateName!: string | null;

  @Column({
    name: 'template_language',
    type: 'varchar',
    length: 15,
    nullable: true,
  })
  templateLanguage!: string | null;

  /** `UTILITY` or `MARKETING` as Meta classified it when sent; Meta prices by it. */
  @Column({
    name: 'template_category',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  templateCategory!: string | null;

  @Column({
    type: 'enum',
    enum: WhatsappMessageState,
    enumName: 'whatsapp_message_state',
    default: WhatsappMessageState.SENDING,
  })
  state!: WhatsappMessageState;

  @Column({
    name: 'delivery_status',
    type: 'enum',
    enum: WhatsappDeliveryStatus,
    enumName: 'whatsapp_delivery_status',
    default: WhatsappDeliveryStatus.NONE,
  })
  deliveryStatus!: WhatsappDeliveryStatus;

  @Column({
    name: 'provider_message_id',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  providerMessageId!: string | null;

  @Column({ name: 'error_code', type: 'varchar', length: 60, nullable: true })
  errorCode!: string | null;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt!: Date | null;

  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt!: Date | null;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt!: Date | null;

  @Column({ name: 'failed_at', type: 'timestamptz', nullable: true })
  failedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
