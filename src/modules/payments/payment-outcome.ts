import type { MoyasarInvoice, MoyasarPayment } from './moyasar.client';
import type { PaymentAttempt } from './entities/payment-attempt.entity';

export type InvoiceOutcome =
  | { kind: 'paid'; payment: MoyasarPayment | null }
  | { kind: 'failed'; code: string }
  | { kind: 'expired' }
  | { kind: 'pending' };

const FAILED_STATUSES = new Set(['failed', 'canceled', 'voided', 'refunded']);

/**
 * Reads a fetched invoice against the attempt that opened it (D-10, AC-05-2). Paid counts only
 * when the invoice id, amount, currency and `metadata.paymentAttemptId` all match.
 */
export function outcomeOf(
  attempt: Pick<
    PaymentAttempt,
    'id' | 'amount' | 'currency' | 'moyasarInvoiceId'
  >,
  invoice: MoyasarInvoice,
): InvoiceOutcome {
  const status = invoice.status?.toLowerCase();
  if (status === 'paid') {
    const payment =
      invoice.payments?.find((p) => p.status?.toLowerCase() === 'paid') ?? null;
    const matches =
      invoice.id === attempt.moyasarInvoiceId &&
      invoice.amount === attempt.amount &&
      invoice.currency?.toUpperCase() === attempt.currency &&
      invoice.metadata?.paymentAttemptId === attempt.id &&
      (!payment ||
        (payment.amount === attempt.amount &&
          payment.currency?.toUpperCase() === attempt.currency));
    return matches
      ? { kind: 'paid', payment }
      : { kind: 'failed', code: 'mismatch' };
  }
  if (status === 'expired') return { kind: 'expired' };
  if (FAILED_STATUSES.has(status))
    return { kind: 'failed', code: `invoice_${status}` };
  return { kind: 'pending' };
}

/** Card brand and last four digits only (data-model.md, `payment_attempts.metadata`). */
export function cardSummary(
  payment: MoyasarPayment | null,
): Record<string, string> {
  const source = payment?.source;
  if (!source) return {};
  const last4 = source.number?.replace(/\D/g, '').slice(-4);
  return {
    ...(source.type ? { sourceType: source.type } : {}),
    ...(source.company ? { brand: source.company } : {}),
    ...(last4 && last4.length === 4 ? { last4 } : {}),
  };
}
