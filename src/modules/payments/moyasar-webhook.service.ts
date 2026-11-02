import { timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { EnvironmentVariables } from '../../config/env.validation';
import { PaymentAttempt } from './entities/payment-attempt.entity';
import {
  WebhookProvider,
  WebhookReceipt,
} from './entities/webhook-receipt.entity';
import { PaymentApplyService } from './payment-apply.service';

const ID_PATTERN = /^[\w-]{1,120}$/;

const stringField = (value: unknown, key: string): string | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === 'string' ? field : undefined;
};

/** Webhook and invoice-callback handling. Both re-fetch from Moyasar before anything changes. */
@Injectable()
export class MoyasarWebhookService {
  private readonly logger = new Logger(MoyasarWebhookService.name);
  private readonly secret: Buffer | null;

  constructor(
    @InjectRepository(PaymentAttempt)
    private readonly attempts: Repository<PaymentAttempt>,
    @InjectRepository(WebhookReceipt)
    private readonly receipts: Repository<WebhookReceipt>,
    private readonly apply: PaymentApplyService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    const secret = config.get('MOYASAR_WEBHOOK_SECRET', { infer: true });
    this.secret = secret ? Buffer.from(secret) : null;
  }

  /** Timing-safe; false when no secret is configured. */
  verify(body: unknown): boolean {
    const received = stringField(body, 'secret_token');
    if (!this.secret || received === undefined) return false;
    const candidate = Buffer.from(received);
    return (
      candidate.length === this.secret.length &&
      timingSafeEqual(candidate, this.secret)
    );
  }

  /**
   * Handles one verified webhook delivery. A delivery already handled is a no-op (AC-05-3); one
   * that failed before is handled again when Moyasar retries. Throws while Moyasar is
   * unreachable, so the caller answers 5xx and Moyasar retries.
   */
  async handleWebhook(body: unknown): Promise<string> {
    const type = stringField(body, 'type');
    const data = (body as { data?: unknown }).data;
    const paymentId = stringField(data, 'id');
    if (!type || !paymentId || !ID_PATTERN.test(paymentId)) return 'ignored';

    const dedupeKey = `${paymentId}:${type}`.slice(0, 200);
    await this.receipts
      .createQueryBuilder()
      .insert()
      .values({ provider: WebhookProvider.MOYASAR, dedupeKey })
      .orIgnore()
      .execute();
    const receipt = await this.receipts.findOneByOrFail({
      provider: WebhookProvider.MOYASAR,
      dedupeKey,
    });
    if (receipt.processedAt) return 'duplicate';

    try {
      const outcome = await this.applyInvoice(stringField(data, 'invoice_id'));
      await this.receipts.update(receipt.id, {
        processedAt: new Date(),
        outcome,
        errorCode: null,
      });
      return outcome;
    } catch (error) {
      await this.receipts.update(receipt.id, { errorCode: 'provider_fetch' });
      this.logger.warn(
        `Moyasar webhook ${type} for ${paymentId}: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  /** The callback is unauthenticated; only its invoice id is used, and only if it is ours. */
  async handleInvoiceCallback(body: unknown): Promise<string> {
    return this.applyInvoice(stringField(body, 'id'));
  }

  private async applyInvoice(invoiceId: string | undefined): Promise<string> {
    if (!invoiceId || !ID_PATTERN.test(invoiceId)) return 'ignored';
    const attempt = await this.attempts.findOneBy({
      moyasarInvoiceId: invoiceId,
    });
    if (!attempt) return 'unknown_invoice';
    const result = await this.apply.refresh(attempt);
    return result.status.toLowerCase();
  }
}
