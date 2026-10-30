import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import type { EnvironmentVariables } from '../../../config/env.validation';
import {
  badRequest,
  conflict,
  tooManyRequests,
  unauthorized,
} from '../../../shared/exceptions/app.exception';
import { MailService } from '../../mail/mail.service';
import {
  accountExistsMail,
  passwordChangedMail,
  passwordResetMail,
  registerCodeMail,
} from '../../mail/mail.templates';
import { User, UserStatus, UserType } from '../../users/entities/user.entity';
import { AuthToken, TokenPurpose } from '../entities/auth-token.entity';
import {
  ChallengePurpose,
  EmailChallenge,
} from '../entities/email-challenge.entity';
import {
  hmac,
  normalizeEmail,
  randomCode,
  randomToken,
  safeEqualHex,
  sha256,
} from '../utils/crypto.util';
import { checkPassword } from '../utils/password-policy';
import { PasswordService } from './password.service';
import { RateLimitService } from './rate-limit.service';
import { ClientMeta, IssuedSession, SessionService } from './session.service';

const CODE_TTL_MS = 10 * 60_000;
const CODE_MAX_ATTEMPTS = 5;
const REGISTER_TOKEN_TTL_MS = 15 * 60_000;
const RESET_TOKEN_TTL_MS = 30 * 60_000;
export const INVITE_TOKEN_TTL_MS = 24 * 60 * 60_000;

/** Failed password attempts allowed per (IP, email) and per email across all IPs, per 15 minutes. */
const LOGIN_FAILS_PER_IP_EMAIL = 10;
const LOGIN_FAILS_PER_EMAIL = 50;
/** Verification attempts per email across replacement codes, per hour. */
const VERIFY_ATTEMPTS_PER_EMAIL = 15;

