/**
 * P1 tracer, step 1 (integrations.md): send the approved invitation template to ONE guest, outside
 * any campaign. The guest must have consented; their event must be paid, not started, and have an
 * approved invitation. The reply, the QR and the statuses then arrive through the webhook.
 *
 *   pnpm whatsapp:tracer --guest <guest uuid>
 *   pnpm whatsapp:tracer:prod --guest <guest uuid>     # on the server, from dist/
 *
 * Prints the intent id and its state only: never the phone, the name or a token.
 */
import { NestFactory } from '@nestjs/core';
import { parseArgs } from 'node:util';
import { AppModule } from '../app.module';
import { WhatsappMessageState } from '../modules/invitations/entities/whatsapp-message.entity';
import {
  TracerError,
  WhatsappSenderService,
} from '../modules/invitations/whatsapp/whatsapp-sender.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function main() {
  const { values } = parseArgs({ options: { guest: { type: 'string' } } });
  if (!values.guest || !UUID.test(values.guest)) {
    console.error('Usage: whatsapp:tracer --guest <guest uuid>');
    process.exit(2);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const result = await app
      .get(WhatsappSenderService)
      .sendTracerInvitation(values.guest);
    console.log(`Intent ${result.intentId}: ${result.state}`);
    if (result.state !== WhatsappMessageState.SENT) process.exitCode = 1;
  } catch (error) {
    console.error(
      error instanceof TracerError ? error.message : (error as Error).name,
    );
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void main();
