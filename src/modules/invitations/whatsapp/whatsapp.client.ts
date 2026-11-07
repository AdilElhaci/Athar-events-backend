import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../../config/env.validation';

/**
 * The outcome of one send, classified for the sending invariants (AGENTS.md):
 * - `SENT`: Meta accepted it and returned a `wamid`.
 * - `FAILED`: a definite rejection; never retried.
 * - `RETRY`: definitely not sent (rate limit, connection refused); safe to try again.
 * - `UNKNOWN`: may have been sent (timeout after the request left, 5xx); never resent automatically.
 * `code` is a short provider code, never a payload.
 */
export type SendOutcome =
  | { outcome: 'SENT'; messageId: string }
  | { outcome: 'FAILED' | 'RETRY' | 'UNKNOWN'; code: string };

export interface TemplateMessage {
  name: string;
  language: string;
  /** Body variables {{1}}…{{n}}, in order. */
  bodyParameters: string[];
  /** Quick-reply payloads by button index. */
  quickReplyPayloads: string[];
}

export type UploadOutcome =
  { ok: true; mediaId: string } | { ok: false; retry: boolean; code: string };

/** The DI token and the contract; e2e tests swap in `FakeWhatsappClient`. */
export abstract class WhatsappClient {
  abstract isConfigured(): boolean;
  /** `to` is `+9665…`; the leading plus is dropped for Meta. */
  abstract sendTemplate(
    to: string,
    template: TemplateMessage,
  ): Promise<SendOutcome>;
  abstract uploadPng(png: Buffer): Promise<UploadOutcome>;
  abstract sendImage(
    to: string,
    mediaId: string,
    caption: string,
  ): Promise<SendOutcome>;
}

const TIMEOUT_MS = 15_000;
/** Meta throughput and spam limits: the message was not accepted, try later. */
const RATE_LIMIT_CODES = new Set([4, 80007, 130429, 131048, 131056]);
/** Connection never established: nothing reached Meta. */
const NOT_SENT_NETWORK = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']);

const errorCode = (body: unknown): number | undefined => {
  const error = (body as { error?: { code?: unknown } } | null)?.error;
  return typeof error?.code === 'number' ? error.code : undefined;
};

const networkCode = (error: unknown): string | undefined => {
  const cause = (error as { cause?: { code?: unknown } }).cause;
  return typeof cause?.code === 'string' ? cause.code : undefined;
};

@Injectable()
export class HttpWhatsappClient extends WhatsappClient {
  private readonly token: string;
  private readonly phoneNumberId: string;
  private readonly baseUrl: string;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    super();
    this.token = config.get('WHATSAPP_ACCESS_TOKEN', { infer: true }) ?? '';
    this.phoneNumberId =
      config.get('WHATSAPP_PHONE_NUMBER_ID', { infer: true }) ?? '';
    const base = config
      .get('WHATSAPP_GRAPH_BASE_URL', { infer: true })
      .replace(/\/+$/, '');
    this.baseUrl = `${base}/${config.get('WHATSAPP_GRAPH_VERSION', { infer: true })}`;
  }

  isConfigured(): boolean {
    return this.token.length > 0 && this.phoneNumberId.length > 0;
  }

  sendTemplate(to: string, template: TemplateMessage): Promise<SendOutcome> {
    return this.sendMessage({
      to: to.replace(/^\+/, ''),
      type: 'template',
      template: {
        name: template.name,
        language: { code: template.language },
        components: [
          {
            type: 'body',
            parameters: template.bodyParameters.map((text) => ({
              type: 'text',
              text,
            })),
          },
          ...template.quickReplyPayloads.map((payload, index) => ({
            type: 'button',
            sub_type: 'quick_reply',
            index: String(index),
            parameters: [{ type: 'payload', payload }],
          })),
        ],
      },
    });
  }

  sendImage(
    to: string,
    mediaId: string,
    caption: string,
  ): Promise<SendOutcome> {
    return this.sendMessage({
      to: to.replace(/^\+/, ''),
      type: 'image',
      image: { id: mediaId, caption },
    });
  }

  async uploadPng(png: Buffer): Promise<UploadOutcome> {
    if (!this.isConfigured())
      return { ok: false, retry: false, code: 'not_configured' };
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', 'image/png');
    form.append(
      'file',
      new Blob([new Uint8Array(png)], { type: 'image/png' }),
      'qr.png',
    );
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/${this.phoneNumberId}/media`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.token}` },
        body: form,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      // An upload creates nothing the guest sees, so any network failure is safe to retry.
      return { ok: false, retry: true, code: networkCode(error) ?? 'network' };
    }
    const body = (await response.json().catch(() => null)) as {
      id?: unknown;
    } | null;
    if (response.ok && typeof body?.id === 'string')
      return { ok: true, mediaId: body.id };
    const code = errorCode(body);
    return {
      ok: false,
      retry: response.status >= 500 || response.status === 429,
      code: `meta_${code ?? response.status}`,
    };
  }

  private async sendMessage(
    payload: Record<string, unknown>,
  ): Promise<SendOutcome> {
    if (!this.isConfigured())
      return { outcome: 'FAILED', code: 'not_configured' };
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/${this.phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      const code = networkCode(error);
      if (code && NOT_SENT_NETWORK.has(code)) return { outcome: 'RETRY', code };
      return { outcome: 'UNKNOWN', code: code ?? (error as Error).name };
    }
    const body = (await response.json().catch(() => null)) as {
      messages?: Array<{ id?: unknown }>;
    } | null;
    const messageId = body?.messages?.[0]?.id;
    if (response.ok && typeof messageId === 'string')
      return { outcome: 'SENT', messageId };
    if (response.ok) return { outcome: 'UNKNOWN', code: 'no_message_id' };
    const code = errorCode(body);
    if (response.status === 429 || (code && RATE_LIMIT_CODES.has(code)))
      return { outcome: 'RETRY', code: `meta_${code ?? 429}` };
    if (response.status >= 500)
      return { outcome: 'UNKNOWN', code: `meta_${code ?? response.status}` };
    return { outcome: 'FAILED', code: `meta_${code ?? response.status}` };
  }
}
