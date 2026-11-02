import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager, Not } from 'typeorm';
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
import { cardSummary, outcomeOf } from './payment-outcome';

/**
 * The single path that changes a payment (SP-02 "Apply payment"). Webhook, invoice callback,
 * reconciliation and the status endpoint all end here, always with an invoice fetched from
 * Moyasar by the server, never with what the caller sent.
 */
@Injectable()
export class PaymentApplyService {
  private readonly logger = new Logger(PaymentApplyService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly moyasar: MoyasarClient,
  ) {}

  /** Fetches the attempt's invoice from Moyasar and applies it. Throws `MoyasarError` on outage. */
  async refresh(attempt: PaymentAttempt): Promise<PaymentAttempt> {
    if (
      attempt.status !== PaymentAttemptStatus.PENDING ||
      !attempt.moyasarInvoiceId
    )
      return attempt;
    const invoice = await this.moyasar.fetchInvoice(attempt.moyasarInvoiceId);
    return this.apply(attempt.id, invoice);
  }

  /** Idempotent: an attempt that is no longer `PENDING` is returned unchanged. */
  apply(attemptId: string, invoice: MoyasarInvoice): Promise<PaymentAttempt> {
    return this.dataSource.transaction(async (manager) => {
      const { eventId } = await manager.findOneByOrFail(PaymentAttempt, {
        id: attemptId,
      });
      // Lock order everywhere in payments: event, then attempt.
      const event = await manager.findOneOrFail(Event, {
        where: { id: eventId },
        lock: { mode: 'pessimistic_write' },
      });
      const attempt = await manager.findOneOrFail(PaymentAttempt, {
        where: { id: attemptId },
        lock: { mode: 'pessimistic_write' },
      });
      if (attempt.status !== PaymentAttemptStatus.PENDING) return attempt;

      const now = new Date();
      attempt.lastReconciledAt = now;
      const outcome = outcomeOf(attempt, invoice);

      switch (outcome.kind) {
        case 'pending':
          return manager.save(attempt);
        case 'expired':
          attempt.status = PaymentAttemptStatus.EXPIRED;
          attempt.failureCode = 'invoice_expired';
          break;
        case 'failed':
          attempt.status = PaymentAttemptStatus.FAILED;
          attempt.failureCode = outcome.code;
          if (outcome.code === 'mismatch')
            this.logger.error(
              `Payment attempt ${attempt.id}: paid invoice does not match the attempt`,
            );
          break;
        case 'paid': {
          attempt.moyasarPaymentId = outcome.payment?.id ?? null;
          attempt.metadata = cardSummary(outcome.payment);
          const payable =
            event.paymentStatus !== EventPaymentStatus.PAID &&
            event.paymentStatus !== EventPaymentStatus.REFUNDED &&
            (event.status === EventStatus.DRAFT ||
              event.status === EventStatus.ACTIVE);
          if (!payable) {
            // Money was taken but cannot activate anything: refunded by hand (T-P2-09).
            attempt.status = PaymentAttemptStatus.FAILED;
            attempt.failureCode =
              event.paymentStatus === EventPaymentStatus.PAID
                ? 'duplicate_payment'
                : 'event_not_payable';
            this.logger.warn(
              `Payment attempt ${attempt.id} was paid but not applied (${attempt.failureCode}); refund manually`,
            );
            return manager.save(attempt);
          }
          attempt.status = PaymentAttemptStatus.PAID;
          attempt.paidAt = now;
          await manager.save(attempt);
          event.paymentStatus = EventPaymentStatus.PAID;
          event.status = EventStatus.ACTIVE;
          event.paidAt = now;
          await manager.save(event);
          this.logger.log(`Event ${event.id} paid (attempt ${attempt.id})`);
          return attempt;
        }
      }

      await manager.save(attempt);
      await this.releasePending(manager, event, attempt.id);
      return attempt;
    });
  }

  /** Marks a `PENDING` attempt expired without asking Moyasar (its invoice is long past expiry). */
  expire(attemptId: string): Promise<void> {
    return this.dataSource.transaction(async (manager) => {
      const { eventId } = await manager.findOneByOrFail(PaymentAttempt, {
        id: attemptId,
      });
      const event = await manager.findOneOrFail(Event, {
        where: { id: eventId },
        lock: { mode: 'pessimistic_write' },
      });
      const attempt = await manager.findOneOrFail(PaymentAttempt, {
        where: { id: attemptId },
        lock: { mode: 'pessimistic_write' },
      });
      if (attempt.status !== PaymentAttemptStatus.PENDING) return;
      attempt.status = PaymentAttemptStatus.EXPIRED;
      attempt.failureCode = 'not_confirmed';
      await manager.save(attempt);
      await this.releasePending(manager, event, attempt.id);
    });
  }

  /** The event goes back to `UNPAID` once no other attempt can still be paid. */
  private async releasePending(
    manager: EntityManager,
    event: Event,
    attemptId: string,
  ) {
    if (event.paymentStatus !== EventPaymentStatus.PENDING) return;
    const open = await manager.countBy(PaymentAttempt, {
      eventId: event.id,
      status: PaymentAttemptStatus.PENDING,
      id: Not(attemptId),
    });
    if (open > 0) return;
    event.paymentStatus = EventPaymentStatus.UNPAID;
    await manager.save(event);
  }
}
