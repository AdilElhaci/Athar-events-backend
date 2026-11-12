import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Paginated } from '../../shared/pagination';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequireUserType, UserTypeGuard } from '../auth/guards/user-type.guard';
import { UserType } from '../users/entities/user.entity';
import { AdminActionsService } from './admin-actions.service';
import { AdminActionsQueryDto, AdminActionView } from './dto/admin-action.dto';

@ApiTags('Admin — Activity')
@ApiBearerAuth()
@Controller('admin/actions')
@UseGuards(JwtAuthGuard, UserTypeGuard)
@RequireUserType(UserType.PLATFORM_ADMIN)
export class AdminActionsController {
  constructor(private readonly actions: AdminActionsService) {}

  @Get()
  @ApiOperation({ summary: 'Newest first; filter by event, actor, action.' })
  list(
    @Query() query: AdminActionsQueryDto,
  ): Promise<Paginated<AdminActionView>> {
    return this.actions.list(query);
  }

  @Get('names')
  @ApiOperation({ summary: 'Action names present in the log.' })
  names(): Promise<string[]> {
    return this.actions.actionNames();
  }
}
