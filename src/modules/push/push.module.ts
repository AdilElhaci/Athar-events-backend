import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { AdminPushController } from './admin-push.controller';
import { PushSubscription } from './entities/push-subscription.entity';
import { PushService } from './push.service';
import { WebPushClient } from './web-push.client';

@Module({
  imports: [TypeOrmModule.forFeature([PushSubscription]), AuthModule],
  controllers: [AdminPushController],
  providers: [PushService, WebPushClient],
  exports: [PushService],
})
export class PushModule {}
