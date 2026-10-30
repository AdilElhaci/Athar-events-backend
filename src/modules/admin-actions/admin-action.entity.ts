import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** Append-only log of administrative actions (no update or delete path in code). */
@Entity({ name: 'admin_actions' })
@Index('IDX_admin_actions_created_at', ['createdAt'])
export class AdminAction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Null when the action came from the server CLI. */
  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId!: string | null;

  @Column({ type: 'varchar', length: 60 })
  action!: string;

  @Column({ name: 'target_type', type: 'varchar', length: 40 })
  targetType!: string;

  @Column({ name: 'target_id', type: 'uuid', nullable: true })
  targetId!: string | null;

  /** Counts and field names only; never names, emails or phones. */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  summary!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
