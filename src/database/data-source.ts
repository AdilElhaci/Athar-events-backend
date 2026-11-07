import 'reflect-metadata';
import { join } from 'node:path';
import { DataSource, DataSourceOptions } from 'typeorm';
import { AdminAction } from '../modules/admin-actions/admin-action.entity';
import { ArticleImage } from '../modules/articles/entities/article-image.entity';
import { Article } from '../modules/articles/entities/article.entity';
import { AuthToken } from '../modules/auth/entities/auth-token.entity';
import { EmailChallenge } from '../modules/auth/entities/email-challenge.entity';
import { RefreshToken } from '../modules/auth/entities/refresh-token.entity';
import { Session } from '../modules/auth/entities/session.entity';
import { ContactMessage } from '../modules/contact/entities/contact-message.entity';
import { Event } from '../modules/events/entities/event.entity';
import {
  GuestImport,
  GuestImportRow,
} from '../modules/guests/entities/guest-import.entity';
import { Guest } from '../modules/guests/entities/guest.entity';
import { InvitationContent } from '../modules/invitations/entities/invitation-content.entity';
import { WhatsappInbound } from '../modules/invitations/entities/whatsapp-inbound.entity';
import { WhatsappMessage } from '../modules/invitations/entities/whatsapp-message.entity';
import { Package } from '../modules/packages/entities/package.entity';
import { PaymentAttempt } from '../modules/payments/entities/payment-attempt.entity';
import { WebhookReceipt } from '../modules/payments/entities/webhook-receipt.entity';
import { User } from '../modules/users/entities/user.entity';

export const ENTITIES = [
  User,
  EmailChallenge,
  AuthToken,
  Session,
  RefreshToken,
  AdminAction,
  Package,
  Event,
  Article,
  ArticleImage,
  ContactMessage,
  PaymentAttempt,
  WebhookReceipt,
  Guest,
  GuestImport,
  GuestImportRow,
  InvitationContent,
  WhatsappMessage,
  WhatsappInbound,
];

/** Shared by the Nest app, the migration CLI and the admin CLI. `synchronize` is always off. */
export function buildDataSourceOptions(
  env: NodeJS.ProcessEnv = process.env,
): DataSourceOptions {
  return {
    type: 'postgres',
    host: env.DB_HOST,
    port: Number(env.DB_PORT ?? 5432),
    username: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    ssl: env.DB_SSL === 'true' ? { rejectUnauthorized: true } : false,
    // gen_random_uuid() is built into PostgreSQL 13+; avoids the uuid-ossp extension.
    uuidExtension: 'pgcrypto',
    entities: ENTITIES,
    migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
    synchronize: false,
    migrationsRun: false,
  };
}

// Default export for the TypeORM CLI (`pnpm migration:*`), which loads .env via dotenv/config.
export default new DataSource(buildDataSourceOptions());
