import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { withMessage } from '../../shared/interceptors/response.interceptor';
import { CurrentUser } from '../auth/current-user.decorator';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequireUserType, UserTypeGuard } from '../auth/guards/user-type.guard';
import type { AuthenticatedUser } from '../auth/types/auth.types';
import { AdminEventsService } from '../events/admin-events.service';
import { toAdminEventView } from '../events/dto/admin-event.dto';
import { UserType } from '../users/entities/user.entity';
import {
  AdminInvitationView,
  CreateInvitationDto,
  OverrideApprovalDto,
  ScheduleDto,
  UnscheduleDto,
} from './dto/invitation.dto';
import { InvitationsService } from './invitations.service';

/** SCR-23: invitation versions, approval override and scheduling. */
@ApiTags('Admin — Invitation & campaign')
@ApiBearerAuth()
@Controller('admin/events/:id')
@UseGuards(JwtAuthGuard, UserTypeGuard)
@RequireUserType(UserType.PLATFORM_ADMIN)
export class AdminInvitationsController {
  constructor(
    private readonly invitations: InvitationsService,
    private readonly events: AdminEventsService,
  ) {}

  @Get('invitation')
  @ApiOperation({
    summary: 'Template, latest version, suggestions, preconditions.',
  })
  view(@Param('id', ParseUUIDPipe) id: string): Promise<AdminInvitationView> {
    return this.invitations.adminView(id);
  }

  @Post('invitation')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiOperation({ summary: 'New version; approval goes back to the owner.' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateInvitationDto,
  ) {
    await this.invitations.createVersion(user.id, id, dto);
    return withMessage(
      await this.invitations.adminView(id),
      'invitation.version_created',
    );
  }

  @Post('invitation/override')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiOperation({ summary: 'Approve for the owner, with a recorded reason.' })
  async override(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OverrideApprovalDto,
  ) {
    await this.invitations.override(user.id, id, dto.contentId, dto.reason);
    return withMessage(
      await this.invitations.adminView(id),
      'invitation.overridden',
    );
  }

  @Post('schedule')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  async schedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ScheduleDto,
  ) {
    await this.invitations.schedule(user.id, id, new Date(dto.sendAt));
    const [event, stage] = await this.events.get(id);
    return withMessage(toAdminEventView(event, stage), 'campaign.scheduled');
  }

  @Post('cancel-campaign')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiOperation({ summary: 'Unschedule before sending starts.' })
  async unschedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UnscheduleDto,
  ) {
    await this.invitations.unschedule(user.id, id, dto.reason);
    const [event, stage] = await this.events.get(id);
    return withMessage(toAdminEventView(event, stage), 'campaign.unscheduled');
  }

  @Post('pause')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiOperation({
    summary: 'Stop sending; queued invitations wait for resume.',
  })
  async pause(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UnscheduleDto,
  ) {
    await this.invitations.pause(user.id, id, dto.reason);
    const [event, stage] = await this.events.get(id);
    return withMessage(toAdminEventView(event, stage), 'campaign.paused');
  }

  @Post('resume')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiOperation({ summary: 'Continue a paused campaign.' })
  async resume(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.invitations.resume(user.id, id);
    const [event, stage] = await this.events.get(id);
    return withMessage(toAdminEventView(event, stage), 'campaign.resumed');
  }
}
