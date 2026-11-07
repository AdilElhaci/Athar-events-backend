import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Event } from '../../events/entities/event.entity';

/** Non-guest template variables; the guest name is filled per recipient at send time. */
export interface InvitationVariables {
  eventName: string;
  dateText: string;
  venue: string;
}

/**
 * One version of an event's invitation (data-model.md). The owner approves an exact version
 * (D-15); a new version resets approval. Approval or an admin override is recorded on the row.
 */
@Entity({ name: 'invitation_contents' })
@Index('UQ_invitation_contents_event_version', ['eventId', 'version'], {
  unique: true,
})
export class InvitationContent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'event_id', type: 'uuid' })
  eventId!: string;

  @ManyToOne(() => Event, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'event_id',
    foreignKeyConstraintName: 'FK_invitation_contents_event',
  })
  event?: Event;

  @Column({ type: 'int' })
  version!: number;

  @Column({ name: 'template_name', type: 'varchar', length: 120 })
  templateName!: string;

  @Column({ name: 'template_language', type: 'varchar', length: 10 })
  templateLanguage!: string;

  @Column({ type: 'jsonb' })
  variables!: InvitationVariables;

  /** Exactly what the owner saw, with a sample guest name. */
  @Column({ name: 'rendered_preview', type: 'text' })
  renderedPreview!: string;

  /** SHA-256 of template name, language and variables. */
  @Column({ name: 'content_hash', type: 'varchar', length: 64 })
  contentHash!: string;

  @Column({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId!: string;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  @Column({ name: 'approved_by_user_id', type: 'uuid', nullable: true })
  approvedByUserId!: string | null;

  /** Set when an admin approved instead of the owner (OQ-02, owner decision 2026-11-07). */
  @Column({
    name: 'override_reason',
    type: 'varchar',
    length: 300,
    nullable: true,
  })
  overrideReason!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
