import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { withMessage } from '../../shared/interceptors/response.interceptor';
import { buildMeta, Paginated } from '../../shared/pagination';
import { CurrentUser } from '../auth/current-user.decorator';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequireUserType, UserTypeGuard } from '../auth/guards/user-type.guard';
import type { AuthenticatedUser } from '../auth/types/auth.types';
import { UserType } from '../users/entities/user.entity';
import { ContactService } from './contact.service';
import {
  AdminContactMessagesQueryDto,
  ContactMessageView,
  toContactMessageView,
  UpdateContactMessageStatusDto,
} from './dto/contact-message.dto';

@ApiTags('Admin — Contact messages')
@ApiBearerAuth()
@Controller('admin/contact-messages')
@UseGuards(JwtAuthGuard, UserTypeGuard)
@RequireUserType(UserType.PLATFORM_ADMIN)
export class AdminContactMessagesController {
  constructor(private readonly contact: ContactService) {}

  @Get()
  @ApiOperation({
    summary:
      'Newest first; search matches name, phone or subject literally, filter by status.',
  })
  async list(
    @Query() query: AdminContactMessagesQueryDto,
  ): Promise<Paginated<ContactMessageView>> {
    const [rows, total] = await this.contact.list(query);
    return {
      items: rows.map(toContactMessageView),
      meta: buildMeta(total, query.page, query.limit),
    };
  }

  @Get('new-count')
  @ApiOperation({ summary: 'Number of unread messages, for the sidebar.' })
  async newCount(): Promise<{ count: number }> {
    return { count: await this.contact.countNew() };
  }

  @Get(':id')
  async get(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ContactMessageView> {
    return toContactMessageView(await this.contact.get(id));
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @ApiOperation({
    summary: 'Marks a NEW message READ; any other status is left as it is.',
  })
  async markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ContactMessageView> {
    return toContactMessageView(await this.contact.markRead(user.id, id));
  }

  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  async setStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateContactMessageStatusDto,
  ) {
    const updated = await this.contact.setStatus(user.id, id, dto.status);
    return withMessage(
      toContactMessageView(updated),
      'contact_message.status_updated',
    );
  }

  @Delete(':id')
  @UseGuards(CsrfGuard)
  @ApiOperation({ summary: 'Permanently deletes a message (D-34).' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.contact.remove(user.id, id);
    return withMessage(null, 'contact_message.deleted');
  }
}
