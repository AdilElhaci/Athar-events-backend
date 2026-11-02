import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** Uploaded cover. Stored in PostgreSQL so it follows blue/green deploys and database backups. */
@Entity({ name: 'article_images' })
export class ArticleImage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'bytea' })
  data!: Buffer;

  @Column({ name: 'content_type', type: 'varchar', length: 20 })
  contentType!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
