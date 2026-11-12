import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { conflict, notFound } from '../../shared/exceptions/app.exception';
import { AdminAction } from '../admin-actions/admin-action.entity';
import { SessionService } from '../auth/services/session.service';
import { toUserView, UserView } from './dto/user.dto';
import { User, UserStatus } from './entities/user.entity';

/**
 * SCR-27 (AC-08-5). Suspension ends every session at once and the JWT strategy rejects the
 * account's access tokens on the next request; the owner's events are left as they are.
 * An invited administrator who never set a password is handled with the server CLI (D-28).
 */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly sessions: SessionService,
  ) {}

  setStatus(
    actorUserId: string,
    id: string,
    status: UserStatus.ACTIVE | UserStatus.SUSPENDED,
    reason: string,
  ): Promise<UserView> {
    if (id === actorUserId) throw conflict('users.self');
    return this.dataSource.transaction(async (manager) => {
      const user = await manager.findOne(User, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user) throw notFound();
      if (user.status === UserStatus.INVITED) throw conflict('users.invited');
      if (user.status === status)
        throw conflict(
          status === UserStatus.SUSPENDED
            ? 'users.already_suspended'
            : 'users.already_active',
        );

      user.status = status;
      await manager.save(user);
      if (status === UserStatus.SUSPENDED)
        await this.sessions.revokeAll(manager, id, 'suspended');
      await manager.insert(AdminAction, {
        actorUserId,
        action:
          status === UserStatus.SUSPENDED
            ? 'user.suspended'
            : 'user.reactivated',
        targetType: 'user',
        targetId: id,
        summary: { userType: user.type, reason },
      });
      return toUserView(user);
    });
  }
}
