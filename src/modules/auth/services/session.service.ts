import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import type { EnvironmentVariables } from '../../../config/env.validation';
import {
  conflict,
  unauthorized,
} from '../../../shared/exceptions/app.exception';
import { User, UserStatus } from '../../users/entities/user.entity';
import { RefreshToken } from '../entities/refresh-token.entity';
import { Session } from '../entities/session.entity';
import type { AccessTokenPayload } from '../types/auth.types';
import { hmac, randomToken } from '../utils/crypto.util';

/** A refresh token reused within this window right after rotation is treated as a multi-tab race, not theft. */
const ROTATION_GRACE_MS = 15_000;

export interface ClientMeta {
  ip: string | null;
  userAgent: string | null;
}

export interface IssuedSession {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
}

@Injectable()
export class SessionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  private hashRefresh(token: string): string {
    return hmac(this.config.get('TOKEN_PEPPER', { infer: true }), token);
  }

  private signAccess(
    user: Pick<User, 'id' | 'sessionVersion'>,
    sessionId: string,
  ): string {
    const payload: AccessTokenPayload = {
      sub: user.id,
      sid: sessionId,
      sv: user.sessionVersion,
      typ: 'access',
    };
    return this.jwt.sign(payload);
  }

  /**
   * Opens a session for `userId` inside the caller's transaction. Locks the user row and refuses
   * when the account is not ACTIVE or its session version changed since the caller checked the
   * password (for example a password reset happened during the login).
   */
  async issue(
    manager: EntityManager,
    userId: string,
    expectedVersion: number,
    meta: ClientMeta,
  ): Promise<IssuedSession> {
    const user = await manager.findOne(User, {
      where: { id: userId },
      lock: { mode: 'pessimistic_write' },
    });
    if (
      !user ||
      user.status !== UserStatus.ACTIVE ||
      user.sessionVersion !== expectedVersion
    ) {
      throw unauthorized('auth.invalid_credentials');
    }
    const ttlDays = this.config.get('REFRESH_TTL_DAYS', { infer: true });
    const expiresAt = new Date(Date.now() + ttlDays * 86_400_000);
    const session = await manager.save(
      manager.create(Session, {
        userId,
        expiresAt,
        ip: meta.ip?.slice(0, 64) ?? null,
        userAgent: meta.userAgent?.slice(0, 255) ?? null,
        lastUsedAt: new Date(),
      }),
    );
    const refreshToken = randomToken();
    await manager.insert(RefreshToken, {
      sessionId: session.id,
      tokenHash: this.hashRefresh(refreshToken),
      expiresAt,
    });
    await manager.update(User, { id: userId }, { lastLoginAt: new Date() });
    return {
      accessToken: this.signAccess(user, session.id),
      expiresIn: this.config.get('JWT_ACCESS_TTL_SECONDS', { infer: true }),
      refreshToken,
      refreshExpiresAt: expiresAt,
    };
  }

  /**
   * Rotates a refresh token atomically. Reuse of an already-rotated token ends the whole
   * session, except within a short grace window (another tab won the race): that answers
   * 409 `auth.refresh_race` and keeps cookies, so the client retries with the new cookie.
   * Lock order is user → session → refresh token, as in every other session operation.
   */
  async rotate(rawToken: string): Promise<IssuedSession & { user: User }> {
    const tokenHash = this.hashRefresh(rawToken);
    const outcome = await this.dataSource.transaction(
      async (
        manager,
      ): Promise<(IssuedSession & { user: User }) | 'invalid' | 'race'> => {
        const found = await manager.findOne(RefreshToken, {
          where: { tokenHash },
        });
        const owner = found
          ? await manager.findOne(Session, { where: { id: found.sessionId } })
          : null;
        if (!found || !owner) return 'invalid';

        const user = await manager.findOne(User, {
          where: { id: owner.userId },
          lock: { mode: 'pessimistic_write' },
        });
        const session = await manager.findOne(Session, {
          where: { id: owner.id },
          lock: { mode: 'pessimistic_write' },
        });
        const current = await manager.findOne(RefreshToken, {
          where: { id: found.id },
          lock: { mode: 'pessimistic_write' },
        });
        const now = new Date();
        if (
          !user ||
          !session ||
          !current ||
          session.revokedAt ||
          session.expiresAt <= now ||
          current.expiresAt <= now
        ) {
          return 'invalid';
        }

        if (current.rotatedAt) {
          if (
            now.getTime() - current.rotatedAt.getTime() <=
            ROTATION_GRACE_MS
          ) {
            return 'race';
          }
          await manager.update(
            Session,
            { id: session.id },
            { revokedAt: now, revokedReason: 'refresh_reuse' },
          );
          return 'invalid';
        }

        if (user.status !== UserStatus.ACTIVE) {
          await manager.update(
            Session,
            { id: session.id },
            { revokedAt: now, revokedReason: 'account_inactive' },
          );
          return 'invalid';
        }

        await manager.update(
          RefreshToken,
          { id: current.id },
          { rotatedAt: now },
        );
        const refreshToken = randomToken();
        await manager.insert(RefreshToken, {
          sessionId: session.id,
          tokenHash: this.hashRefresh(refreshToken),
          expiresAt: session.expiresAt,
        });
        await manager.update(Session, { id: session.id }, { lastUsedAt: now });
        return {
          user,
          accessToken: this.signAccess(user, session.id),
          expiresIn: this.config.get('JWT_ACCESS_TTL_SECONDS', { infer: true }),
          refreshToken,
          refreshExpiresAt: session.expiresAt,
        };
      },
    );
    // Thrown outside the transaction so a reuse-triggered revocation is committed, not rolled back.
    if (outcome === 'race') throw conflict('auth.refresh_race');
    if (outcome === 'invalid') throw unauthorized('auth.session_expired');
    return outcome;
  }

  /** Ends the session that owns `rawToken` (logout on this device). */
  async revokeByRefreshToken(rawToken: string): Promise<void> {
    const current = await this.dataSource
      .getRepository(RefreshToken)
      .findOne({ where: { tokenHash: this.hashRefresh(rawToken) } });
    if (!current) return;
    await this.dataSource
      .getRepository(Session)
      .update(
        { id: current.sessionId, revokedAt: IsNull() },
        { revokedAt: new Date(), revokedReason: 'logout' },
      );
  }

  /** Ends every session of a user and invalidates every access token already issued (bumps the session version). */
  async revokeAll(
    manager: EntityManager,
    userId: string,
    reason: string,
  ): Promise<void> {
    // Lock order everywhere: user → session → refresh token (prevents missed sessions and deadlocks).
    await manager.findOne(User, {
      where: { id: userId },
      lock: { mode: 'pessimistic_write' },
    });
    await manager.update(
      Session,
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date(), revokedReason: reason },
    );
    await manager.increment(User, { id: userId }, 'sessionVersion', 1);
  }

  /** Used by the JWT strategy on every request: the session must still be open. */
  async isSessionActive(sessionId: string, userId: string): Promise<boolean> {
    const session = await this.dataSource
      .getRepository(Session)
      .findOne({ where: { id: sessionId, userId } });
    return Boolean(
      session && !session.revokedAt && session.expiresAt > new Date(),
    );
  }
}
