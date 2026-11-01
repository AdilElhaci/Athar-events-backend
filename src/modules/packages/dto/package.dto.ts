import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Package } from '../entities/package.entity';

/** PostgreSQL `int`: larger values must fail validation, not reach the database. */
const INT_MAX = 2_147_483_647;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Empty descriptions are stored as null. */
const trimToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

const NameField = () =>
  applyDecorators(Transform(trim), IsString(), Length(2, 80));
const DescriptionField = () =>
  applyDecorators(
    Transform(trimToNull),
    IsOptional(),
    IsString(),
    MaxLength(500),
  );
const IntField = (min: number) =>
  applyDecorators(IsInt(), Min(min), Max(INT_MAX));
/** May be left out of a PATCH, but unlike `IsOptional` it refuses null. */
const Omittable = () => ValidateIf((_, value) => value !== undefined);

export class CreatePackageDto {
  @NameField()
  name!: string;

  @DescriptionField()
  description?: string | null;

  @IntField(1)
  invitationAllowance!: number;

  @IntField(0)
  extraMargin!: number;

  @IntField(1)
  priceHalalas!: number;

  @Omittable()
  @IsBoolean()
  isActive?: boolean;

  @Omittable()
  @IsBoolean()
  isFeatured?: boolean;

  @Omittable()
  @IntField(0)
  sortOrder?: number;
}

export class UpdatePackageDto {
  @Omittable()
  @NameField()
  name?: string;

  @DescriptionField()
  description?: string | null;

  @Omittable()
  @IntField(1)
  invitationAllowance?: number;

  @Omittable()
  @IntField(0)
  extraMargin?: number;

  @Omittable()
  @IntField(1)
  priceHalalas?: number;

  @Omittable()
  @IsBoolean()
  isActive?: boolean;

  @Omittable()
  @IsBoolean()
  isFeatured?: boolean;

  @Omittable()
  @IntField(0)
  sortOrder?: number;
}

/** Public shape of a package (`IPackage`). */
export interface PackageView {
  id: string;
  name: string;
  description: string | null;
  invitationAllowance: number;
  extraMargin: number;
  priceHalalas: number;
  currency: string;
  isFeatured: boolean;
  sortOrder: number;
}

export interface AdminPackageView extends PackageView {
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export const toPackageView = (pkg: Package): PackageView => ({
  id: pkg.id,
  name: pkg.name,
  description: pkg.description,
  invitationAllowance: pkg.invitationAllowance,
  extraMargin: pkg.extraMargin,
  priceHalalas: pkg.priceHalalas,
  currency: pkg.currency,
  isFeatured: pkg.isFeatured,
  sortOrder: pkg.sortOrder,
});

export const toAdminPackageView = (pkg: Package): AdminPackageView => ({
  ...toPackageView(pkg),
  isActive: pkg.isActive,
  createdAt: pkg.createdAt,
  updatedAt: pkg.updatedAt,
});
