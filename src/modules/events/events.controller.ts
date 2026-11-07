import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { withMessage } from '../../shared/interceptors/response.interceptor';
import { buildMeta, Paginated } from '../../shared/pagination';
import { CurrentUser } from '../auth/current-user.decorator';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequireUserType, UserTypeGuard } from '../auth/guards/user-type.guard';
import type { AuthenticatedUser } from '../auth/types/auth.types';
import { buildGuestTemplate } from '../guests/utils/guest-sheet';
import { UserType } from '../users/entities/user.entity';
import {
  CreateEventDto,
  EventView,
  ListEventsQueryDto,
  toEventView,
  UpdateEventDto,
} from './dto/event.dto';
import { EventsService } from './events.service';

/** Owner endpoints: every query is scoped by `owner_id`; admins use `/admin/events`. */
@ApiTags('Events')
@ApiBearerAuth()
@Controller('events')
@UseGuards(JwtAuthGuard, UserTypeGuard)
@RequireUserType(UserType.OWNER)
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  @ApiOperation({ summary: "The signed-in owner's events, newest first." })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListEventsQueryDto,
  ): Promise<Paginated<EventView>> {
    const [rows, total] = await this.events.list(user.id, query);
    return {
      items: rows.map(toEventView),
      meta: buildMeta(total, query.page, query.limit),
    };
  }

  @Post()
  @UseGuards(CsrfGuard)
  @ApiOperation({ summary: 'Creates an unpaid event from an active package.' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateEventDto,
  ) {
    const created = await this.events.create(user.id, dto);
    return withMessage(toEventView(created), 'event.created');
  }

  /** Declared before `:id` so the path is not read as an event id. Admins may download it too. */
  @Get('guest-list-template')
  @RequireUserType(UserType.OWNER, UserType.PLATFORM_ADMIN)
  @ApiOperation({ summary: 'The fixed guest-list template (.xlsx).' })
  async guestListTemplate(@Res() res: Response): Promise<void> {
    const file = await buildGuestTemplate();
    res
      .status(200)
      .setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      )
      .setHeader(
        'Content-Disposition',
        `attachment; filename="athar-guest-list.xlsx"; filename*=UTF-8''${encodeURIComponent('قائمة-الضيوف-أثر.xlsx')}`,
      )
      .setHeader('Cache-Control', 'no-store')
      .send(file);
  }

  @Get(':id')
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EventView> {
    return toEventView(await this.events.get(user.id, id));
  }

  @Patch(':id')
  @UseGuards(CsrfGuard)
  @ApiOperation({ summary: 'Edits an event until its invitation is approved.' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEventDto,
  ) {
    const updated = await this.events.update(user.id, id, dto);
    return withMessage(toEventView(updated), 'event.updated');
  }
}
