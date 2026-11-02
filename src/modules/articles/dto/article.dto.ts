import { applyDecorators } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../shared/pagination';
import { COVER_URL } from '../article-image';
import {
  Article,
  ArticleSection,
  ArticleStatus,
} from '../entities/article.entity';

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Empty optional fields are stored as null. */
const trimToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

const TitleField = () =>
  applyDecorators(Transform(trim), IsString(), Length(2, 160));
const SlugField = () =>
  applyDecorators(
    Transform(trim),
    IsString(),
    Length(3, 120),
    Matches(SLUG, { message: 'slug must be lowercase latin words and digits' }),
  );
/** Drafts may leave these empty; publishing requires them (`assertPublishable`). */
const DraftText = (max: number) =>
  applyDecorators(
    Transform(trimToNull),
    IsOptional(),
    IsString(),
    MaxLength(max),
  );
/** May be left out of a PATCH, but unlike `IsOptional` it refuses null. */
const Omittable = () => ValidateIf((_, value) => value !== undefined);

export class ArticleSectionDto {
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  heading!: string;

  @Transform(trim)
  @IsString()
  @Length(1, 5000)
  body!: string;
}

class ArticleContentDto {
  @DraftText(600)
  excerpt?: string | null;

  @DraftText(60)
  category?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  readingMinutes?: number | null;

  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Matches(COVER_URL)
  coverUrl?: string | null;

  @DraftText(200)
  coverAlt?: string | null;

  @Omittable()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ArticleSectionDto)
  sections?: ArticleSectionDto[];

  @DraftText(400)
  takeaway?: string | null;

  @Omittable()
  @IsEnum(ArticleStatus)
  status?: ArticleStatus;
}

export class CreateArticleDto extends ArticleContentDto {
  @TitleField()
  title!: string;

  @SlugField()
  slug!: string;
}

export class UpdateArticleDto extends ArticleContentDto {
  @Omittable()
  @TitleField()
  title?: string;

  @Omittable()
  @SlugField()
  slug?: string;
}

export class AdminArticlesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(ArticleStatus)
  status?: ArticleStatus;
}

/** Public card (`IArticleCard`). Published articles have every field filled. */
export interface ArticleCardView {
  slug: string;
  title: string;
  excerpt: string | null;
  category: string | null;
  readingMinutes: number | null;
  coverUrl: string | null;
  coverAlt: string | null;
  publishedAt: Date | null;
}

export interface ArticleView extends ArticleCardView {
  sections: ArticleSection[];
  takeaway: string | null;
}

export interface AdminArticleListItemView extends ArticleCardView {
  id: string;
  status: ArticleStatus;
  createdAt: Date;
  updatedAt: Date;
}

export type AdminArticleView = AdminArticleListItemView & ArticleView;

export const toArticleCardView = (article: Article): ArticleCardView => ({
  slug: article.slug,
  title: article.title,
  excerpt: article.excerpt,
  category: article.category,
  readingMinutes: article.readingMinutes,
  coverUrl: article.coverUrl,
  coverAlt: article.coverAlt,
  publishedAt: article.publishedAt,
});

export const toArticleView = (article: Article): ArticleView => ({
  ...toArticleCardView(article),
  sections: article.sections,
  takeaway: article.takeaway,
});

export const toAdminArticleListItemView = (
  article: Article,
): AdminArticleListItemView => ({
  ...toArticleCardView(article),
  id: article.id,
  status: article.status,
  createdAt: article.createdAt,
  updatedAt: article.updatedAt,
});

export const toAdminArticleView = (article: Article): AdminArticleView => ({
  ...toAdminArticleListItemView(article),
  ...toArticleView(article),
});
