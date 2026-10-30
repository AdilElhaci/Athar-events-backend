import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  forbidden,
  unauthorized,
} from '../../../shared/exceptions/app.exception';
import { UserType } from '../../users/entities/user.entity';
import type { AuthenticatedUser } from '../types/auth.types';

const REQUIRED_USER_TYPES = 'required_user_types';

/** Restricts a route to the given user types (Athar convention). Use after JwtAuthGuard. */
export const RequireUserType = (...types: UserType[]) =>
  SetMetadata(REQUIRED_USER_TYPES, types);

@Injectable()
export class UserTypeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserType[] | undefined>(
      REQUIRED_USER_TYPES,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) return true;
    const user = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>().user;
    if (!user) throw unauthorized();
    if (!required.includes(user.type)) throw forbidden();
    return true;
  }
}
