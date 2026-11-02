import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum ContactMessageStatus {
  NEW = 'NEW',
  READ = 'READ',
  REPLIED = 'REPLIED',
  CLOSED = 'CLOSED',
}

/** Message from the public contact form (D-34). Its text is never edited after submission. */
@Entity({ name: 'contact_messages' })
@Index('IDX_contact_messages_created_at', ['createdAt'])
@Index('IDX_contact_messages_status', ['status'])
export class ContactMessage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  /** Saudi mobile as 9665XXXXXXXX (E.164 without "+"). */
  @Column({ type: 'varchar', length: 20 })
  phone!: string;

  @Column({ type: 'text' })
  subject!: string;

  @Column({
    type: 'enum',
    enum: ContactMessageStatus,
    enumName: 'contact_message_status',
    default: ContactMessageStatus.NEW,
  })
  status!: ContactMessageStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
