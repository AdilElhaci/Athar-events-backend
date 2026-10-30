import type { UserType } from '../../users/entities/user.entity';

export interface AccessTokenPayload {
  sub: string;
  /** Session id: revoking the session invalidates the token immediately. */
  sid: string;
  /** User session version: bumped on password/privilege change and sign-out everywhere. */
  sv: number;
  typ: 'access';
}

/** `req.user` after JwtAuthGuard. Type and status always come from the database row (W11). */
export interface AuthenticatedUser {
  id: string;
  type: UserType;
  sessionId: string;
}
