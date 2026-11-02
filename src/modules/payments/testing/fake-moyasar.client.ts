import {
  CreateInvoiceInput,
  MoyasarClient,
  MoyasarError,
  MoyasarInvoice,
  MoyasarPayment,
} from '../moyasar.client';

/**
 * In-memory Moyasar for tests. Invoices follow the sandbox shapes; tests move them with
 * `pay`, `fail` or `expire`, or edit `invoices` directly to simulate a tampered answer.
 */
export class FakeMoyasarClient extends MoyasarClient {
  invoices = new Map<string, MoyasarInvoice>();
  created: CreateInvoiceInput[] = [];
  fetches = 0;
  configured = true;
  /** When set, the next call throws it (a Moyasar outage). */
  failNext: MoyasarError | null = null;
  private sequence = 0;

  isConfigured(): boolean {
    return this.configured;
  }

  async createInvoice(input: CreateInvoiceInput): Promise<MoyasarInvoice> {
    await this.throwIfFailing();
    this.created.push(input);
    const id = `inv_test_${++this.sequence}`;
    const invoice: MoyasarInvoice = {
      id,
      status: 'initiated',
      amount: input.amount,
      currency: input.currency,
      url: `https://checkout.moyasar.com/invoices/${id}`,
      expired_at: input.expiresAt.toISOString(),
      metadata: { ...input.metadata },
      payments: [],
    };
    this.invoices.set(id, invoice);
    return structuredClone(invoice);
  }

  async fetchInvoice(id: string): Promise<MoyasarInvoice> {
    await this.throwIfFailing();
    this.fetches += 1;
    const invoice = this.invoices.get(id);
    if (!invoice) throw new MoyasarError('Not found', 404);
    return structuredClone(invoice);
  }

  /** The owner paid on the hosted page; returns the payment for building webhooks. */
  pay(invoiceId: string): MoyasarPayment {
    const invoice = this.invoice(invoiceId);
    const payment: MoyasarPayment = {
      id: `pay_test_${++this.sequence}`,
      status: 'paid',
      amount: invoice.amount,
      currency: invoice.currency,
      invoice_id: invoice.id,
      source: {
        type: 'creditcard',
        company: 'mada',
        number: '4201-32XX-XXXX-3333',
        message: 'APPROVED',
      },
    };
    invoice.status = 'paid';
    invoice.payments = [...(invoice.payments ?? []), payment];
    return payment;
  }

  fail(invoiceId: string): MoyasarPayment {
    const invoice = this.invoice(invoiceId);
    const payment: MoyasarPayment = {
      id: `pay_test_${++this.sequence}`,
      status: 'failed',
      amount: invoice.amount,
      currency: invoice.currency,
      invoice_id: invoice.id,
      source: { type: 'creditcard', message: 'INSUFFICIENT_FUNDS' },
    };
    invoice.payments = [...(invoice.payments ?? []), payment];
    return payment;
  }

  expire(invoiceId: string): void {
    this.invoice(invoiceId).status = 'expired';
  }

  invoice(id: string): MoyasarInvoice {
    const invoice = this.invoices.get(id);
    if (!invoice) throw new Error(`Unknown fake invoice ${id}`);
    return invoice;
  }

  /** Async like the real client: failures arrive as rejected promises. */
  private throwIfFailing(): Promise<void> {
    const failure = this.failNext;
    this.failNext = null;
    return failure ? Promise.reject(failure) : Promise.resolve();
  }
}
