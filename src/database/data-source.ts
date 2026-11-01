import 'reflect-metadata';
import { join } from 'node:path';
import { DataSource, DataSourceOptions } from 'typeorm';
import { AdminAction } from '../modules/admin-actions/admin-action.entity';
import { AuthToken } from '../modules/auth/entities/auth-token.entity';
import { EmailChallenge } from '../modules/auth/entities/email-challenge.entity';
import { RefreshToken } from '../modules/auth/entities/refresh-token.entity';
import { Session } from '../modules/auth/entities/session.entity';
import { Event } from '../modules/events/entities/event.entity';
import { Package } from '../modules/packages/entities/package.entity';
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
