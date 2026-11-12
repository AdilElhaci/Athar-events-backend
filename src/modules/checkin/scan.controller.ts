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
import { SkipThrottle } from '@nestjs/throttler';
import { tooManyRequests } from '../../shared/exceptions/app.exception';
import { CurrentUser } from '../auth/current-user.decorator';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequireUserType, UserTypeGuard } from '../auth/guards/user-type.guard';
import { RateLimitService } from '../auth/services/rate-limit.service';
import type { AuthenticatedUser } from '../auth/types/auth.types';
import { UserType } from '../users/entities/user.entity';
import { CheckinService } from './checkin.service';
import {
  CheckInDto,
  CheckInResponse,
  ScanEventView,
  ScanStats,
} from './dto/checkin.dto';

/** SCR-30/31: only the signed-in owner of the event scans (D-08); admins get 403. */
@ApiTags('Scan')
@ApiBearerAuth()
@Controller('scan/events')
@UseGuards(JwtAuthGuard, UserTypeGuard)
@RequireUserType(UserType.OWNER)
export class ScanController {
  constructor(
    private readonly checkin: CheckinService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Events whose admission window is open or near.' })
  list(@CurrentUser() user: AuthenticatedUser): Promise<ScanEventView[]> {
    return this.checkin.scanEvents(user.id);
  }

  @Get(':eventId/stats')
  stats(
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ): Promise<ScanStats> {
    return this.checkin.stats(user.id, eventId);
  }

  /** Always 200 for a scan outcome; the per-IP throttle is replaced by a per-user one. */
  @Post(':eventId/check-ins')
  @HttpCode(200)
  @SkipThrottle()
  @UseGuards(CsrfGuard)
  @ApiOperation({ summary: 'One scan; result in `result`.' })
  async checkIn(
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: CheckInDto,
  ): Promise<CheckInResponse> {
    if (!(await this.rateLimit.hit('scan', user.id, 120, 60)))
      throw tooManyRequests();
    return this.checkin.checkIn(user.id, eventId, dto.token);
  }
}
