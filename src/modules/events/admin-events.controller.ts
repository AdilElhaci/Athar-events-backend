import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { AdminEventsService } from './admin-events.service';
import {
  AdminDashboardView,
  AdminEventListItem,
  AdminEventsQueryDto,
  AdminEventView,
  AdminUpdateEventDto,
  toAdminEventListItem,
  toAdminEventView,
} from './dto/admin-event.dto';

@ApiTags('Admin — Events')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(JwtAuthGuard, UserTypeGuard)
@RequireUserType(UserType.PLATFORM_ADMIN)
export class AdminEventsController {
  constructor(private readonly events: AdminEventsService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Queue counts per stage and alerts (SCR-20).' })
  dashboard(): Promise<AdminDashboardView> {
    return this.events.dashboard();
  }

  @Get('events')
  @ApiOperation({ summary: 'Every event, by stage, with literal search.' })
  async list(
    @Query() query: AdminEventsQueryDto,
  ): Promise<Paginated<AdminEventListItem>> {
    const [rows, total] = await this.events.list(query);
    return {
      items: rows.map(([event, stage]) => toAdminEventListItem(event, stage)),
      meta: buildMeta(total, query.page, query.limit),
    };
  }

  @Get('events/:id')
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<AdminEventView> {
    const [event, stage] = await this.events.get(id);
    return toAdminEventView(event, stage);
  }

  @Patch('events/:id')
  @UseGuards(CsrfGuard)
  @ApiOperation({
    summary: 'Audited correction, including the admission window.',
  })
  async correct(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminUpdateEventDto,
  ) {
    const [event, stage] = await this.events.correct(user.id, id, dto);
    return withMessage(toAdminEventView(event, stage), 'event.corrected');
  }
}
