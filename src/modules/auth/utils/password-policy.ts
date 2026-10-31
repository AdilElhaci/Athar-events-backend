import { ErrorCode } from '../../../shared/messages';

/** Owner decision D-32 (2026-10-31): at least 8 characters, no other rules. */
export const PASSWORD_MIN = 8;
/** Upper bound only protects the hashing cost; it is not a composition rule. */
export const PASSWORD_MAX = 128;

/** Length only, counted in code points after NFKC; never trims. */
export function checkPassword(raw: string): ErrorCode | null {
  const length = [...raw.normalize('NFKC')].length; // Arabic and emoji count as one character
  if (length < PASSWORD_MIN) return 'password.too_short';
  if (length > PASSWORD_MAX) return 'password.too_long';
  return null;
}

export const normalizePassword = (raw: string): string => raw.normalize('NFKC');
