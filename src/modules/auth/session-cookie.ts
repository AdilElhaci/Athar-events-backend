import type { Request, Response } from 'express';

export const REFRESH_COOKIE = 'athar_events_rt';
/** Non-sensitive hint for the frontend's route gating (proxy.ts). Never used for authorization. */
export const SESSION_MARKER_COOKIE = 'athar_events_session';
const REFRESH_COOKIE_PATH = '/api/auth';

/** Host-only cookies (no Domain attribute). */
export function setSessionCookies(
  res: Response,
  refreshToken: string,
  expires: Date,
  secure: boolean,
): void {
  res.cookie(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
    expires,
  });
  res.cookie(SESSION_MARKER_COOKIE, '1', {
    httpOnly: false,
    secure,
    sameSite: 'lax',
    path: '/',
    expires,
  });
}

export function clearSessionCookies(res: Response, secure: boolean): void {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
  });
  res.clearCookie(SESSION_MARKER_COOKIE, {
    httpOnly: false,
    secure,
    sameSite: 'lax',
    path: '/',
  });
}

export const readRefreshCookie = (req: Request): string | undefined => {
  const value = (req.cookies as Record<string, unknown> | undefined)?.[
    REFRESH_COOKIE
  ];
  return typeof value === 'string' ? value : undefined;
};
