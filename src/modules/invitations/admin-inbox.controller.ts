import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
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
  InboxTemplateView,
  SendAttachmentDto,
  SendReplyDto,
  SendTemplateDto,
} from './dto/inbox.dto';
import { WhatsappMessageState } from './entities/whatsapp-message.entity';
import { InboxMediaService } from './inbox-media.service';
import { InboxService, MAX_DOCUMENT_BYTES } from './inbox.service';
import type { UploadedFile as InboxFile } from './inbox.service';

/** Multer reads multipart file names as latin1; browsers send UTF-8 (Arabic names). */
const utf8Name = (name: string | undefined) =>
  name && [...name].every((c) => c.charCodeAt(0) <= 0xff)
    ? Buffer.from(name, 'latin1').toString('utf8')
    : name;

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
  constructor(
    private readonly inbox: InboxService,
    private readonly media: InboxMediaService,
  ) {}

  @Get('conversations')
  @ApiOperation({ summary: 'Latest first; filters: unread, search.' })
  conversations(
    @Query() query: ConversationsQueryDto,
  ): Promise<Paginated<ConversationView>> {
    return this.inbox.conversations(query);
  }

  @Get('templates')
  @ApiOperation({
    summary: 'Approved templates the inbox can send (D-47), read from Meta.',
  })
  async templates(): Promise<{ templates: InboxTemplateView[] }> {
    return { templates: await this.inbox.templates() };
  }

  /**
   * D-47: a stored image, video, audio, sticker or file. Raw bytes (no JSON envelope); images,
   * video and audio inline, anything else as a download. Never cached by shared caches.
   */
  @Get('media/:id')
  @ApiOperation({ summary: 'The stored copy of a message file.' })
  async file(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.media.file(id);
    response
      .set({
        'Content-Type': file.contentType,
        'Content-Disposition': `${file.inline ? 'inline' : 'attachment'}; filename="file"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        'Cache-Control': 'private, max-age=86400',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'X-Content-Type-Options': 'nosniff',
      })
      .send(file.data);
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

  @Post('conversations/:id/attachments')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1, fields: 4 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'An image (JPEG/PNG, 5 MB) or PDF (16 MB) inside the 24 h window (D-47).',
  })
  async attachment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SendAttachmentDto,
    @UploadedFile() file?: InboxFile,
  ) {
    const message = await this.inbox.sendAttachment(
      user.id,
      id,
      dto,
      file && {
        buffer: file.buffer,
        originalname: utf8Name(file.originalname),
      },
    );
    return withMessage(
      message,
      message.state === WhatsappMessageState.UNKNOWN
        ? 'replies.unknown'
        : 'replies.sent',
    );
  }

  @Post('conversations/:id/templates')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiOperation({
    summary:
      'An approved template, window open or not; also starts a new conversation (D-47).',
  })
  async template(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SendTemplateDto,
  ) {
    const message = await this.inbox.sendTemplate(user.id, id, dto);
    return withMessage(
      message,
      message.state === WhatsappMessageState.UNKNOWN
        ? 'replies.unknown'
        : 'replies.template_sent',
    );
  }
}
