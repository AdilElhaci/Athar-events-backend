import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum WebhookProvider {
  MOYASAR = 'MOYASAR',
  META = 'META',
}

/** One row per provider delivery, deduplicated by key. Raw payloads are never stored. */
@Entity({ name: 'webhook_receipts' })
@Index('UQ_webhook_receipts_provider_dedupe_key', ['provider', 'dedupeKey'], {
  unique: true,
})
export class WebhookReceipt {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({
    type: 'enum',
    enum: WebhookProvider,
    enumName: 'webhook_provider',
  })
  provider!: WebhookProvider;

  /** Moyasar: `<payment id>:<event type>`. */
  @Column({ name: 'dedupe_key', type: 'varchar', length: 200 })
  dedupeKey!: string;

  @CreateDateColumn({ name: 'received_at', type: 'timestamptz' })
  receivedAt!: Date;

  /** Null until handled; a delivery that failed is handled again on the provider's retry. */
  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt!: Date | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  outcome!: string | null;

  @Column({ name: 'error_code', type: 'varchar', length: 60, nullable: true })
  errorCode!: string | null;
}
