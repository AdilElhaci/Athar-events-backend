import type { MoyasarInvoice } from './moyasar.client';
import { cardSummary, outcomeOf } from './payment-outcome';

const attempt = {
  id: 'a1',
  amount: 150_000,
  currency: 'SAR',
  moyasarInvoiceId: 'inv_1',
};
const payment = {
  id: 'pay_1',
  status: 'paid',
  amount: 150_000,
  currency: 'SAR',
  invoice_id: 'inv_1',
};
const paid = (changes: Partial<MoyasarInvoice> = {}): MoyasarInvoice => ({
  id: 'inv_1',
  status: 'paid',
  amount: 150_000,
  currency: 'SAR',
  metadata: { paymentAttemptId: 'a1' },
  payments: [payment],
  ...changes,
});

describe('outcomeOf', () => {
  it('accepts a paid invoice that matches the attempt', () => {
    expect(outcomeOf(attempt, paid())).toEqual({ kind: 'paid', payment });
    expect(outcomeOf(attempt, paid({ currency: 'sar' })).kind).toBe('paid');
  });

  it.each([
    ['another invoice', { id: 'inv_2' }],
    ['another amount', { amount: 100 }],
    ['another currency', { currency: 'USD' }],
    ['another attempt', { metadata: { paymentAttemptId: 'a2' } }],
    ['no metadata', { metadata: null }],
    ['a payment of another amount', { payments: [{ ...payment, amount: 1 }] }],
  ])('refuses a paid invoice with %s', (_, changes) => {
    expect(outcomeOf(attempt, paid(changes))).toEqual({
      kind: 'failed',
      code: 'mismatch',
    });
  });

  it('maps the other invoice states', () => {
    expect(outcomeOf(attempt, paid({ status: 'initiated' })).kind).toBe(
      'pending',
    );
    expect(outcomeOf(attempt, paid({ status: 'on_hold' })).kind).toBe(
      'pending',
    );
    expect(outcomeOf(attempt, paid({ status: 'expired' })).kind).toBe(
      'expired',
    );
    expect(outcomeOf(attempt, paid({ status: 'canceled' }))).toEqual({
      kind: 'failed',
      code: 'invoice_canceled',
    });
  });
});

describe('cardSummary', () => {
  it('keeps the brand and last four digits only', () => {
    expect(
      cardSummary({
        ...payment,
        source: {
          type: 'creditcard',
          company: 'visa',
          number: '4111-11XX-XXXX-1111',
          message: 'APPROVED',
        },
      }),
    ).toEqual({ sourceType: 'creditcard', brand: 'visa', last4: '1111' });
    expect(cardSummary(null)).toEqual({});
  });
});
