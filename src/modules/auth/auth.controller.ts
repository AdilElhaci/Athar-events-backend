import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { EnvironmentVariables } from '../../config/env.validation';
import { AppException } from '../../shared/exceptions/app.exception';
import { withMessage } from '../../shared/interceptors/response.interceptor';
import { toUserView } from '../users/dto/user.dto';
import { CurrentUser } from './current-user.decorator';
import {
  ChangePasswordDto,
  EmailDto,
  LoginDto,
  RegisterCompleteDto,
  RegisterStartDto,
  RegisterVerifyDto,
  TokenPasswordDto,
  UpdateProfileDto,
} from './dto/auth.dto';
import { CsrfGuard } from './guards/csrf.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthService } from './services/auth.service';
import type { ClientMeta, IssuedSession } from './services/session.service';
import {
  clearSessionCookies,
  readRefreshCookie,
  setSessionCookies,
} from './session-cookie';
import type { AuthenticatedUser } from './types/auth.types';

const HOUR = 3_600_000;
const MINUTE = 60_000;

const meta = (req: Request): ClientMeta => ({
  ip: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
});

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  private readonly secureCookies: boolean;

  constructor(
    private readonly auth: AuthService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.secureCookies = config.get('COOKIE_SECURE', { infer: true });
  }

  private startSession(res: Response, issued: IssuedSession) {
    setSessionCookies(
      res,
      issued.refreshToken,
      issued.refreshExpiresAt,
      this.secureCookies,
    );
    return { accessToken: issued.accessToken, expiresIn: issued.expiresIn };
  }

  @Post('register/start')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @Throttle({ default: { limit: 10, ttl: HOUR } })
  @ApiOperation({
    summary:
      'Step 1: name + email. Always the same response (no account enumeration).',
  })
  async registerStart(@Body() dto: RegisterStartDto) {
    await this.auth.startRegistration(dto.email, dto.name);
    return withMessage(null, 'auth.registration_started');
  }

  @Post('register/verify')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @Throttle({ default: { limit: 20, ttl: HOUR } })
  @ApiOperation({
    summary: 'Step 2: email code → short-lived registration token.',
  })
  registerVerify(@Body() dto: RegisterVerifyDto) {
    return this.auth.verifyRegistrationCode(dto.email, dto.code);
  }

  @Post('register/complete')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @Throttle({ default: { limit: 10, ttl: HOUR } })
  @ApiOperation({
    summary: 'Step 3: choose the password; creates the account and signs in.',
  })
  async registerComplete(
    @Body() dto: RegisterCompleteDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const issued = await this.auth.completeRegistration(
      dto.registrationToken,
      dto.password,
      meta(req),
    );
    return withMessage(this.startSession(res, issued), 'auth.registered');
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @Throttle({ default: { limit: 30, ttl: 15 * MINUTE } })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const issued = await this.auth.login(dto.email, dto.password, meta(req));
    return withMessage(this.startSession(res, issued), 'auth.logged_in');
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @Throttle({ default: { limit: 60, ttl: 15 * MINUTE } })
  @ApiOperation({
    summary:
      'Rotates the HttpOnly refresh cookie and returns a new access token and the user.',
  })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      const { user, ...issued } = await this.auth.refresh(
        readRefreshCookie(req),
      );
      return { ...this.startSession(res, issued), user: toUserView(user) };
    } catch (error) {
      // A grace-window collision keeps the cookie the winning request just set.
      const raced =
        error instanceof AppException && error.code === 'auth.refresh_race';
      if (!raced) clearSessionCookies(res, this.secureCookies);
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(readRefreshCookie(req));
    clearSessionCookies(res, this.secureCookies);
    return withMessage(null, 'auth.logged_out');
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, JwtAuthGuard)
  @ApiBearerAuth()
  async logoutAll(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.logoutEverywhere(user.id);
    clearSessionCookies(res, this.secureCookies);
    return withMessage(null, 'auth.logged_out');
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async me(@CurrentUser() user: AuthenticatedUser) {
    return toUserView(await this.auth.me(user.id));
  }

  @Patch('me')
  @UseGuards(CsrfGuard, JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update the signed-in user's name and/or phone." })
  async updateMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ) {
    const updated = await this.auth.updateProfile(user.id, dto);
    return withMessage(toUserView(updated), 'auth.profile_updated');
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard, JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 15 * MINUTE } })
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Checks the current password, sets the new one and ends every session.',
  })
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.changePassword(
      user.id,
      dto.currentPassword,
      dto.newPassword,
    );
    clearSessionCookies(res, this.secureCookies);
    return withMessage(null, 'auth.password_changed');
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @Throttle({ default: { limit: 10, ttl: HOUR } })
  @ApiOperation({
    summary:
      'Always the same response; active accounts receive a 30-minute reset link.',
  })
  async forgotPassword(@Body() dto: EmailDto) {
    await this.auth.requestPasswordReset(dto.email);
    return withMessage(null, 'auth.reset_requested');
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @Throttle({ default: { limit: 10, ttl: HOUR } })
  async resetPassword(
    @Body() dto: TokenPasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.resetPassword(dto.token, dto.password);
    clearSessionCookies(res, this.secureCookies);
    return withMessage(null, 'auth.password_reset');
  }

  @Post('accept-invite')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @Throttle({ default: { limit: 10, ttl: HOUR } })
  async acceptInvite(@Body() dto: TokenPasswordDto) {
    await this.auth.acceptInvite(dto.token, dto.password);
    return withMessage(null, 'auth.invite_accepted');
  }
}
