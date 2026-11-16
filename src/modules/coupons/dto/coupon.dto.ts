import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsString,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { Coupon, CouponType } from '../entities/coupon.entity';

const INT_MAX = 2_147_483_647;

/** Codes are compared in upper case; spaces around them are ignored. */
const normalizeCode = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export const COUPON_CODE = /^[A-Z0-9_-]{3,30}$/;

/** May be left out of a PATCH, but unlike `IsOptional` it refuses null. */
const Omittable = () => ValidateIf((_, value) => value !== undefined);
/** May be left out or set to null (no limit / no expiry). */
const Nullable = () =>
  ValidateIf((_, value) => value !== undefined && value !== null);

export class CreateCouponDto {
  @Transform(normalizeCode)
  @IsString()
  @Matches(COUPON_CODE)
  code!: string;

  @IsEnum(CouponType)
  type!: CouponType;

  /** PERCENT: 1–99 (checked by the service). FIXED: halalas. */
  @IsInt()
  @Min(1)
  @Max(INT_MAX)
  value!: number;

  @Nullable()
  @IsInt()
  @Min(1)
  @Max(INT_MAX)
  maxUses?: number | null;

  @Nullable()
  @IsDateString()
  expiresAt?: string | null;

  @Omittable()
  @IsBoolean()
  isActive?: boolean;
}

/** Code, type and value are fixed once created; events keep the discount they got. */
export class UpdateCouponDto {
  @Nullable()
  @IsInt()
  @Min(1)
  @Max(INT_MAX)
  maxUses?: number | null;

  @Nullable()
  @IsDateString()
  expiresAt?: string | null;

  @Omittable()
  @IsBoolean()
  isActive?: boolean;
}

export class ApplyCouponDto {
  @Transform(normalizeCode)
  @IsString()
  @Matches(/^[A-Z0-9_-]{1,30}$/)
  code!: string;
}

export interface AdminCouponView {
  id: string;
  code: string;
  type: CouponType;
  value: number;
  maxUses: number | null;
  usedCount: number;
  expiresAt: Date | null;
  isActive: boolean;
  createdAt: Date;
}

export const toAdminCouponView = (coupon: Coupon): AdminCouponView => ({
  id: coupon.id,
  code: coupon.code,
  type: coupon.type,
  value: coupon.value,
  maxUses: coupon.maxUses,
  usedCount: coupon.usedCount,
  expiresAt: coupon.expiresAt,
  isActive: coupon.isActive,
  createdAt: coupon.createdAt,
});
