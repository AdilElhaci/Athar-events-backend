import { ErrorCode } from '../../../shared/messages';

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

/** Frequently used long passwords and keyboard walks; short common passwords are already rejected by length. */
const COMMON = new Set([
  '123456789012',
  '1234567890123',
  '12345678901234',
  '123456789123',
  '111111111111',
  '000000000000',
  '123123123123',
  'password1234',
  'password12345',
  'password123456',
  'passwordpassword',
  'qwertyuiop12',
  'qwertyuiopasdf',
  '1qaz2wsx3edc',
  '1q2w3e4r5t6y',
  'qwerty123456',
  'iloveyou1234',
  'abcdefghijkl',
  'abc123456789',
  'welcome12345',
  'admin1234567',
  'administrator',
  'letmein12345',
  'football1234',
  'princess1234',
  'saudiarabia1',
  'saudiarabia123',
  'ksa123456789',
]);

/** NIST-style policy: length + blocklist + no identity reuse; no composition rules; NFKC; never trims. */
export function checkPassword(
  raw: string,
  identity: { email: string; name?: string | null },
): ErrorCode | null {
  const password = raw.normalize('NFKC');
  const length = [...password].length; // code points, so Arabic and emoji count as one character
  if (length < PASSWORD_MIN) return 'password.too_short';
  if (length > PASSWORD_MAX) return 'password.too_long';

  const lower = password.toLowerCase();
  if (COMMON.has(lower) || /^(.)\1+$/u.test(password))
    return 'password.too_common';

  const localPart = identity.email.split('@')[0]?.toLowerCase() ?? '';
  const name = identity.name?.trim().toLowerCase() ?? '';
  if (
    lower === identity.email.toLowerCase() ||
    (localPart.length >= 4 && lower.includes(localPart)) ||
    (name.length >= 4 && lower.includes(name.replace(/\s+/g, '')))
  ) {
    return 'password.contains_identity';
  }
  return null;
}

export const normalizePassword = (raw: string): string => raw.normalize('NFKC');
