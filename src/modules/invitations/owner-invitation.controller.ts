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
import { UserType } from '../users/entities/user.entity';
import {
  ApproveInvitationDto,
  OwnerInvitationView,
} from './dto/invitation.dto';
import { InvitationsService } from './invitations.service';

/** SCR-15: the owner previews the invitation and approves the exact version. */
@ApiTags('Events')
@ApiBearerAuth()
@Controller('events/:id/invitation')
@UseGuards(JwtAuthGuard, UserTypeGuard)
@RequireUserType(UserType.OWNER)
export class OwnerInvitationController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get()
  view(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OwnerInvitationView> {
    return this.invitations.ownerView(user.id, id);
  }

  @Post('approve')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiOperation({ summary: '409 invitation.version_outdated if it changed.' })
  async approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveInvitationDto,
  ) {
    await this.invitations.approve(user.id, id, dto.contentId, dto.contentHash);
    return withMessage(
      await this.invitations.ownerView(user.id, id),
      'invitation.approved',
    );
  }
}
