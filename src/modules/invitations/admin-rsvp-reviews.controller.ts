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
import { DecideRsvpReviewDto, RsvpReviewsView } from './dto/rsvp-review.dto';
import { RsvpReviewsService } from './rsvp-reviews.service';

/** SP-07: late accepts waiting for an admin (D-53). */
@ApiTags('Admin — RSVP reviews')
@ApiBearerAuth()
@Controller('admin/events/:id/rsvp-reviews')
@UseGuards(JwtAuthGuard, UserTypeGuard)
@RequireUserType(UserType.PLATFORM_ADMIN)
export class AdminRsvpReviewsController {
  constructor(private readonly reviews: RsvpReviewsService) {}

  @Get()
  list(@Param('id', ParseUUIDPipe) id: string): Promise<RsvpReviewsView> {
    return this.reviews.list(id);
  }

  @Post(':inboundId')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiOperation({
    summary:
      '`ACCEPT` applies the accept and sends the QR; `DISMISS` does nothing.',
  })
  async decide(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('inboundId', ParseUUIDPipe) inboundId: string,
    @Body() dto: DecideRsvpReviewDto,
  ) {
    await this.reviews.decide(user.id, id, inboundId, dto.decision);
    return withMessage(await this.reviews.list(id), 'rsvp_review.decided');
  }
}
