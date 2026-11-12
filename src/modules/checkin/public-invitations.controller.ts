import { Controller, Get, Header, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CheckinService } from './checkin.service';
import type { PublicInvitationView } from './dto/checkin.dto';

/** SCR-40, the guest's QR recovery page. The token in the path is the only credential. */
@ApiTags('Public invitation')
@Controller('public/invitations')
export class PublicInvitationsController {
  constructor(private readonly checkin: CheckinService) {}

  @Get(':token')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @Header('X-Robots-Tag', 'noindex')
  @ApiOperation({
    summary: 'Never checks in; 404 for unknown or revoked codes.',
  })
  get(@Param('token') token: string): Promise<PublicInvitationView> {
    return this.checkin.publicInvitation(token);
  }
}
