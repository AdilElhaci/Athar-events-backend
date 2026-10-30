import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Repository } from 'typeorm';
import type { EnvironmentVariables } from '../../../config/env.validation';
import { unauthorized } from '../../../shared/exceptions/app.exception';
import { User, UserStatus } from '../../users/entities/user.entity';
import { SessionService } from '../services/session.service';
import type {
  AccessTokenPayload,
  AuthenticatedUser,
} from '../types/auth.types';

/** Bearer access token → current user. Rejects revoked sessions, stale session versions and inactive accounts. */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService<EnvironmentVariables, true>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly sessions: SessionService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_SECRET', { infer: true }),
      algorithms: ['HS256'],
      issuer: config.get('JWT_ISSUER', { infer: true }),
      audience: config.get('JWT_AUDIENCE', { infer: true }),
    });
  }

  async validate(payload: AccessTokenPayload): Promise<AuthenticatedUser> {
    if (
      payload.typ !== 'access' ||
      !payload.sid ||
      typeof payload.sv !== 'number'
    )
      throw unauthorized();
    const user = await this.users.findOne({ where: { id: payload.sub } });
    if (
      !user ||
      user.status !== UserStatus.ACTIVE ||
      user.sessionVersion !== payload.sv
    )
      throw unauthorized('auth.session_expired');
    if (!(await this.sessions.isSessionActive(payload.sid, user.id)))
      throw unauthorized('auth.session_expired');
    return { id: user.id, type: user.type, sessionId: payload.sid };
  }
}
