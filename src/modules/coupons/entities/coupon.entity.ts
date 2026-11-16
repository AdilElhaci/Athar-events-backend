import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum CouponType {
  /** `value` is a percentage, 1–99. */
  PERCENT = 'PERCENT',
  /** `value` is an amount in halalas. */
  FIXED = 'FIXED',
}

/**
 * D-48 discount code. An owner uses a coupon on one event only; `used_count` counts paid
 * events. Coupons are deactivated, never deleted; code, type and value never change.
 */
@Entity({ name: 'coupons' })
@Index('UQ_coupons_code', ['code'], { unique: true })
@Check(
  'CHK_coupons_value',
  `"value" > 0 AND ("type" <> 'PERCENT' OR "value" <= 99)`,
)
@Check('CHK_coupons_max_uses', '"max_uses" IS NULL OR "max_uses" > 0')
@Check('CHK_coupons_used_count', '"used_count" >= 0')
export class Coupon {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Upper case, `A–Z 0–9 _ -`. */
  @Column({ type: 'varchar', length: 30 })
  code!: string;

  @Column({ type: 'enum', enum: CouponType, enumName: 'coupon_type' })
  type!: CouponType;

  @Column({ type: 'int' })
  value!: number;

  /** Paid events allowed across all owners; null means no limit. */
  @Column({ name: 'max_uses', type: 'int', nullable: true })
  maxUses!: number | null;

  @Column({ name: 'used_count', type: 'int', default: 0 })
  usedCount!: number;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
