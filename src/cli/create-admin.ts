/**
 * Server-side admin provisioning (the only way to create an administrator).
 *
 *   pnpm admin:create --email admin@example.com --name "اسم المدير"            # invite a new admin
 *   pnpm admin:create --email owner@example.com --name "..." --promote          # promote an existing owner
 *
 * The new admin receives a 24-hour link to choose their password. No password is ever
 * passed on the command line, stored in env files or printed.
 */
import { NestFactory } from '@nestjs/core';
import { parseArgs } from 'node:util';
import { AppModule } from '../app.module';
import { AdminProvisioningService } from '../modules/auth/services/admin-provisioning.service';

async function main() {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      promote: { type: 'boolean', default: false },
    },
  });
  if (!values.email || !values.name) {
    console.error(
      'Usage: admin:create --email <email> --name <name> [--promote]',
    );
    process.exit(2);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const outcome = await app
      .get(AdminProvisioningService)
      .provision(values.email, values.name, {
        promote: values.promote ?? false,
      });
    const messages = {
      invited:
        'Admin invited: an invitation link was emailed (valid 24 hours).',
      reinvited:
        'Pending admin re-invited: a new invitation link was emailed; the previous link no longer works.',
      promoted:
        'Existing owner promoted to admin and signed out everywhere; they must sign in again.',
      already_admin: 'This email is already an active admin; nothing changed.',
    } as const;
    console.log(messages[outcome]);
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void main();
