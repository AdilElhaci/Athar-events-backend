import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../../config/env.validation';
import { WhatsappMessageKind } from '../entities/whatsapp-message.entity';
import { WhatsappClient } from '../whatsapp/whatsapp.client';

const TEMPLATE_ENV = {
  [WhatsappMessageKind.FOLLOW_UP_1]: 'WHATSAPP_TEMPLATE_FOLLOWUP',
  [WhatsappMessageKind.FOLLOW_UP_2]: 'WHATSAPP_TEMPLATE_FOLLOWUP_FINAL',
  [WhatsappMessageKind.REMINDER_1]: 'WHATSAPP_TEMPLATE_REMINDER',
  [WhatsappMessageKind.REMINDER_FINAL]: 'WHATSAPP_TEMPLATE_REMINDER_FINAL',
  [WhatsappMessageKind.THANK_YOU]: 'WHATSAPP_TEMPLATE_THANKS',
  [WhatsappMessageKind.QR_TEMPLATE]: 'WHATSAPP_TEMPLATE_CONFIRMATION',
} as const satisfies Partial<
  Record<WhatsappMessageKind, keyof EnvironmentVariables>
>;
export type TemplateKind = keyof typeof TEMPLATE_ENV;

const CACHE_MS = 5 * 60_000;
const LANGUAGE = 'ar';

/**
 * Which journey templates Meta has approved (SP-07 rule 8), read from the WABA and cached for five
 * minutes. When Meta cannot be read the answer is "approved": the send itself then fails with
 * Meta's code, which is visible, instead of a step silently passing its grace period.
 */
@Injectable()
export class JourneyTemplatesService {
  private readonly logger = new Logger(JourneyTemplatesService.name);
  private cache: { at: number; approved: Set<string> } | null = null;
  private warned = new Map<string, number>();

  constructor(
    private readonly client: WhatsappClient,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  nameFor(kind: TemplateKind): string {
    return this.config.get(TEMPLATE_ENV[kind], { infer: true });
  }

  readonly language = LANGUAGE;

  async isApproved(kind: TemplateKind): Promise<boolean> {
    const name = this.nameFor(kind);
    const approved = await this.approvedNames();
    if (!approved || approved.has(name)) return true;
    const last = this.warned.get(name) ?? 0;
    if (Date.now() - last > 60 * 60_000) {
      this.warned.set(name, Date.now());
      this.logger.warn(
        `Journey template ${name} is not approved at Meta; ${kind} messages wait`,
      );
    }
    return false;
  }

  /** Forget the cache (tests, or after an admin changed templates). */
  reset(): void {
    this.cache = null;
  }

  private async approvedNames(): Promise<Set<string> | null> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS)
      return this.cache.approved;
    if (!this.client.canListTemplates()) return null;
    const result = await this.client.listTemplates().catch(() => null);
    if (!result?.ok) return null;
    const approved = new Set(
      result.templates
        .filter((t) => t.status === 'APPROVED' && t.language === LANGUAGE)
        .map((t) => t.name),
    );
    this.cache = { at: Date.now(), approved };
    return approved;
  }
}
