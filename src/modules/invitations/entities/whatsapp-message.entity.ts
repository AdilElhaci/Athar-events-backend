import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum WhatsappMessageKind {
  INVITATION = 'INVITATION',
  /** QR image inside the customer-service window opened by the guest's reply. */
  QR = 'QR',
  /** Approved QR template, used when the window has closed (not built yet). */
  QR_TEMPLATE = 'QR_TEMPLATE',
}

/** The send attempt's outcome. `UNKNOWN` is never resent automatically (AGENTS.md). */
export enum WhatsappMessageState {
  QUEUED = 'QUEUED',
  SENDING = 'SENDING',
  SENT = 'SENT',
  FAILED = 'FAILED',
  UNKNOWN = 'UNKNOWN',
  CANCELLED = 'CANCELLED',
}

/** From Meta status webhooks; monotonic in this declared order, `FAILED` only from NONE/SENT. */
export enum WhatsappDeliveryStatus {
  NONE = 'NONE',
  SENT = 'SENT',
  DELIVERED = 'DELIVERED',
  READ = 'READ',
  FAILED = 'FAILED',
}

/**
 * One outbound intent (data-model.md). The unique `logical_key` means a retry, a duplicate job or a
 * duplicate webhook can never create a second message for the same purpose.
 */
@Entity({ name: 'whatsapp_messages' })
@Index('UQ_whatsapp_messages_logical_key', ['logicalKey'], { unique: true })
@Index('IDX_whatsapp_messages_guest_id', ['guestId'])
export class WhatsappMessage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'event_id', type: 'uuid' })
  eventId!: string;

  @Column({ name: 'guest_id', type: 'uuid' })
  guestId!: string;

  @Column({
    type: 'enum',
    enum: WhatsappMessageKind,
    enumName: 'whatsapp_message_kind',
  })
  kind!: WhatsappMessageKind;

  /** `invitation:<guestId>:<contentVersion>` or `qr:<guestId>:<qrVersion>`. */
  @Column({ name: 'logical_key', type: 'varchar', length: 120 })
  logicalKey!: string;

  @Column({ name: 'schedule_version', type: 'int', default: 0 })
  scheduleVersion!: number;

  /** QR intents: the guest `qr_version` this message issues. */
  @Column({ name: 'qr_version', type: 'int', nullable: true })
  qrVersion!: number | null;

  @Column({
    type: 'enum',
    enum: WhatsappMessageState,
    enumName: 'whatsapp_message_state',
    default: WhatsappMessageState.QUEUED,
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

  /** `wamid…`; partial unique in the migration. */
  @Column({
    name: 'provider_message_id',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  providerMessageId!: string | null;

  @Column({ name: 'claimed_at', type: 'timestamptz', nullable: true })
  claimedAt!: Date | null;

  @Column({ name: 'attempt_count', type: 'smallint', default: 0 })
  attemptCount!: number;

  /** Provider code only, never a payload. */
  @Column({
    name: 'last_error_code',
    type: 'varchar',
    length: 60,
    nullable: true,
  })
  lastErrorCode!: string | null;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt!: Date | null;

  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt!: Date | null;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt!: Date | null;

  @Column({ name: 'failed_at', type: 'timestamptz', nullable: true })
  failedAt!: Date | null;

  @Column({ name: 'resolved_by_user_id', type: 'uuid', nullable: true })
  resolvedByUserId!: string | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt!: Date | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  resolution!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
