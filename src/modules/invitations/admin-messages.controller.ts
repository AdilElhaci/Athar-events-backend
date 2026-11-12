import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { withMessage } from '../../shared/interceptors/response.interceptor';
import type { Paginated } from '../../shared/pagination';
import { CurrentUser } from '../auth/current-user.decorator';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequireUserType, UserTypeGuard } from '../auth/guards/user-type.guard';
import type { AuthenticatedUser } from '../auth/types/auth.types';
import { UserType } from '../users/entities/user.entity';
import {
  MessagesQueryDto,
  MessageView,
  ResolveMessageDto,
} from './dto/message.dto';
import { MessagesService } from './messages.service';

/** SCR-25: an event's WhatsApp messages; admins resolve `UNKNOWN` and `FAILED` (AC-06-4). */
@ApiTags('Admin — Messages')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(JwtAuthGuard, UserTypeGuard)
@RequireUserType(UserType.PLATFORM_ADMIN)
export class AdminMessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get('events/:id/messages')
  @ApiOperation({ summary: 'Newest first; filters by state, delivery, kind.' })
  list(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: MessagesQueryDto,
  ): Promise<Paginated<MessageView>> {
    return this.messages.list(id, query);
  }

  @Post('messages/:messageId/resolve')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiOperation({
    summary: 'MARK_SENT / MARK_FAILED (UNKNOWN only) or RESEND; audited.',
  })
  async resolve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() dto: ResolveMessageDto,
  ) {
    const result = await this.messages.resolve(
      user.id,
      messageId,
      dto.resolution,
      dto.reason,
    );
    return withMessage(result, 'messages.resolved');
  }
}
