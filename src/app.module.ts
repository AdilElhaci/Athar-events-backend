import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import type Redis from 'ioredis';
import { validateEnv } from './config/env.validation';
import { buildDataSourceOptions } from './database/data-source';
import { HealthController } from './health.controller';
import { ArticlesModule } from './modules/articles/articles.module';
import { AuthModule } from './modules/auth/auth.module';
import { ContactModule } from './modules/contact/contact.module';
import { REDIS } from './modules/auth/services/rate-limit.service';
import { EventsModule } from './modules/events/events.module';
import { GuestsModule } from './modules/guests/guests.module';
import { InvitationsModule } from './modules/invitations/invitations.module';
import { PackagesModule } from './modules/packages/packages.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { UsersModule } from './modules/users/users.module';
import { RedisModule } from './redis/redis.module';
import { AllExceptionsFilter } from './shared/filters/all-exceptions.filter';
import { ResponseInterceptor } from './shared/interceptors/response.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      cache: true,
    }),
    TypeOrmModule.forRootAsync({ useFactory: () => buildDataSourceOptions() }),
    RedisModule,
    ScheduleModule.forRoot(),
    // Global per-IP limit: 100 requests per 60 s (ttl is in milliseconds — W1 fixed), stored in Redis
    // so limits are shared across instances. Auth routes set tighter limits with @Throttle.
    ThrottlerModule.forRootAsync({
      inject: [REDIS],
      useFactory: (redis: Redis) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 100 }],
        storage: new ThrottlerStorageRedisService(redis),
      }),
    }),
    AuthModule,
    UsersModule,
    ContactModule,
    PackagesModule,
    EventsModule,
    GuestsModule,
    InvitationsModule,
    PaymentsModule,
    ArticlesModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
})
export class AppModule {}
