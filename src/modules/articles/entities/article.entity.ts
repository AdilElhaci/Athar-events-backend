import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export enum ArticleStatus {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
}

export interface ArticleSection {
  heading: string;
  body: string;
}

/** «دفتر أثر» guide. Plain text only: the public page never renders stored HTML. */
@Entity({ name: 'articles' })
@Unique('UQ_articles_slug', ['slug'])
@Index('IDX_articles_status_published_at', ['status', 'publishedAt'])
@Check(
  'CHK_articles_published_complete',
  `"status" <> 'PUBLISHED' OR ("published_at" IS NOT NULL AND "excerpt" IS NOT NULL AND "reading_minutes" IS NOT NULL AND "cover_url" IS NOT NULL AND "cover_alt" IS NOT NULL AND jsonb_array_length("sections") > 0)`,
)
export class Article {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 120 })
  slug!: string;

  @Column({ type: 'varchar', length: 160 })
  title!: string;

  @Column({ type: 'varchar', length: 600, nullable: true })
  excerpt!: string | null;

  /** Free label shown with the article, not a managed taxonomy. */
  @Column({ type: 'varchar', length: 60, nullable: true })
  category!: string | null;

  @Column({ name: 'reading_minutes', type: 'int', nullable: true })
  readingMinutes!: number | null;

  /** Same-origin path: an uploaded image, or a file in the web app's `public/articles`. */
  @Column({ name: 'cover_url', type: 'varchar', length: 200, nullable: true })
  coverUrl!: string | null;

  @Column({ name: 'cover_alt', type: 'varchar', length: 200, nullable: true })
  coverAlt!: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  sections!: ArticleSection[];

  @Column({ type: 'varchar', length: 400, nullable: true })
  takeaway!: string | null;

  @Column({ type: 'enum', enum: ArticleStatus, default: ArticleStatus.DRAFT })
  status!: ArticleStatus;

  /** Set once, by the server, on first publish; kept if the article is unpublished. */
  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
