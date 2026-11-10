import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { PaginationQueryDto } from '../../../shared/pagination';
import { Testimonial, TestimonialStatus } from '../entities/testimonial.entity';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const trimToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

export class CreateTestimonialDto {
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  authorName!: string;

  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  authorTitle?: string | null;

  @Transform(trim)
  @IsString()
  @Length(10, 600)
  quote!: string;

  @IsOptional()
  @IsEnum(TestimonialStatus)
  status?: TestimonialStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  sortOrder?: number;
}

/** Every field may be left out of a PATCH; the required ones refuse null (unlike `IsOptional`). */
const Omittable = () => ValidateIf((_, value) => value !== undefined);

export class UpdateTestimonialDto {
  @Omittable()
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  authorName?: string;

  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  authorTitle?: string | null;

  @Omittable()
  @Transform(trim)
  @IsString()
  @Length(10, 600)
  quote?: string;

  @Omittable()
  @IsEnum(TestimonialStatus)
  status?: TestimonialStatus;

  @Omittable()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  sortOrder?: number;
}

export class AdminTestimonialsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(TestimonialStatus)
  status?: TestimonialStatus;
}

export interface TestimonialView {
  id: string;
  authorName: string;
  authorTitle: string | null;
  quote: string;
}

export interface AdminTestimonialView extends TestimonialView {
  status: TestimonialStatus;
  sortOrder: number;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const toTestimonialView = (row: Testimonial): TestimonialView => ({
  id: row.id,
  authorName: row.authorName,
  authorTitle: row.authorTitle,
  quote: row.quote,
});

export const toAdminTestimonialView = (
  row: Testimonial,
): AdminTestimonialView => ({
  ...toTestimonialView(row),
  status: row.status,
  sortOrder: row.sortOrder,
  publishedAt: row.publishedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
