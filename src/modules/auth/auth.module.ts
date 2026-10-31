import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { EnvironmentVariables } from '../../config/env.validation';
import { MailModule } from '../mail/mail.module';
import { User } from '../users/entities/user.entity';
import { AuthController } from './auth.controller';
import { CsrfGuard } from './guards/csrf.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { UserTypeGuard } from './guards/user-type.guard';
import { AdminProvisioningService } from './services/admin-provisioning.service';
import { AuthService } from './services/auth.service';
import { PasswordService } from './services/password.service';
import { RateLimitService } from './services/rate-limit.service';
import { SessionService } from './services/session.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    PassportModule,
    MailModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        signOptions: {
          algorithm: 'HS256',
          expiresIn: config.get('JWT_ACCESS_TTL_SECONDS', { infer: true }),
          issuer: config.get('JWT_ISSUER', { infer: true }),
          audience: config.get('JWT_AUDIENCE', { infer: true }),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    SessionService,
    RateLimitService,
    AdminProvisioningService,
    JwtStrategy,
    JwtAuthGuard,
    UserTypeGuard,
    CsrfGuard,
  ],
  exports: [
    CsrfGuard,
    RateLimitService,
    JwtAuthGuard,
    UserTypeGuard,
    AdminProvisioningService,
    SessionService,
  ],
})
export class AuthModule {}
