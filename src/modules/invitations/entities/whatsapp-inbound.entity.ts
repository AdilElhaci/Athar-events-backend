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

/** Minimal record of one inbound message; free text is never stored (data-model.md). */
@Entity({ name: 'whatsapp_inbound' })
@Index('UQ_whatsapp_inbound_provider_message_id', ['providerMessageId'], {
  unique: true,
})
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

  @Column({ name: 'guest_id', type: 'uuid', nullable: true })
  guestId!: string | null;

  @Column({
    type: 'enum',
    enum: WhatsappInboundOutcome,
    enumName: 'whatsapp_inbound_outcome',
  })
  outcome!: WhatsappInboundOutcome;

  @CreateDateColumn({ name: 'received_at', type: 'timestamptz' })
  receivedAt!: Date;
}
