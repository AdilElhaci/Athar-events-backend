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

/** One message template as Meta reports it (read-only; templates are managed in WhatsApp Manager). */
export interface MessageTemplate {
  id: string;
  name: string;
  language: string;
  /** `MARKETING`, `UTILITY` or `AUTHENTICATION`, as Meta assigned it. */
  category: string;
  /** `APPROVED`, `PENDING`, `REJECTED`, `PAUSED`, `DISABLED`, … */
  status: string;
  rejectedReason: string | null;
  /** The BODY component text with its {{n}} placeholders. */
  body: string | null;
  /** Button labels in order. */
  buttons: string[];
}

export type TemplatesOutcome =
  { ok: true; templates: MessageTemplate[] } | { ok: false; code: string };

/** A template to submit to Meta for review; the service validates it first. */
export interface NewTemplate {
  name: string;
  language: string;
  category: 'MARKETING' | 'UTILITY';
  headerText?: string;
  /** Body text with {{1}}…{{n}}. */
  body: string;
  /** One sample value per body variable, in order (Meta requires them for review). */
  bodyExamples: string[];
  footerText?: string;
  quickReplies: string[];
}

/**
 * `exists`: Meta already has this name in this language. `network`: Meta was not reached.
 * `userMessage` is Meta's explanation for the admin; it is shown, never logged.
 */
export type TemplateWriteOutcome =
  | { ok: true; id: string; status: string }
  | {
      ok: false;
      reason: 'exists' | 'rejected' | 'network' | 'not_configured';
      code: string;
      userMessage?: string;
    };

/** The DI token and the contract; e2e tests swap in `FakeWhatsappClient`. */
export abstract class WhatsappClient {
  abstract isConfigured(): boolean;
  /** Token and WABA id are set, so templates can be read. */
  abstract canListTemplates(): boolean;
  abstract listTemplates(): Promise<TemplatesOutcome>;
  abstract createTemplate(template: NewTemplate): Promise<TemplateWriteOutcome>;
  /** Deletes the template with this Meta id; Meta checks that the name matches. */
  abstract deleteTemplate(
    id: string,
    name: string,
  ): Promise<TemplateWriteOutcome>;
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

/** Meta pages templates; stop after this many pages so a bad `next` link cannot loop. */
const MAX_TEMPLATE_PAGES = 10;
const TEMPLATE_FIELDS =
  'id,name,language,status,category,rejected_reason,components';

interface RawTemplate {
  id?: unknown;
  name?: unknown;
  language?: unknown;
  status?: unknown;
  category?: unknown;
  rejected_reason?: unknown;
  components?: Array<{
    type?: unknown;
    text?: unknown;
    buttons?: Array<{ text?: unknown }>;
  }>;
}

const str = (value: unknown): string =>
  typeof value === 'string' ? value : '';

/** Meta's error subcode for "a template with this name and language already exists". */
const TEMPLATE_EXISTS_SUBCODE = 2388024;

const metaUserMessage = (body: unknown): string | undefined => {
  const error = (
    body as {
      error?: { error_user_msg?: unknown; error_user_title?: unknown };
    } | null
  )?.error;
  const text = str(error?.error_user_msg) || str(error?.error_user_title);
  return text ? text.slice(0, 500) : undefined;
};

const metaSubcode = (body: unknown): number | undefined => {
  const sub = (body as { error?: { error_subcode?: unknown } } | null)?.error
    ?.error_subcode;
  return typeof sub === 'number' ? sub : undefined;
};

/** The Graph API `components` array for a new template. */
export const toTemplateComponents = (t: NewTemplate): unknown[] => [
  ...(t.headerText
    ? [{ type: 'HEADER', format: 'TEXT', text: t.headerText }]
    : []),
  {
    type: 'BODY',
    text: t.body,
    ...(t.bodyExamples.length > 0
      ? { example: { body_text: [t.bodyExamples] } }
      : {}),
  },
  ...(t.footerText ? [{ type: 'FOOTER', text: t.footerText }] : []),
  ...(t.quickReplies.length > 0
    ? [
        {
          type: 'BUTTONS',
          buttons: t.quickReplies.map((text) => ({
            type: 'QUICK_REPLY',
            text,
          })),
        },
      ]
    : []),
];

export const toMessageTemplate = (raw: RawTemplate): MessageTemplate => {
  const components = Array.isArray(raw.components) ? raw.components : [];
  const body = components.find((c) => c.type === 'BODY');
  const buttons = components.find((c) => c.type === 'BUTTONS');
  const reason = str(raw.rejected_reason);
  return {
    id: str(raw.id),
    name: str(raw.name),
    language: str(raw.language),
    category: str(raw.category),
    status: str(raw.status),
    // Meta sends "NONE" when there is no rejection.
    rejectedReason: reason && reason !== 'NONE' ? reason : null,
    body: typeof body?.text === 'string' ? body.text : null,
    buttons: (Array.isArray(buttons?.buttons) ? buttons.buttons : [])
      .map((b) => str(b.text))
      .filter(Boolean),
  };
};

const networkCode = (error: unknown): string | undefined => {
  const cause = (error as { cause?: { code?: unknown } }).cause;
  return typeof cause?.code === 'string' ? cause.code : undefined;
};

@Injectable()
export class HttpWhatsappClient extends WhatsappClient {
  private readonly token: string;
  private readonly phoneNumberId: string;
  private readonly wabaId: string;
  private readonly baseUrl: string;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    super();
    this.token = config.get('WHATSAPP_ACCESS_TOKEN', { infer: true }) ?? '';
    this.phoneNumberId =
      config.get('WHATSAPP_PHONE_NUMBER_ID', { infer: true }) ?? '';
    this.wabaId = config.get('WHATSAPP_WABA_ID', { infer: true }) ?? '';
    const base = config
      .get('WHATSAPP_GRAPH_BASE_URL', { infer: true })
      .replace(/\/+$/, '');
    this.baseUrl = `${base}/${config.get('WHATSAPP_GRAPH_VERSION', { infer: true })}`;
  }

