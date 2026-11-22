import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * One browser or phone that agreed to receive an admin's Web Push notifications (new inbox
 * messages). The endpoint is unique: a device that signs in as another admin moves to that admin.
 * Removed when the push service answers 404/410, when the admin turns it off, or with the user.
 */
@Entity({ name: 'push_subscriptions' })
@Index('UQ_push_subscriptions_endpoint', ['endpoint'], { unique: true })
@Index('IDX_push_subscriptions_user', ['userId'])
export class PushSubscription {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  /** The push service URL for this device; a capability, never logged. */
  @Column({ type: 'varchar', length: 1024 })
  endpoint!: string;

  @Column({ type: 'varchar', length: 128 })
  p256dh!: string;

  @Column({ type: 'varchar', length: 64 })
  auth!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
