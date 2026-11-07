import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { buildMeta, Paginated } from '../../shared/pagination';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequireUserType, UserTypeGuard } from '../auth/guards/user-type.guard';
import type { AuthenticatedUser } from '../auth/types/auth.types';
import { EventsService } from '../events/events.service';
import { UserType } from '../users/entities/user.entity';
import {
  GuestCounts,
  GuestsQueryDto,
  OwnerGuestView,
  toOwnerGuestView,
} from './dto/guest.dto';
import { GuestsService } from './guests.service';

/** SCR-14: the owner's read-only list, masked phones, scoped by ownership (AC-03-4). */
@ApiTags('Events')
@ApiBearerAuth()
@Controller('events/:id/guests')
@UseGuards(JwtAuthGuard, UserTypeGuard)
@RequireUserType(UserType.OWNER)
export class OwnerGuestsController {
  constructor(
    private readonly events: EventsService,
    private readonly guests: GuestsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Read-only, masked phones, search by name.' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: GuestsQueryDto,
  ): Promise<Paginated<OwnerGuestView> & { counts: GuestCounts }> {
    await this.events.get(user.id, id); // 404 unless the caller owns it
    const counts = await this.guests.counts(id);
    const [rows, total] = await this.guests.list(id, query, {
      phoneSearch: false,
    });
    return {
      items: rows.map(toOwnerGuestView),
      meta: buildMeta(total, query.page, query.limit),
      counts,
    };
  }
}
