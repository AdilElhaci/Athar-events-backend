import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum WhatsappInboundType {
  BUTTON = 'BUTTON',
  TEXT = 'TEXT',
  OTHER = 'OTHER',
}

export enum WhatsappInboundOutcome {
  APPLIED = 'APPLIED',
  UNMATCHED = 'UNMATCHED',
  LOCKED = 'LOCKED',
  DUPLICATE = 'DUPLICATE',
  AFTER_EVENT = 'AFTER_EVENT',
  /** Not a button reply (free text, media): recorded, nothing changes. */
  IGNORED = 'IGNORED',
}

/**
 * One inbound message. Its text is kept for the admin replies inbox (D-43) and deleted with the
 * row by the retention job (data-model.md).
 */
@Entity({ name: 'whatsapp_inbound' })
@Index('UQ_whatsapp_inbound_provider_message_id', ['providerMessageId'], {
  unique: true,
})
@Index('IDX_whatsapp_inbound_event_received', ['eventId', 'receivedAt'])
export class WhatsappInbound {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'provider_message_id', type: 'varchar', length: 128 })
  providerMessageId!: string;

  /** The invitation `wamid` the guest replied to. */
  @Column({
    name: 'context_message_id',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  contextMessageId!: string | null;

  /** Normalised `+<digits>`. */
  @Column({ name: 'from_phone', type: 'varchar', length: 16, nullable: true })
  fromPhone!: string | null;

  @Column({
    type: 'enum',
    enum: WhatsappInboundType,
    enumName: 'whatsapp_inbound_type',
  })
  type!: WhatsappInboundType;

  @Column({
    name: 'button_payload',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  buttonPayload!: string | null;

  /** The RSVP guest, or for any other message the guest this number was last invited as. */
  @Column({ name: 'guest_id', type: 'uuid', nullable: true })
  guestId!: string | null;

  /** The guest's event; null when the message could not be tied to a guest. */
  @Column({ name: 'event_id', type: 'uuid', nullable: true })
  eventId!: string | null;

  /** Text of a text message, or the label of the button tapped; at most 4096 characters. */
  @Column({ type: 'text', nullable: true })
  body!: string | null;

  /** Meta's message type (`text`, `button`, `image`, `audio`, …). */
  @Column({ name: 'meta_type', type: 'varchar', length: 20, nullable: true })
  metaType!: string | null;

  @Column({
    type: 'enum',
    enum: WhatsappInboundOutcome,
    enumName: 'whatsapp_inbound_outcome',
  })
  outcome!: WhatsappInboundOutcome;

  @CreateDateColumn({ name: 'received_at', type: 'timestamptz' })
  receivedAt!: Date;
}
