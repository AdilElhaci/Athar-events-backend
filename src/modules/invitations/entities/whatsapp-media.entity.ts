import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum WhatsappMediaState {
  /** Inbound: waiting to be downloaded from Meta. */
  PENDING = 'PENDING',
  STORED = 'STORED',
  /** Download gave up (Meta refused, or too many attempts). */
  FAILED = 'FAILED',
  /** Above the size cap: not stored, the admin sees the name and size only. */
  TOO_LARGE = 'TOO_LARGE',
}

/**
 * D-47: our copy of a message's image, video, audio, sticker or file. Meta's download links expire,
 * so inbound media is fetched once and kept here; outbound media is what the admin uploaded.
 * Exactly one of `inboundId` / `replyId` is set; the row goes with its message.
 */
@Entity({ name: 'whatsapp_media' })
export class WhatsappMedia {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'inbound_id', type: 'uuid', nullable: true })
  inboundId!: string | null;

  @Column({ name: 'reply_id', type: 'uuid', nullable: true })
  replyId!: string | null;

  /** Meta's media id: what is downloaded (inbound) or what was sent (outbound). */
  @Column({
    name: 'meta_media_id',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  metaMediaId!: string | null;

  @Column({ name: 'mime_type', type: 'varchar', length: 100 })
  mimeType!: string;

  @Column({ name: 'file_name', type: 'varchar', length: 255, nullable: true })
  fileName!: string | null;

  @Column({ name: 'size_bytes', type: 'integer', nullable: true })
  sizeBytes!: number | null;

  /** Never selected by default: lists must not load the bytes. */
  @Column({ type: 'bytea', nullable: true, select: false })
  data!: Buffer | null;

  @Column({
    type: 'enum',
    enum: WhatsappMediaState,
    enumName: 'whatsapp_media_state',
    default: WhatsappMediaState.PENDING,
  })
  state!: WhatsappMediaState;

  @Column({ type: 'smallint', default: 0 })
  attempts!: number;

  @Column({ name: 'claimed_at', type: 'timestamptz', nullable: true })
  claimedAt!: Date | null;

  @Column({ name: 'error_code', type: 'varchar', length: 60, nullable: true })
  errorCode!: string | null;

  @Column({ name: 'stored_at', type: 'timestamptz', nullable: true })
  storedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
