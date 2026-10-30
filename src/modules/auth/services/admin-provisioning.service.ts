import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import type { EnvironmentVariables } from '../../../config/env.validation';
import { AdminAction } from '../../admin-actions/admin-action.entity';
import { MailService } from '../../mail/mail.service';
import { adminInviteMail, adminPromotedMail } from '../../mail/mail.templates';
import { User, UserStatus, UserType } from '../../users/entities/user.entity';
import { TokenPurpose } from '../entities/auth-token.entity';
import { normalizeEmail, randomToken } from '../utils/crypto.util';
import { AuthService, INVITE_TOKEN_TTL_MS } from './auth.service';
import { SessionService } from './session.service';

export type ProvisionOutcome =
  'invited' | 'reinvited' | 'promoted' | 'already_admin';

/**
 * The only way to create an administrator: a CLI run on the server (no HTTP route, no
 * credentials in code or env). New admins get a 24-hour invite link to choose a password.
 * Promoting an existing owner requires an explicit flag and signs them out everywhere.
 */
@Injectable()
export class AdminProvisioningService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly mail: MailService,
  ) {}

  async provision(
    rawEmail: string,
    name: string,
    options: { promote: boolean },
  ): Promise<ProvisionOutcome> {
    const email = normalizeEmail(rawEmail);
    const appUrl = (path: string) =>
      new URL(path, this.config.get('APP_ORIGIN', { infer: true })).toString();
    const { outcome, inviteToken } = await this.dataSource.transaction(
      async (
        manager,
      ): Promise<{ outcome: ProvisionOutcome; inviteToken: string | null }> => {
        const existing = await manager.findOne(User, {
          where: { email },
          lock: { mode: 'pessimistic_write' },
        });
        let user: User;
        let result: ProvisionOutcome;

        if (!existing) {
          user = await manager.save(
            manager.create(User, {
              type: UserType.PLATFORM_ADMIN,
              status: UserStatus.INVITED,
              name: name.trim(),
              email,
            }),
          );
          result = 'invited';
        } else if (existing.type === UserType.PLATFORM_ADMIN) {
          if (existing.status !== UserStatus.INVITED)
            return { outcome: 'already_admin', inviteToken: null };
          user = existing;
          result = 'reinvited';
        } else {
          if (!options.promote) {
            throw new Error(
              'This email belongs to an existing owner account. Re-run with --promote to grant admin rights.',
            );
          }
          await manager.update(
            User,
            { id: existing.id },
            { type: UserType.PLATFORM_ADMIN },
          );
          // Fresh authentication is required before the new privileges are used.
          await this.sessions.revokeAll(
            manager,
            existing.id,
            'privilege_change',
          );
          user = existing;
          result = 'promoted';
        }

        let inviteToken: string | null = null;
        if (result !== 'promoted') {
          inviteToken = randomToken();
          await this.auth.replaceToken(manager, {
            purpose: TokenPurpose.ADMIN_INVITE,
            email,
            name: null,
            userId: user.id,
            rawToken: inviteToken,
            ttlMs: INVITE_TOKEN_TTL_MS,
          });
        }
        await manager.insert(AdminAction, {
          actorUserId: null,
          action: `admin.${result}`,
          targetType: 'user',
          targetId: user.id,
          summary: { via: 'cli' },
        });
        return { outcome: result, inviteToken };
      },
    );

    if (inviteToken) {
      await this.mail.send(
        email,
        adminInviteMail(appUrl(`/auth/accept-invite#token=${inviteToken}`)),
      );
    } else if (outcome === 'promoted') {
      await this.mail.send(email, adminPromotedMail(appUrl('/auth/login')));
    }
    return outcome;
  }
}
