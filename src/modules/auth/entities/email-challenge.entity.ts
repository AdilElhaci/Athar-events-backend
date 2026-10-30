import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum ChallengePurpose {
  REGISTER = 'REGISTER',
}

/** A 6-digit code emailed to prove inbox control before an account exists. */
@Entity({ name: 'email_challenges' })
@Index('IDX_email_challenges_email_purpose', ['email', 'purpose', 'createdAt'])
export class EmailChallenge {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({
    type: 'enum',
    enum: ChallengePurpose,
    enumName: 'email_challenges_purpose_enum',
  })
  purpose!: ChallengePurpose;

  @Column({ type: 'varchar', length: 254 })
  email!: string;

  /** Display name captured at registration start; used when the account is created. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  name!: string | null;

  @Column({ name: 'code_hash', type: 'varchar', length: 64 })
  codeHash!: string;

  @Column({ type: 'smallint', default: 0 })
  attempts!: number;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt!: Date | null;

  @Column({ name: 'superseded_at', type: 'timestamptz', nullable: true })
  supersededAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
