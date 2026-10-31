import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

const toBool = ({ value }: { value: unknown }) =>
  value === true || value === 'true';

/** Every environment variable the API reads. Validated once at boot (W5: no silent defaults for secrets). */
export class EnvironmentVariables {
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @Type(() => Number)
  @IsInt()
  PORT = 4000;

  @IsUrl({ require_tld: false })
  APP_ORIGIN!: string;

  @IsString()
  CORS_ORIGINS!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(5)
  TRUST_PROXY_HOPS = 0;

  @IsString()
  DB_HOST!: string;

  @Type(() => Number)
  @IsInt()
  DB_PORT = 5432;

  @IsString()
  DB_USER!: string;

  @IsString()
  DB_PASSWORD!: string;

  @IsString()
  DB_NAME!: string;

  @Transform(toBool)
  @IsBoolean()
  DB_SSL = false;

  @IsString()
  REDIS_URL!: string;

  @IsString()
  @MinLength(32)
  JWT_SECRET!: string;

  @IsString()
  @MinLength(32)
  TOKEN_PEPPER!: string;

  @IsString()
  @MinLength(32)
  OTP_SECRET!: string;

  @IsString()
  JWT_ISSUER = 'athar-events';

  @IsString()
  JWT_AUDIENCE = 'athar-events-web';

  @Type(() => Number)
  @IsInt()
  @Min(60)
  @Max(3600)
  JWT_ACCESS_TTL_SECONDS = 900;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  REFRESH_TTL_DAYS = 30;

  @Transform(toBool)
  @IsBoolean()
  COOKIE_SECURE = true;

  @IsOptional()
  @IsString()
  SMTP_HOST?: string;

  @Type(() => Number)
  @IsInt()
  SMTP_PORT = 587;

  @Transform(toBool)
  @IsBoolean()
  SMTP_SECURE = false;

  @IsOptional()
  @IsString()
  SMTP_USER?: string;

  @IsOptional()
  @IsString()
  SMTP_PASSWORD?: string;

  @IsString()
  MAIL_FROM!: string;

  /** Team inbox for contact-form messages; defaults to MAIL_FROM. */
  @IsOptional()
  @IsString()
  CONTACT_INBOX?: string;

  @IsString()
  MAIL_FROM_NAME = 'أثر للمناسبات';
}

export function validateEnv(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const env = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(env, { skipMissingProperties: false });
  if (errors.length > 0) {
    const names = errors.map((e) => e.property).join(', ');
    throw new Error(`Invalid environment configuration: ${names}`);
  }
  if (env.NODE_ENV === NodeEnv.Production) {
    if (!env.SMTP_HOST) throw new Error('SMTP_HOST is required in production');
    if (!env.COOKIE_SECURE)
      throw new Error('COOKIE_SECURE must be true in production');
    const secrets = [env.JWT_SECRET, env.TOKEN_PEPPER, env.OTP_SECRET];
    if (new Set(secrets).size !== secrets.length)
      throw new Error('JWT_SECRET, TOKEN_PEPPER and OTP_SECRET must differ');
  }
  return env;
}

export const corsOrigins = (value: string): string[] =>
  value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
