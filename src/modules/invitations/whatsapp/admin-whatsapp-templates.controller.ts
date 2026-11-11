import { Controller, Get, Logger, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { EnvironmentVariables } from '../../../config/env.validation';
import { serviceUnavailable } from '../../../shared/exceptions/app.exception';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import {
  RequireUserType,
  UserTypeGuard,
} from '../../auth/guards/user-type.guard';
import { UserType } from '../../users/entities/user.entity';
import { MessageTemplate, WhatsappClient } from './whatsapp.client';

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

/** Read-only view of the WABA's message templates; they are created and edited in WhatsApp Manager. */
@ApiTags('Admin — WhatsApp')
@ApiBearerAuth()
@Controller('admin/whatsapp/templates')
@UseGuards(JwtAuthGuard, UserTypeGuard)
@RequireUserType(UserType.PLATFORM_ADMIN)
export class AdminWhatsappTemplatesController {
  private readonly logger = new Logger(AdminWhatsappTemplatesController.name);

  constructor(
    private readonly client: WhatsappClient,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Templates as Meta reports them, and the invitation template state.',
  })
  async list(): Promise<WhatsappTemplatesView> {
    const name = this.config.get('WHATSAPP_INVITATION_TEMPLATE', {
      infer: true,
    });
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
}
