import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation';

/** The fields of a Moyasar payment this module reads. */
export interface MoyasarPayment {
  id: string;
  status: string;
  amount: number;
  currency: string;
  invoice_id?: string | null;
  source?: {
    type?: string;
    company?: string;
    number?: string;
    message?: string | null;
  } | null;
}

/** The fields of a Moyasar hosted invoice this module reads. */
export interface MoyasarInvoice {
  id: string;
  status: string;
  amount: number;
  currency: string;
  url?: string;
  expired_at?: string | null;
  metadata?: Record<string, unknown> | null;
  payments?: MoyasarPayment[] | null;
}

export interface CreateInvoiceInput {
  amount: number;
  currency: string;
  description: string;
  successUrl: string;
  backUrl: string;
  /** Omitted when the API has no public HTTPS address (local development). */
  callbackUrl?: string;
  expiresAt: Date;
  metadata: Record<string, string>;
}

/** A failed call; `status` is undefined when Moyasar never answered (timeout, network). */
export class MoyasarError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** The DI token and the contract; e2e tests swap in `FakeMoyasarClient`. */
export abstract class MoyasarClient {
  abstract isConfigured(): boolean;
  abstract createInvoice(input: CreateInvoiceInput): Promise<MoyasarInvoice>;
  abstract fetchInvoice(id: string): Promise<MoyasarInvoice>;
}

const TIMEOUT_MS = 10_000;

@Injectable()
export class HttpMoyasarClient extends MoyasarClient {
  private readonly secretKey: string;
  private readonly baseUrl: string;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    super();
    this.secretKey = config.get('MOYASAR_SECRET_KEY', { infer: true }) ?? '';
    this.baseUrl = config
      .get('MOYASAR_API_BASE_URL', { infer: true })
      .replace(/\/+$/, '');
  }

  isConfigured(): boolean {
    return this.secretKey.length > 0;
  }

  createInvoice(input: CreateInvoiceInput): Promise<MoyasarInvoice> {
    return this.request('POST', '/invoices', {
      amount: input.amount,
      currency: input.currency,
      description: input.description,
      success_url: input.successUrl,
      back_url: input.backUrl,
      ...(input.callbackUrl ? { callback_url: input.callbackUrl } : {}),
      expired_at: input.expiresAt.toISOString(),
      metadata: input.metadata,
    });
  }

  fetchInvoice(id: string): Promise<MoyasarInvoice> {
    return this.request('GET', `/invoices/${encodeURIComponent(id)}`);
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    if (!this.isConfigured())
      throw new MoyasarError('Moyasar secret key is not configured');
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.secretKey}:`).toString('base64')}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new MoyasarError(
        `Moyasar ${method} ${path.split('/')[1]} failed: ${(error as Error).name}`,
      );
    }
    // Only the status is surfaced: error bodies can echo request fields.
    if (!response.ok)
      throw new MoyasarError(
        `Moyasar ${method} ${path.split('/')[1]} answered ${response.status}`,
        response.status,
      );
    return (await response.json()) as T;
  }
}
