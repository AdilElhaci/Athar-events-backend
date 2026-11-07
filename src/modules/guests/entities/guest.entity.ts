import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Event } from '../../events/entities/event.entity';

export enum GuestKind {
  INITIAL = 'INITIAL',
  RESERVE = 'RESERVE',
}

export enum GuestSource {
  MANUAL = 'MANUAL',
  IMPORT = 'IMPORT',
}

export enum GuestAllocationStatus {
  NOT_ALLOCATED = 'NOT_ALLOCATED',
  ALLOCATED = 'ALLOCATED',
}

export enum GuestRsvp {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  DECLINED = 'DECLINED',
}

/**
 * One named guest with one Saudi mobile (OQ-03, OQ-18). Quotas are checked under the event row
 * lock; the partial unique index keeps one live guest per phone and event. QR, replacement and
 * check-in attribution columns arrive with their tasks (T-P4, T-P5).
 */
@Entity({ name: 'guests' })
@Index('IDX_guests_event_id', ['eventId'])
export class Guest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'event_id', type: 'uuid' })
  eventId!: string;

  @ManyToOne(() => Event, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'event_id', foreignKeyConstraintName: 'FK_guests_event' })
  event?: Event;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  /** `+9665XXXXXXXX`; null only after retention anonymisation. */
  @Column({ type: 'varchar', length: 16, nullable: true })
  phone!: string | null;

  @Column({
    type: 'enum',
    enum: GuestKind,
    enumName: 'guest_kind',
    default: GuestKind.INITIAL,
  })
  kind!: GuestKind;

  @Column({
    type: 'enum',
    enum: GuestSource,
    enumName: 'guest_source',
    default: GuestSource.MANUAL,
  })
  source!: GuestSource;

  @Column({ name: 'import_id', type: 'uuid', nullable: true })
  importId!: string | null;

  /** `ALLOCATED` = counted for sending; deletion and phone edits are blocked from then on. */
  @Column({
    name: 'allocation_status',
    type: 'enum',
    enum: GuestAllocationStatus,
    enumName: 'guest_allocation_status',
    default: GuestAllocationStatus.NOT_ALLOCATED,
  })
  allocationStatus!: GuestAllocationStatus;

  @Column({ name: 'allocated_at', type: 'timestamptz', nullable: true })
  allocatedAt!: Date | null;

  @Column({
    type: 'enum',
    enum: GuestRsvp,
    enumName: 'guest_rsvp',
    default: GuestRsvp.PENDING,
  })
  rsvp!: GuestRsvp;

  @Column({ name: 'rsvp_at', type: 'timestamptz', nullable: true })
  rsvpAt!: Date | null;

  @Column({ name: 'checked_in_at', type: 'timestamptz', nullable: true })
  checkedInAt!: Date | null;

  /** Admin-only. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  note!: string | null;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
