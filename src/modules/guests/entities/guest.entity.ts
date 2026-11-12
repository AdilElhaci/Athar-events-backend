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
 * lock; the partial unique index keeps one live guest per phone and event. The QR token itself is
 * never stored: only its SHA-256 (SP-05).
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

  /** A reserve guest sent in place of this decline (D-16); unique, reserves only (migration). */
  @Column({ name: 'replacement_for_guest_id', type: 'uuid', nullable: true })
  replacementForGuestId!: string | null;

  /** True once this decline funded a replacement (D-16); later replies change nothing. */
  @Column({ name: 'rsvp_locked', type: 'boolean', default: false })
  rsvpLocked!: boolean;

  /** SHA-256 of the current QR token; null when none is valid (not issued, or revoked). */
  @Column({
    name: 'qr_token_hash',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  qrTokenHash!: string | null;

  /** Incremented on each issue; an older token no longer matches the hash. */
  @Column({ name: 'qr_version', type: 'int', default: 0 })
  qrVersion!: number;

  @Column({ name: 'qr_issued_at', type: 'timestamptz', nullable: true })
  qrIssuedAt!: Date | null;

  @Column({ name: 'checked_in_at', type: 'timestamptz', nullable: true })
  checkedInAt!: Date | null;

  /** The owner session that scanned (D-08). */
  @Column({ name: 'checked_in_by_user_id', type: 'uuid', nullable: true })
  checkedInByUserId!: string | null;

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
