import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Event } from '../events/entities/event.entity';
import {
  AdminCouponsController,
  EventCouponController,
} from './coupons.controller';
import { CouponsService } from './coupons.service';
import { Coupon } from './entities/coupon.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Coupon, Event]), AuthModule],
  controllers: [AdminCouponsController, EventCouponController],
  providers: [CouponsService],
})
export class CouponsModule {}