@Injectable()
export class AuthService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly rateLimits: RateLimitService,
    private readonly mail: MailService,
  ) {}

  private appUrl(path: string): string {
    return new URL(
      path,
      this.config.get('APP_ORIGIN', { infer: true }),
    ).toString();
  }

  private codeHash(email: string, code: string): string {
    return hmac(
      this.config.get('OTP_SECRET', { infer: true }),
      `${email}:${code}`,
    );
  }

  // ---------------------------------------------------------------- registration

  /**
   * Step 1: always the same response. A new email gets a code; an existing account gets a
   * "you already have an account" notice. Both obey the per-address email budget.
   */
  async startRegistration(rawEmail: string, name: string): Promise<void> {
    const email = normalizeEmail(rawEmail);
    const existing = await this.dataSource
      .getRepository(User)
      .findOne({ where: { email } });
    if (!(await this.rateLimits.allowEmailTo(email))) return;

    if (existing) {
      this.mail.sendLater(
        email,
        accountExistsMail(
          this.appUrl('/auth/login'),
          this.appUrl('/auth/forgot-password'),
        ),
      );
      return;
    }

    const code = randomCode();
    await this.dataSource.transaction(async (manager) => {
      await manager.update(
        EmailChallenge,
        {
          email,
          purpose: ChallengePurpose.REGISTER,
          consumedAt: IsNull(),
          supersededAt: IsNull(),
        },
        { supersededAt: new Date() },
      );
      await manager.insert(EmailChallenge, {
        email,
        name: name.trim(),
        purpose: ChallengePurpose.REGISTER,
        codeHash: this.codeHash(email, code),
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
      });
    });
    this.mail.sendLater(email, registerCodeMail(code));
  }

  /** Step 2: proves inbox control and returns a short-lived, purpose-bound registration token. */
  async verifyRegistrationCode(
    rawEmail: string,
    code: string,
  ): Promise<{ registrationToken: string }> {
    const email = normalizeEmail(rawEmail);
    if (
      !(await this.rateLimits.hit(
        'verify:email',
        email,
        VERIFY_ATTEMPTS_PER_EMAIL,
        3600,
      ))
    ) {
      throw tooManyRequests('auth.code_locked');
    }

    // The attempt is counted in its own committed statement, before comparing, so failures always count.
    const result = await this.dataSource
      .createQueryBuilder()
      .update(EmailChallenge)
      .set({ attempts: () => 'attempts + 1' })
      .where(
        `id = (SELECT id FROM email_challenges
                WHERE email = :email AND purpose = :purpose AND consumed_at IS NULL AND superseded_at IS NULL
                ORDER BY created_at DESC LIMIT 1)
         AND attempts < :max AND expires_at > now()`,
        { email, purpose: ChallengePurpose.REGISTER, max: CODE_MAX_ATTEMPTS },
      )
      .returning('id, code_hash, name')
      .execute();
    const challenge = (
      result.raw as Array<{
        id: string;
        code_hash: string;
        name: string | null;
      }>
    )[0];
    if (
      !challenge ||
      !safeEqualHex(challenge.code_hash, this.codeHash(email, code))
    ) {
      throw badRequest('auth.code_invalid');
    }

    const registrationToken = randomToken();
    await this.dataSource.transaction(async (manager) => {
      const consumed = await manager.update(
        EmailChallenge,
        { id: challenge.id, consumedAt: IsNull() },
        { consumedAt: new Date() },
      );
      if (!consumed.affected) throw badRequest('auth.code_invalid');
      await this.replaceToken(manager, {
        purpose: TokenPurpose.REGISTER,
        email,
        name: challenge.name,
        userId: null,
        rawToken: registrationToken,
        ttlMs: REGISTER_TOKEN_TTL_MS,
      });
    });
    return { registrationToken };
  }

  /** Step 3: the password is chosen only after the inbox was proven; creates the account and signs in. */
  async completeRegistration(
    rawToken: string,
    password: string,
    meta: ClientMeta,
  ): Promise<IssuedSession> {
    return this.dataSource.transaction(async (manager) => {
      const token = await this.consumeToken(
        manager,
        rawToken,
        TokenPurpose.REGISTER,
      );
      if (!token) throw badRequest('auth.registration_token_invalid');

      const policy = checkPassword(password, {
        email: token.email,
        name: token.name,
      });
      if (policy) throw badRequest(policy);

      if (await manager.exists(User, { where: { email: token.email } }))
        throw conflict('auth.account_exists');
      const now = new Date();
      const user = await manager.save(
        manager.create(User, {
          type: UserType.OWNER, // public registration can never create an administrator
          status: UserStatus.ACTIVE,
          name: token.name ?? token.email.split('@')[0],
          email: token.email,
          passwordHash: await this.passwords.hash(password),
          emailVerifiedAt: now,
          passwordChangedAt: now,
        }),
      );
      return this.sessions.issue(manager, user.id, user.sessionVersion, meta);
    });
  }

  // ---------------------------------------------------------------- login

  async login(
    rawEmail: string,
    password: string,
    meta: ClientMeta,
  ): Promise<IssuedSession> {
    const email = normalizeEmail(rawEmail);
    const ipEmail = `${meta.ip ?? 'unknown'}|${email}`;
    if (
      !(await this.rateLimits.hit(
        'login:ip-email',
        ipEmail,
        LOGIN_FAILS_PER_IP_EMAIL,
        900,
      )) ||
      !(await this.rateLimits.hit(
        'login:email',
        email,
        LOGIN_FAILS_PER_EMAIL,
        900,
      ))
    ) {
      throw tooManyRequests();
    }

    const user = await this.dataSource
      .getRepository(User)
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .where('u.email = :email', { email })
      .getOne();

    // Always one argon2 verification, so missing accounts cost the same time as wrong passwords.
    const valid = await this.passwords.verify(
      user?.passwordHash ?? null,
      password,
    );
    if (!user || !valid || user.status !== UserStatus.ACTIVE)
      throw unauthorized('auth.invalid_credentials');

    await this.rateLimits.reset('login:ip-email', ipEmail);
    if (user.passwordHash && this.passwords.needsRehash(user.passwordHash)) {
      // Conditional: never overwrite a password changed concurrently (e.g. by a reset).
      await this.dataSource.getRepository(User).update(
        {
          id: user.id,
          passwordHash: user.passwordHash,
          sessionVersion: user.sessionVersion,
        },
        { passwordHash: await this.passwords.hash(password) },
      );
    }
    return this.dataSource.transaction((manager) =>
      this.sessions.issue(manager, user.id, user.sessionVersion, meta),
    );
  }

  // ---------------------------------------------------------------- password reset

  /** Always the same response; only active accounts with a password receive a link. */
  async requestPasswordReset(rawEmail: string): Promise<void> {
    const email = normalizeEmail(rawEmail);
    const user = await this.dataSource
      .getRepository(User)
      .findOne({ where: { email } });
    if (!user || user.status !== UserStatus.ACTIVE) return;
    if (!(await this.rateLimits.allowEmailTo(email))) return;

    const rawToken = randomToken();
    await this.dataSource.transaction(async (manager) => {
      await manager.findOne(User, {
        where: { id: user.id },
        lock: { mode: 'pessimistic_write' },
      });
      await this.replaceToken(manager, {
        purpose: TokenPurpose.PASSWORD_RESET,
        email,
        name: null,
        userId: user.id,
        rawToken,
        ttlMs: RESET_TOKEN_TTL_MS,
      });
    });
    // The token travels in the URL fragment, which browsers never send to servers or proxies.
    this.mail.sendLater(
      email,
      passwordResetMail(this.appUrl(`/auth/reset-password#token=${rawToken}`)),
    );
  }

  /** Sets a new password and ends every session; the user signs in again afterwards. */
  async resetPassword(rawToken: string, password: string): Promise<void> {
    const email = await this.dataSource.transaction(async (manager) => {
      const token = await this.consumeToken(
        manager,
        rawToken,
        TokenPurpose.PASSWORD_RESET,
      );
      if (!token?.userId) throw badRequest('auth.reset_token_invalid');
      const user = await manager.findOne(User, {
        where: { id: token.userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user || user.status !== UserStatus.ACTIVE)
        throw badRequest('auth.reset_token_invalid');

      const policy = checkPassword(password, {
        email: user.email,
        name: user.name,
      });
      if (policy) throw badRequest(policy);

      const now = new Date();
      await manager.update(
        User,
        { id: user.id },
        {
          passwordHash: await this.passwords.hash(password),
          passwordChangedAt: now,
          emailVerifiedAt: user.emailVerifiedAt ?? now,
        },
      );
      await this.sessions.revokeAll(manager, user.id, 'password_reset');
      return user.email;
    });
    this.mail.sendLater(
      email,
      passwordChangedMail(this.appUrl('/auth/forgot-password')),
    );
  }

  // ---------------------------------------------------------------- admin invitation

  /** An invited administrator sets a password through the invite link; the account becomes ACTIVE. */
  async acceptInvite(rawToken: string, password: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const token = await this.consumeToken(
        manager,
        rawToken,
        TokenPurpose.ADMIN_INVITE,
      );
      if (!token?.userId) throw badRequest('auth.invite_invalid');
      const user = await manager.findOne(User, {
        where: { id: token.userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !user ||
        user.status !== UserStatus.INVITED ||
        user.type !== UserType.PLATFORM_ADMIN
      ) {
        throw badRequest('auth.invite_invalid');
      }
      const policy = checkPassword(password, {
        email: user.email,
        name: user.name,
      });
      if (policy) throw badRequest(policy);

      const now = new Date();
      await manager.update(
        User,
        { id: user.id },
        {
          status: UserStatus.ACTIVE,
          passwordHash: await this.passwords.hash(password),
          passwordChangedAt: now,
          emailVerifiedAt: now,
        },
      );
      await this.sessions.revokeAll(manager, user.id, 'invite_accepted');
    });
  }

  // ---------------------------------------------------------------- sessions

  refresh(rawToken: string | undefined) {
    if (!rawToken) throw unauthorized('auth.session_expired');
    return this.sessions.rotate(rawToken);
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (rawToken) await this.sessions.revokeByRefreshToken(rawToken);
  }

  async logoutEverywhere(userId: string): Promise<void> {
    await this.dataSource.transaction((manager) =>
      this.sessions.revokeAll(manager, userId, 'logout_all'),
    );
  }

  async me(userId: string): Promise<User> {
    const user = await this.dataSource
      .getRepository(User)
      .findOne({ where: { id: userId } });
    if (!user) throw unauthorized();
    return user;
  }

  // ---------------------------------------------------------------- tokens

  /** Revokes any live token of the same purpose for the email, then stores the new one (one live token per purpose). */
  async replaceToken(
    manager: EntityManager,
    input: {
      purpose: TokenPurpose;
      email: string;
      name: string | null;
      userId: string | null;
      rawToken: string;
      ttlMs: number;
    },
  ): Promise<void> {
    await manager.update(
      AuthToken,
      {
        email: input.email,
        purpose: input.purpose,
        usedAt: IsNull(),
        revokedAt: IsNull(),
      },
      { revokedAt: new Date() },
    );
    await manager.insert(AuthToken, {
      purpose: input.purpose,
      email: input.email,
      name: input.name,
      userId: input.userId,
      tokenHash: sha256(input.rawToken),
      expiresAt: new Date(Date.now() + input.ttlMs),
    });
  }

  /** Single-use consumption by conditional update: concurrent requests cannot both succeed. */
  private async consumeToken(
    manager: EntityManager,
    rawToken: string,
    purpose: TokenPurpose,
  ): Promise<AuthToken | null> {
    if (
      typeof rawToken !== 'string' ||
      rawToken.length < 20 ||
      rawToken.length > 100
    )
      return null;
    const result = await manager
      .createQueryBuilder()
      .update(AuthToken)
      .set({ usedAt: () => 'now()' })
      .where(
        'token_hash = :hash AND purpose = :purpose AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()',
        {
          hash: sha256(rawToken),
          purpose,
        },
      )
      .returning('id, email, name, user_id')
      .execute();
    const row = (
      result.raw as Array<{
        id: string;
        email: string;
        name: string | null;
        user_id: string | null;
      }>
    )[0];
    if (!row) return null;
    return Object.assign(new AuthToken(), {
      id: row.id,
      email: row.email,
      name: row.name,
      userId: row.user_id,
      purpose,
    });
  }
}
