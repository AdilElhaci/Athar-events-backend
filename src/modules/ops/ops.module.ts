import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { OpsAlertsService } from './ops-alerts.service';

@Module({
  imports: [MailModule],
  providers: [OpsAlertsService],
  exports: [OpsAlertsService],
})
export class OpsModule {}
