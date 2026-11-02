import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, MoreThan, Repository } from 'typeorm';
import type { EnvironmentVariables } from '../../config/env.validation';
import {
  conflict,
  notFound,
  serviceUnavailable,
  unprocessable,
} from '../../shared/exceptions/app.exception';
import {
  Event,
  EventPaymentStatus,
  EventStatus,
} from '../events/entities/event.entity';
import {
  PaymentAttempt,
  PaymentAttemptStatus,
} from './entities/payment-attempt.entity';
import { MoyasarClient, MoyasarInvoice } from './moyasar.client';
import { PaymentApplyService } from './payment-apply.service';

const MINUTE_MS = 60_000;
/** How long a hosted invoice accepts payment. */
const INVOICE_TTL_MS = 120 * MINUTE_MS;
/** An open invoice is reused only if the owner still has this long to pay it. */
const REUSE_MARGIN_MS = 15 * MINUTE_MS;
/** The status endpoint asks Moyasar at most this often per attempt. */
const STATUS_FETCH_INTERVAL_MS = 5_000;

export interface CheckoutView {
  paymentUrl: string;
  paymentAttemptId: string;
}

export interface PaymentStatusView {
  paymentStatus: EventPaymentStatus;
  attemptStatus: PaymentAttemptStatus | null;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly appOrigin: string;

  constructor(
    @InjectRepository(PaymentAttempt)
    private readonly attempts: Repository<PaymentAttempt>,
    @InjectRepository(Event) private readonly events: Repository<Event>,
    private readonly dataSource: DataSource,
    private readonly moyasar: MoyasarClient,
    private readonly apply: PaymentApplyService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.appOrigin = config
      .get('APP_ORIGIN', { infer: true })
      .replace(/\/+$/, '');
  }

  /**
   * Opens (or reuses) a hosted invoice for the snapshot price (AC-05-1). The event row stays
   * locked while Moyasar answers, so two clicks never open two invoices.
   */
  checkout(ownerId: string, eventId: string): Promise<CheckoutView> {
    return this.dataSource.transaction(async (manager) => {
      const event = await manager.findOne(Event, {
        where: { id: eventId, ownerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!event) throw notFound();
      if (event.paymentStatus === EventPaymentStatus.PAID)
        throw conflict('events.already_paid');
      if (
        event.paymentStatus === EventPaymentStatus.REFUNDED ||
        (event.status !== EventStatus.DRAFT &&
          event.status !== EventStatus.ACTIVE)
      )
        throw conflict('events.closed');
      if (event.startsAt.getTime() <= Date.now())
        throw unprocessable('events.starts_in_past');

      const open = await manager.findOne(PaymentAttempt, {
        where: {
          eventId,
          status: PaymentAttemptStatus.PENDING,
          expiresAt: MoreThan(new Date(Date.now() + REUSE_MARGIN_MS)),
        },
        order: { createdAt: 'DESC' },
      });
      if (open?.paymentUrl)
        return { paymentUrl: open.paymentUrl, paymentAttemptId: open.id };

      if (!this.moyasar.isConfigured())
        throw serviceUnavailable('payments.unavailable');

      const id = randomUUID();
      const expiresAt = new Date(Date.now() + INVOICE_TTL_MS);
      const eventUrl = `${this.appOrigin}/dashboard/events/${event.id}`;
      let invoice: MoyasarInvoice;
      try {
        invoice = await this.moyasar.createInvoice({
          amount: event.priceHalalas,
          currency: event.currency,
          description: `${event.referenceCode} · باقة ${event.packageName}`,
          successUrl: `${eventUrl}/payment?attemptId=${id}`,
          backUrl: eventUrl,
          // Moyasar must reach the callback; a local http origin cannot be reached.
          callbackUrl: this.appOrigin.startsWith('https://')
            ? `${this.appOrigin}/api/payments/moyasar/invoice-callback`
            : undefined,
          expiresAt,
          metadata: {
            paymentAttemptId: id,
            eventId: event.id,
            referenceCode: event.referenceCode,
          },
        });
      } catch (error) {
        this.logger.error(
          `Checkout for event ${event.id}: ${(error as Error).message}`,
        );
        throw serviceUnavailable('payments.unavailable');
      }
      if (!invoice.url) {
        this.logger.error(`Checkout for event ${event.id}: invoice has no url`);
        throw serviceUnavailable('payments.unavailable');
      }

      await manager.insert(PaymentAttempt, {
        id,
        eventId: event.id,
        ownerId,
        amount: event.priceHalalas,
        currency: event.currency,
        status: PaymentAttemptStatus.PENDING,
        moyasarInvoiceId: invoice.id,
        paymentUrl: invoice.url,
        expiresAt,
      });
      if (event.paymentStatus === EventPaymentStatus.UNPAID) {
        event.paymentStatus = EventPaymentStatus.PENDING;
        await manager.save(event);
      }
      return { paymentUrl: invoice.url, paymentAttemptId: id };
    });
  }

  /**
   * Polled by the payment return page. A pending attempt is checked with Moyasar, so the
   * owner sees the result even before the webhook arrives; the browser itself proves nothing.
   */
  async status(
    ownerId: string,
    eventId: string,
    attemptId?: string,
  ): Promise<PaymentStatusView> {
    const event = await this.events.findOneBy({ id: eventId, ownerId });
    if (!event) throw notFound();
    let attempt = await this.attempts.findOne({
      where: attemptId ? { id: attemptId, eventId } : { eventId },
      order: { createdAt: 'DESC' },
    });
    if (attemptId && !attempt) throw notFound();

    const stale =
      !attempt?.lastReconciledAt ||
      Date.now() - attempt.lastReconciledAt.getTime() >
        STATUS_FETCH_INTERVAL_MS;
    if (attempt?.status === PaymentAttemptStatus.PENDING && stale) {
      try {
        attempt = await this.apply.refresh(attempt);
      } catch (error) {
        // Moyasar is unreachable: answer with what is known; the job retries later.
        this.logger.warn(
          `Status check for attempt ${attempt.id}: ${(error as Error).message}`,
        );
      }
    }
    const current = await this.events.findOneByOrFail({ id: eventId });
    return {
      paymentStatus: current.paymentStatus,
      attemptStatus: attempt?.status ?? null,
    };
  }
}
