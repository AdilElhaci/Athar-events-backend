import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CheckinService } from './checkin.service';
import { PublicInvitationsController } from './public-invitations.controller';
import { ScanController } from './scan.controller';

@Module({
  imports: [AuthModule],
  controllers: [ScanController, PublicInvitationsController],
  providers: [CheckinService],
})
export class CheckinModule {}
