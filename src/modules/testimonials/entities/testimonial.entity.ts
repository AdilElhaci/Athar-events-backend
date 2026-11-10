import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum TestimonialStatus {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
}

/**
 * A client's review, entered by an admin with the author's consent to publish. Plain text only.
 * Public order: `sort_order` ascending, then newest first.
 */
@Entity({ name: 'testimonials' })
@Index('IDX_testimonials_status_sort', ['status', 'sortOrder'])
@Check(
  'CHK_testimonials_published_at',
  `"status" <> 'PUBLISHED' OR "published_at" IS NOT NULL`,
)
export class Testimonial {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'author_name', type: 'varchar', length: 80 })
  authorName!: string;

  /** Optional context shown under the name, e.g. «حفل زواج · الرياض». */
  @Column({
    name: 'author_title',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  authorTitle!: string | null;

  @Column({ type: 'varchar', length: 600 })
  quote!: string;

  @Column({
    type: 'enum',
    enum: TestimonialStatus,
    enumName: 'testimonial_status',
    default: TestimonialStatus.DRAFT,
  })
  status!: TestimonialStatus;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
