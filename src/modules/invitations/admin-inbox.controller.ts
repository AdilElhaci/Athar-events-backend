import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { withMessage } from '../../shared/interceptors/response.interceptor';
import { Paginated, PaginationQueryDto } from '../../shared/pagination';
import { CurrentUser } from '../auth/current-user.decorator';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequireUserType, UserTypeGuard } from '../auth/guards/user-type.guard';
import type { AuthenticatedUser } from '../auth/types/auth.types';
import { UserType } from '../users/entities/user.entity';
import {
  ConversationDetail,
  ConversationsQueryDto,
  ConversationView,
  SendReplyDto,
} from './dto/inbox.dto';
import { WhatsappMessageState } from './entities/whatsapp-message.entity';
import { InboxService } from './inbox.service';

/**
 * D-45 WhatsApp inbox: one conversation per phone number across all events. A conversation id
 * is the number's digits (`9665…`).
 */
@ApiTags('Admin — WhatsApp inbox')
@ApiBearerAuth()
@Controller('admin/inbox')
@UseGuards(JwtAuthGuard, UserTypeGuard)
@RequireUserType(UserType.PLATFORM_ADMIN)
export class AdminInboxController {
  constructor(private readonly inbox: InboxService) {}

  @Get('conversations')
  @ApiOperation({ summary: 'Latest first; filters: unread, search.' })
  conversations(
    @Query() query: ConversationsQueryDto,
  ): Promise<Paginated<ConversationView>> {
    return this.inbox.conversations(query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Conversations with an unread guest message.' })
  async unreadCount(): Promise<{ count: number }> {
    return { count: await this.inbox.unreadCount() };
  }

  @Get('conversations/:id')
  @ApiOperation({ summary: 'Header and messages, newest first.' })
  conversation(
    @Param('id') id: string,
    @Query() { page, limit }: PaginationQueryDto,
  ): Promise<ConversationDetail> {
    return this.inbox.conversation(id, page, limit);
  }

  @Post('conversations/:id/seen')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  async seen(@Param('id') id: string) {
    await this.inbox.markSeen(id);
    return withMessage({ ok: true }, 'common.ok');
  }

  @Post('conversations/:id/replies')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiOperation({
    summary:
      'Free-form text inside the 24 h window (D-44); sent once per requestId.',
  })
  async reply(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SendReplyDto,
  ) {
    const message = await this.inbox.send(user.id, id, dto);
    return withMessage(
      message,
      message.state === WhatsappMessageState.UNKNOWN
        ? 'replies.unknown'
        : 'replies.sent',
    );
  }
}
