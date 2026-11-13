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

/**
 * D-44: a free-form text an admin sent to a guest inside the 24 h customer-service window.
 * Sent once, never retried by the system; `UNKNOWN` is shown as unconfirmed.
 */
@Entity({ name: 'whatsapp_replies' })
@Index('IDX_whatsapp_replies_event_created', ['eventId', 'createdAt'])
export class WhatsappReply {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'event_id', type: 'uuid' })
  eventId!: string;

  @Column({ name: 'guest_id', type: 'uuid' })
  guestId!: string;

  @Column({ name: 'sent_by_user_id', type: 'uuid' })
  sentByUserId!: string;

  /** Chosen by the client per submit; a repeated submit returns the first row. */
  @Index('UQ_whatsapp_replies_request_id', { unique: true })
  @Column({ name: 'request_id', type: 'uuid' })
  requestId!: string;

  /** `+9665…` at the time of sending. */
  @Column({ name: 'to_phone', type: 'varchar', length: 16 })
  toPhone!: string;

  @Column({ type: 'text' })
  body!: string;

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
