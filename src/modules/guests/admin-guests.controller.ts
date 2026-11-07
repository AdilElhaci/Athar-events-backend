import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
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
import { badRequest } from '../../shared/exceptions/app.exception';
import { withMessage } from '../../shared/interceptors/response.interceptor';
import { buildMeta, Paginated } from '../../shared/pagination';
import { CurrentUser } from '../auth/current-user.decorator';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequireUserType, UserTypeGuard } from '../auth/guards/user-type.guard';
import type { AuthenticatedUser } from '../auth/types/auth.types';
import { AdminEventsService } from '../events/admin-events.service';
import { toAdminEventView } from '../events/dto/admin-event.dto';
import { UserType } from '../users/entities/user.entity';
import {
  AdminGuestView,
  CreateGuestDto,
  GuestCounts,
  GuestsQueryDto,
  ImportRowsQueryDto,
  ImportRowView,
  SetListStatusDto,
  toAdminGuestView,
  toGuestImportView,
  toImportRowView,
  UpdateGuestDto,
} from './dto/guest.dto';
import { GuestImportService } from './guest-import.service';
import { GuestsService } from './guests.service';
import { MAX_SHEET_BYTES } from './utils/guest-sheet';

/** SCR-22 / SCR-22a: the admin enters the list the owner sent by WhatsApp (D-39). */
@ApiTags('Admin — Guests')
@ApiBearerAuth()
@Controller('admin/events/:id')
@UseGuards(JwtAuthGuard, UserTypeGuard)
@RequireUserType(UserType.PLATFORM_ADMIN)
export class AdminGuestsController {
  constructor(
    private readonly guests: GuestsService,
    private readonly imports: GuestImportService,
    private readonly events: AdminEventsService,
  ) {}

  @Get('guests')
  @ApiOperation({ summary: 'Full list with phones; search by name or digits.' })
  async list(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: GuestsQueryDto,
  ): Promise<Paginated<AdminGuestView> & { counts: GuestCounts }> {
    const counts = await this.guests.counts(id);
    const [rows, total] = await this.guests.list(id, query, {
      phoneSearch: true,
    });
    return {
      items: rows.map(toAdminGuestView),
      meta: buildMeta(total, query.page, query.limit),
      counts,
    };
  }

  @Post('guests')
  @UseGuards(CsrfGuard)
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateGuestDto,
  ) {
    const guest = await this.guests.create(user.id, id, dto);
    return withMessage(toAdminGuestView(guest), 'guest.created');
  }

  @Patch('guests/:guestId')
  @UseGuards(CsrfGuard)
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('guestId', ParseUUIDPipe) guestId: string,
    @Body() dto: UpdateGuestDto,
  ) {
    const guest = await this.guests.update(user.id, id, guestId, dto);
    return withMessage(toAdminGuestView(guest), 'guest.updated');
  }

  @Delete('guests/:guestId')
  @UseGuards(CsrfGuard)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('guestId', ParseUUIDPipe) guestId: string,
  ) {
    await this.guests.remove(user.id, id, guestId);
    return withMessage(null, 'guest.deleted');
  }

  @Post('guest-imports')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_SHEET_BYTES, files: 1 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Parse the template in memory and store a 30-minute preview.',
  })
  async preview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file?: { buffer: Buffer; originalname?: string },
  ) {
    if (!file) throw badRequest('imports.unreadable');
    const created = await this.imports.preview(user.id, id, file);
    return withMessage(toGuestImportView(created), 'imports.previewed');
  }

  @Get('guest-imports/:importId/rows')
  async rows(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('importId', ParseUUIDPipe) importId: string,
    @Query() query: ImportRowsQueryDto,
  ): Promise<Paginated<ImportRowView>> {
    const [rows, total] = await this.imports.listRows(id, importId, query);
    return {
      items: rows.map(toImportRowView),
      meta: buildMeta(total, query.page, query.limit),
    };
  }

  @Post('guest-imports/:importId/apply')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiOperation({ summary: 'Add the valid rows that still fit. Idempotent.' })
  async apply(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('importId', ParseUUIDPipe) importId: string,
  ) {
    const applied = await this.imports.apply(user.id, id, importId);
    return withMessage(toGuestImportView(applied), 'imports.applied');
  }

  @Post('list-status')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiOperation({
    summary: 'IN_PROGRESS or READY; READY needs one initial guest.',
  })
  async listStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetListStatusDto,
  ) {
    await this.guests.setListStatus(user.id, id, dto.status);
    const [event, stage] = await this.events.get(id);
    return withMessage(
      toAdminEventView(event, stage),
      'event.list_status_updated',
    );
  }
}
