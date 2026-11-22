import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { withMessage } from '../../shared/interceptors/response.interceptor';
import { CurrentUser } from '../auth/current-user.decorator';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequireUserType, UserTypeGuard } from '../auth/guards/user-type.guard';
import type { AuthenticatedUser } from '../auth/types/auth.types';
import { UserType } from '../users/entities/user.entity';
import { SubscribePushDto, UnsubscribePushDto } from './dto/push.dto';
import { PushService } from './push.service';

/** Web Push for admins: each device turns notifications of new inbox messages on or off. */
@ApiTags('Admin — push notifications')
@ApiBearerAuth()
@Controller('admin/push')
@UseGuards(JwtAuthGuard, UserTypeGuard)
@RequireUserType(UserType.PLATFORM_ADMIN)
export class AdminPushController {
  constructor(private readonly push: PushService) {}

  @Get('public-key')
  @ApiOperation({
    summary: 'The VAPID key to subscribe with; null when push is off.',
  })
  publicKey(): { publicKey: string | null } {
    return { publicKey: this.push.publicKey() };
  }

  @Post('subscriptions')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiOperation({ summary: 'Turn notifications on for this device.' })
  async subscribe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SubscribePushDto,
  ) {
    await this.push.subscribe(user.id, {
      endpoint: dto.endpoint,
      p256dh: dto.keys.p256dh,
      auth: dto.keys.auth,
    });
    return withMessage({ ok: true }, 'push.enabled');
  }

  @Post('subscriptions/remove')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiOperation({ summary: 'Turn notifications off for this device.' })
  async unsubscribe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UnsubscribePushDto,
  ) {
    await this.push.unsubscribe(user.id, dto.endpoint);
    return withMessage({ ok: true }, 'push.disabled');
  }

  @Post('test')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: "A test notification to the admin's own devices." })
  async test(@CurrentUser() user: AuthenticatedUser) {
    const delivered = await this.push.sendToUser(user.id, {
      title: 'أثر إيفنتس',
      body: 'الإشعارات تعمل على هذا الجهاز ✅',
      url: '/dashboard/inbox',
      tag: 'test',
    });
    return withMessage({ delivered }, 'push.test_sent');
  }
}
