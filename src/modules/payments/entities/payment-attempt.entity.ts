import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Event } from '../../events/entities/event.entity';
import { User } from '../../users/entities/user.entity';

export enum PaymentAttemptStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
  FAILED = 'FAILED',
  EXPIRED = 'EXPIRED',
}

/**
 * One hosted Moyasar invoice opened for an event. Only `PENDING` attempts change; the other
 * statuses are final. At most one attempt per event is ever `PAID` (D-10).
 */
@Entity({ name: 'payment_attempts' })
@Index('IDX_payment_attempts_event_id', ['eventId'])
@Index('IDX_payment_attempts_status_created_at', ['status', 'createdAt'])
@Index('UQ_payment_attempts_event_paid', ['eventId'], {
  unique: true,
  where: `"status" = 'PAID'`,
})
@Index('UQ_payment_attempts_moyasar_invoice_id', ['moyasarInvoiceId'], {
  unique: true,
  where: '"moyasar_invoice_id" IS NOT NULL',
})
@Index('UQ_payment_attempts_moyasar_payment_id', ['moyasarPaymentId'], {
  unique: true,
  where: '"moyasar_payment_id" IS NOT NULL',
})
export class PaymentAttempt {
  /** Generated before the invoice is created, so Moyasar's metadata can carry it. */
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'event_id', type: 'uuid' })
  eventId!: string;

  @ManyToOne(() => Event, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'event_id',
    foreignKeyConstraintName: 'FK_payment_attempts_event',
  })
  event?: Event;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'owner_id',
    foreignKeyConstraintName: 'FK_payment_attempts_owner',
  })
  owner?: User;

  /** Halalas, copied from the event snapshot; never from the client. */
  @Column({ type: 'int' })
  amount!: number;

  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  @Column({
    type: 'enum',
    enum: PaymentAttemptStatus,
    enumName: 'payment_attempt_status',
    default: PaymentAttemptStatus.PENDING,
  })
  status!: PaymentAttemptStatus;

  @Column({
    name: 'moyasar_invoice_id',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  moyasarInvoiceId!: string | null;

  @Column({
    name: 'moyasar_payment_id',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  moyasarPaymentId!: string | null;

  @Column({ name: 'payment_url', type: 'varchar', length: 500, nullable: true })
  paymentUrl!: string | null;

  /** When the hosted invoice stops accepting payment. */
  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;

  @Column({ name: 'failure_code', type: 'varchar', length: 60, nullable: true })
  failureCode!: string | null;

  @Column({
    name: 'failure_message',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  failureMessage!: string | null;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt!: Date | null;

  @Column({ name: 'last_reconciled_at', type: 'timestamptz', nullable: true })
  lastReconciledAt!: Date | null;

  /** Card brand and last four digits at most; nothing else from the card. */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
