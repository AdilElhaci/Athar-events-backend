import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { withMessage } from '../../../shared/interceptors/response.interceptor';
import { CurrentUser } from '../../auth/current-user.decorator';
import { CsrfGuard } from '../../auth/guards/csrf.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import {
  RequireUserType,
  UserTypeGuard,
} from '../../auth/guards/user-type.guard';
import type { AuthenticatedUser } from '../../auth/types/auth.types';
import { UserType } from '../../users/entities/user.entity';
import {
  CreateWhatsappTemplateDto,
  DeleteWhatsappTemplateDto,
} from '../dto/whatsapp-template.dto';
import { MetaIdPipe } from './meta-id.pipe';
import {
  WhatsappTemplatesService,
  WhatsappTemplatesView,
} from './whatsapp-templates.service';

export type { WhatsappTemplatesView };

/** The WABA's message templates. The invitation template itself stays in WhatsApp Manager (D-41). */
@ApiTags('Admin — WhatsApp')
@ApiBearerAuth()
@Controller('admin/whatsapp/templates')
@UseGuards(JwtAuthGuard, UserTypeGuard)
@RequireUserType(UserType.PLATFORM_ADMIN)
export class AdminWhatsappTemplatesController {
  constructor(private readonly templates: WhatsappTemplatesService) {}

  @Get()
  @ApiOperation({
    summary:
      'Templates as Meta reports them, and the invitation template state.',
  })
  list(): Promise<WhatsappTemplatesView> {
    return this.templates.list();
  }

  @Post()
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiOperation({ summary: 'Submit a new template to Meta for review.' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateWhatsappTemplateDto,
  ) {
    await this.templates.create(user.id, dto);
    // The list is not re-read here: a failed read must not hide a successful create.
    return withMessage(null, 'whatsapp.template_created');
  }

  @Delete(':id')
  @UseGuards(CsrfGuard)
  @ApiOperation({
    summary:
      'Delete one template (Meta id + name); the name is blocked 30 days.',
  })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', MetaIdPipe) id: string,
    @Query() query: DeleteWhatsappTemplateDto,
  ) {
    await this.templates.remove(user.id, id, query.name);
    return withMessage(null, 'whatsapp.template_deleted');
  }
}
