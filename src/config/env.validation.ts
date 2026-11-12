import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
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

  /** Unset: checkout answers 503 and nothing calls Moyasar. `sk_live_` is refused outside production. */
  @IsOptional()
  @IsString()
  MOYASAR_SECRET_KEY?: string;

  /** Unused while checkout is the hosted invoice; kept so the server env mirrors the dashboard. */
  @IsOptional()
  @IsString()
  MOYASAR_PUBLISHABLE_KEY?: string;

  /** Shared with the webhook registered in the Moyasar dashboard. Unset: every webhook answers 401. */
  @IsOptional()
  @IsString()
  @MinLength(16)
  MOYASAR_WEBHOOK_SECRET?: string;

  @IsUrl({ require_tld: false })
  MOYASAR_API_BASE_URL = 'https://api.moyasar.com/v1';

  /** Graph API version used for every Meta call. */
  @Matches(/^v\d+\.\d+$/)
  WHATSAPP_GRAPH_VERSION = 'v23.0';

  @IsUrl({ require_tld: false })
  WHATSAPP_GRAPH_BASE_URL = 'https://graph.facebook.com';

  /** The sender's Phone Number ID (not the phone number). Unset: nothing is sent to Meta. */
  @IsOptional()
  @Matches(/^\d{5,30}$/)
  WHATSAPP_PHONE_NUMBER_ID?: string;

  /** WhatsApp Business Account ID (template management). */
  @IsOptional()
  @Matches(/^\d{5,30}$/)
  WHATSAPP_WABA_ID?: string;

  /** System-user token with whatsapp_business_messaging and whatsapp_business_management. */
  @IsOptional()
  @IsString()
  WHATSAPP_ACCESS_TOKEN?: string;

  /** Meta app secret; signs every webhook (X-Hub-Signature-256). Unset: every webhook answers 401. */
  @IsOptional()
  @IsString()
  @MinLength(16)
  WHATSAPP_APP_SECRET?: string;

  /** Our own random string, entered as "Verify token" in the app's webhook settings. */
  @IsOptional()
  @IsString()
  @MinLength(16)
  WHATSAPP_VERIFY_TOKEN?: string;

  /** Name of the Arabic invitation template submitted to Meta (ADR-0003). */
  @IsString()
  WHATSAPP_INVITATION_TEMPLATE = 'athar_invitation';

  /**
   * The template's state at Meta, set by hand until the template-status webhook exists (T-P1-10).
   * Scheduling is refused unless it is APPROVED (SP-04, integrations.md).
   */
  @IsIn(['PENDING', 'APPROVED', 'REJECTED'])
  WHATSAPP_INVITATION_TEMPLATE_STATUS: 'PENDING' | 'APPROVED' | 'REJECTED' =
    'PENDING';

  /**
   * Invitations (business-initiated templates) sent in any rolling 24 h, all events together. Keep
   * it at or below the number's Meta messaging limit (WhatsApp Manager > Insights); above it Meta
   * rejects sends. Invitations past the limit stay queued for the next window. 0 = no limit.
   * QR images answer a guest's reply (service window) and do not count (OQ-21).
   */
  @IsInt()
  @Min(0)
  WHATSAPP_DAILY_INVITATION_LIMIT = 1000;
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
  if (
    env.NODE_ENV !== NodeEnv.Production &&
    env.MOYASAR_SECRET_KEY?.startsWith('sk_live_')
  )
    throw new Error('MOYASAR_SECRET_KEY must be a test key outside production');
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
