import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { EnvironmentVariables } from '../../../config/env.validation';
import {
  badRequest,
  conflict,
  serviceUnavailable,
  unprocessable,
} from '../../../shared/exceptions/app.exception';
import { AdminAction } from '../../admin-actions/admin-action.entity';
import { CreateWhatsappTemplateDto } from '../dto/whatsapp-template.dto';
import {
  MessageTemplate,
  TemplateWriteOutcome,
  WhatsappClient,
} from './whatsapp.client';

export interface WhatsappTemplatesView {
  /** False when the access token or WABA id is not set; `templates` is then empty. */
  configured: boolean;
  /** The template campaigns send, and the status scheduling trusts (env, ADR-0003). */
  invitationTemplate: {
    name: string;
    configuredStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
    /** Meta's status for that name, or null when Meta has no such template. */
    metaStatus: string | null;
  };
  templates: MessageTemplate[];
}

const VARIABLE = /\{\{\s*(\d+)\s*\}\}/g;

/**
 * Meta's body-variable rules: {{1}}…{{n}} with no gaps, one example per variable, no stray
 * braces, and the text must not start or end with a variable. True when valid.
 */
export function bodyVariablesValid(body: string, examples: string[]): boolean {
  const numbers = [...body.matchAll(VARIABLE)].map((m) => Number(m[1]));
  const distinct = [...new Set(numbers)].sort((a, b) => a - b);
  if (distinct.some((n, i) => n !== i + 1)) return false;
  if (examples.length !== distinct.length) return false;
  if (/\{\{|\}\}/.test(body.replace(VARIABLE, ''))) return false;
  if (distinct.length > 0) {
    const trimmed = body.trim();
    if (/^\{\{\s*\d+\s*\}\}/.test(trimmed)) return false;
    if (/\{\{\s*\d+\s*\}\}[\s.!؟?،,]*$/.test(trimmed)) return false;
  }
  return true;
}

/** Header and footer: one line, no variables. */
const plainLine = (text?: string) =>
  text === undefined || (!/[\r\n]/.test(text) && !/\{\{|\}\}/.test(text));

/**
 * Message templates on the client's WABA. Admins may create and delete any template except the
 * invitation template campaigns send (D-41); that one stays managed in WhatsApp Manager.
 */
@Injectable()
export class WhatsappTemplatesService {
  private readonly logger = new Logger(WhatsappTemplatesService.name);

  constructor(
    private readonly client: WhatsappClient,
    private readonly config: ConfigService<EnvironmentVariables, true>,
    @InjectRepository(AdminAction)
    private readonly actions: Repository<AdminAction>,
  ) {}

  private get invitationName(): string {
    return this.config.get('WHATSAPP_INVITATION_TEMPLATE', { infer: true });
  }

  async list(): Promise<WhatsappTemplatesView> {
    const name = this.invitationName;
    const configuredStatus = this.config.get(
      'WHATSAPP_INVITATION_TEMPLATE_STATUS',
      { infer: true },
    );
    if (!this.client.canListTemplates())
      return {
        configured: false,
        invitationTemplate: { name, configuredStatus, metaStatus: null },
        templates: [],
      };

    const result = await this.client.listTemplates();
    if (!result.ok) {
      this.logger.warn(`Template list failed: ${result.code}`);
      throw serviceUnavailable('whatsapp.templates_unavailable');
    }
    const templates = [...result.templates].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    // One name can exist in several languages; Arabic is what campaigns send.
    const match =
      templates.find((t) => t.name === name && t.language.startsWith('ar')) ??
      templates.find((t) => t.name === name);
    return {
      configured: true,
      invitationTemplate: {
        name,
        configuredStatus,
        metaStatus: match?.status ?? null,
      },
      templates,
    };
  }

  async create(
    actorUserId: string,
    dto: CreateWhatsappTemplateDto,
  ): Promise<void> {
    if (dto.name === this.invitationName)
      throw conflict('whatsapp.template_reserved');
    if (!plainLine(dto.headerText) || !plainLine(dto.footerText))
      throw badRequest('whatsapp.template_header_invalid');
    if (!bodyVariablesValid(dto.body, dto.bodyExamples))
      throw badRequest('whatsapp.template_variables_invalid');

    const result = await this.client.createTemplate({
      name: dto.name,
      language: dto.language,
      category: dto.category,
      headerText: dto.headerText,
      body: dto.body,
      bodyExamples: dto.bodyExamples,
      footerText: dto.footerText,
      quickReplies: dto.quickReplies,
    });
    this.failIfNot(result, 'whatsapp.template_create_failed');
    await this.audit(actorUserId, 'whatsapp.template_create', {
      name: dto.name,
      language: dto.language,
      category: dto.category,
      metaId: result.ok ? result.id : null,
    });
  }

  async remove(actorUserId: string, id: string, name: string): Promise<void> {
    if (name === this.invitationName)
      throw conflict('whatsapp.template_reserved');
    const result = await this.client.deleteTemplate(id, name);
    this.failIfNot(result, 'whatsapp.template_delete_failed');
    await this.audit(actorUserId, 'whatsapp.template_delete', {
      name,
      metaId: id,
    });
  }

  private failIfNot(
    result: TemplateWriteOutcome,
    rejected:
      'whatsapp.template_create_failed' | 'whatsapp.template_delete_failed',
  ): void {
    if (result.ok) return;
    this.logger.warn(`Template write failed: ${result.code}`);
    switch (result.reason) {
      case 'not_configured':
        throw serviceUnavailable('whatsapp.not_configured');
      case 'network':
        throw serviceUnavailable('whatsapp.unreachable');
      case 'exists':
        throw conflict('whatsapp.template_exists');
      default:
        throw unprocessable(
          rejected,
          result.userMessage ? [result.userMessage] : undefined,
        );
    }
  }

  private async audit(
    actorUserId: string,
    action: string,
    summary: Record<string, unknown>,
  ): Promise<void> {
    await this.actions.save({
      actorUserId,
      action,
      targetType: 'whatsapp_template',
      targetId: null,
      summary,
    });
  }
}
