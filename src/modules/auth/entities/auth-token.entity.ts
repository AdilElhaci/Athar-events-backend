import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

/** Purpose-bound, single-use tokens. A token of one purpose is never accepted by another flow. */
export enum TokenPurpose {
  REGISTER = 'REGISTER',
  PASSWORD_RESET = 'PASSWORD_RESET',
  ADMIN_INVITE = 'ADMIN_INVITE',
}

@Entity({ name: 'auth_tokens' })
// At most one live token per email and purpose (issuing a new one revokes the old one in the same transaction).
@Index('UQ_auth_tokens_live', ['email', 'purpose'], {
  unique: true,
  where: '"used_at" IS NULL AND "revoked_at" IS NULL',
})
export class AuthToken {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({
    type: 'enum',
    enum: TokenPurpose,
    enumName: 'auth_tokens_purpose_enum',
  })
  purpose!: TokenPurpose;

  @Column({ name: 'token_hash', type: 'varchar', length: 64, unique: true })
  tokenHash!: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId!: string | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'user_id' })
  user?: User | null;

  @Column({ type: 'varchar', length: 254 })
  email!: string;

  /** Display name carried by a REGISTER token into account creation. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  name!: string | null;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt!: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