  isConfigured(): boolean {
    return this.token.length > 0 && this.phoneNumberId.length > 0;
  }

  canListTemplates(): boolean {
    return this.token.length > 0 && this.wabaId.length > 0;
  }

  async listTemplates(): Promise<TemplatesOutcome> {
    if (!this.canListTemplates()) return { ok: false, code: 'not_configured' };
    const templates: MessageTemplate[] = [];
    const first = new URL(`${this.baseUrl}/${this.wabaId}/message_templates`);
    first.searchParams.set('fields', TEMPLATE_FIELDS);
    first.searchParams.set('limit', '100');
    let next: string | undefined = first.toString();
    for (let page = 0; next && page < MAX_TEMPLATE_PAGES; page++) {
      let response: Response;
      try {
        response = await fetch(next, {
          headers: { Authorization: `Bearer ${this.token}` },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (error) {
        return { ok: false, code: networkCode(error) ?? 'network' };
      }
      const body = (await response.json().catch(() => null)) as {
        data?: RawTemplate[];
        paging?: { next?: unknown };
      } | null;
      if (!response.ok || !Array.isArray(body?.data))
        return {
          ok: false,
          code: `meta_${errorCode(body) ?? response.status}`,
        };
      templates.push(...body.data.map(toMessageTemplate));
      next =
        typeof body.paging?.next === 'string' ? body.paging.next : undefined;
    }
    return { ok: true, templates };
  }

  createTemplate(template: NewTemplate): Promise<TemplateWriteOutcome> {
    return this.writeTemplate(
      `${this.baseUrl}/${this.wabaId}/message_templates`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: template.name,
          language: template.language,
          category: template.category,
          components: toTemplateComponents(template),
        }),
      },
    );
  }

  deleteTemplate(id: string, name: string): Promise<TemplateWriteOutcome> {
    const url = new URL(`${this.baseUrl}/${this.wabaId}/message_templates`);
    url.searchParams.set('hsm_id', id);
    url.searchParams.set('name', name);
    return this.writeTemplate(url.toString(), {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${this.token}` },
    });
  }

  private async writeTemplate(
    url: string,
    init: RequestInit,
  ): Promise<TemplateWriteOutcome> {
    if (!this.canListTemplates())
      return { ok: false, reason: 'not_configured', code: 'not_configured' };
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      return {
        ok: false,
        reason: 'network',
        code: networkCode(error) ?? (error as Error).name,
      };
    }
    const body = (await response.json().catch(() => null)) as {
      id?: unknown;
      status?: unknown;
      success?: unknown;
    } | null;
    if (response.ok && (typeof body?.id === 'string' || body?.success === true))
      return { ok: true, id: str(body?.id), status: str(body?.status) };
    const code = `meta_${errorCode(body) ?? response.status}`;
    if (response.status >= 500 || response.status === 429)
      return { ok: false, reason: 'network', code };
    return {
      ok: false,
      reason:
        metaSubcode(body) === TEMPLATE_EXISTS_SUBCODE ? 'exists' : 'rejected',
      code,
      userMessage: metaUserMessage(body),
    };
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
