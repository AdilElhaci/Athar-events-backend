import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';

/** 32 random bytes, base64url (43 chars). Used for refresh, reset, invite and registration tokens. */
export const randomToken = (): string => randomBytes(32).toString('base64url');

/** Uniform 6-digit code from a CSPRNG. */
export const randomCode = (): string =>
  randomInt(0, 1_000_000).toString().padStart(6, '0');

export const sha256 = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

export const hmac = (secret: string, value: string): string =>
  createHmac('sha256', secret).update(value).digest('hex');

/** Constant-time comparison of two hex digests. */
export function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Email normalisation used everywhere an email is stored or looked up. */
export const normalizeEmail = (email: string): string =>
  email.trim().toLowerCase();
