import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum UserType {
  OWNER = 'OWNER',
  PLATFORM_ADMIN = 'PLATFORM_ADMIN',
}

export enum UserStatus {
  ACTIVE = 'ACTIVE',
  /** Admin created by the CLI who has not yet set a password through the invite link. */
  INVITED = 'INVITED',
  SUSPENDED = 'SUSPENDED',
}

@Entity({ name: 'users' })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'enum', enum: UserType, enumName: 'users_type_enum' })
  type!: UserType;

  @Column({ type: 'enum', enum: UserStatus, enumName: 'users_status_enum' })
  status!: UserStatus;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  /** Lower-cased and trimmed; unique. */
  @Column({ type: 'varchar', length: 254, unique: true })
  email!: string;

  @Column({
    name: 'password_hash',
    type: 'varchar',
    length: 255,
    nullable: true,
    select: false,
  })
  passwordHash!: string | null;

  @Column({ name: 'email_verified_at', type: 'timestamptz', nullable: true })
  emailVerifiedAt!: Date | null;

  /** Bumped on password change, privilege change and "sign out everywhere"; access tokens carry it. */
  @Column({ name: 'session_version', type: 'int', default: 0 })
  sessionVersion!: number;

  @Column({ name: 'password_changed_at', type: 'timestamptz', nullable: true })
  passwordChangedAt!: Date | null;

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
