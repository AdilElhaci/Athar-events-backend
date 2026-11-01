import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Catalogue row. Events copy these terms at creation, so edits never reach existing events. */
@Entity({ name: 'packages' })
@Check('CHK_packages_invitation_allowance', '"invitation_allowance" > 0')
@Check('CHK_packages_extra_margin', '"extra_margin" >= 0')
@Check('CHK_packages_price_halalas', '"price_halalas" > 0')
export class Package {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 80 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'invitation_allowance', type: 'int' })
  invitationAllowance!: number;

  @Column({ name: 'extra_margin', type: 'int' })
  extraMargin!: number;

  @Column({ name: 'price_halalas', type: 'int' })
  priceHalalas!: number;

  @Column({ type: 'varchar', length: 3, default: 'SAR' })
  currency!: string;

  /** Only active packages are listed publicly. */
  @Column({ name: 'is_active', type: 'boolean', default: false })
  isActive!: boolean;

  @Column({ name: 'is_featured', type: 'boolean', default: false })
  isFeatured!: boolean;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
