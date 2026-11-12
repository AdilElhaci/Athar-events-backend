import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const trimEach = ({ value }: { value: unknown }) =>
  Array.isArray(value)
    ? (value as unknown[]).map((v) => (typeof v === 'string' ? v.trim() : v))
    : value;
/** An empty optional field means "none". */
const emptyToUndefined = ({ value }: { value: unknown }) => {
  const v = typeof value === 'string' ? value.trim() : value;
  return v === '' ? undefined : v;
};

export const TEMPLATE_LANGUAGES = ['ar', 'en', 'en_US'] as const;
export const TEMPLATE_CATEGORIES = ['MARKETING', 'UTILITY'] as const;

/**
 * A new template for Meta review (Meta's limits: header/footer 60, body 1024, quick reply 25).
 * Variable numbering and single-line rules are checked by the service so the error has a code.
 */
export class CreateWhatsappTemplateDto {
  @Transform(trim)
  @IsString()
  @Matches(/^[a-z0-9_]{1,100}$/, {
    message: 'name must be lowercase letters, digits and underscores',
  })
  name!: string;

  @IsIn(TEMPLATE_LANGUAGES)
  language!: (typeof TEMPLATE_LANGUAGES)[number];

  @IsIn(TEMPLATE_CATEGORIES)
  category!: (typeof TEMPLATE_CATEGORIES)[number];

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(60)
  headerText?: string;

  @Transform(trim)
  @IsString()
  @Length(1, 1024)
  body!: string;

  @Transform(trimEach)
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Length(1, 200, { each: true })
  bodyExamples: string[] = [];

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(60)
  footerText?: string;

  @Transform(trimEach)
  @IsArray()
  @ArrayMaxSize(3)
  @IsString({ each: true })
  @Length(1, 25, { each: true })
  quickReplies: string[] = [];
}

export class DeleteWhatsappTemplateDto {
  @IsString()
  @Matches(/^[a-z0-9_]{1,100}$/)
  name!: string;
}
