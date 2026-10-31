import { escapeLike } from '../../../shared/pagination';
import { normalizeSaudiMobile } from '../../users/utils/phone';
import { checkPassword } from './password-policy';

describe('checkPassword (D-32: 8 characters, no other rules)', () => {
  it('accepts 8 characters of any kind', () => {
    expect(checkPassword('12345678')).toBeNull();
    expect(checkPassword('password')).toBeNull();
    expect(checkPassword('قصر2026')).toBe('password.too_short'); // 7
    expect(checkPassword('قصر 2026')).toBeNull(); // 8, Arabic and a space
  });

  it('counts code points, not UTF-16 units', () => {
    expect(checkPassword('😀😀😀😀😀😀😀')).toBe('password.too_short'); // 7 emoji
    expect(checkPassword('😀😀😀😀😀😀😀😀')).toBeNull(); // 8 emoji
  });

  it('enforces only the length bounds', () => {
    expect(checkPassword('short12')).toBe('password.too_short');
    expect(checkPassword('x'.repeat(129))).toBe('password.too_long');
    expect(checkPassword('aaaaaaaa')).toBeNull();
  });

  it('never trims: surrounding spaces are part of the password', () => {
    expect(checkPassword('  abcd  ')).toBeNull();
  });
});

describe('normalizeSaudiMobile', () => {
  it.each([
    ['0501234567', '966501234567'],
    ['501234567', '966501234567'],
    ['+966 50 123 4567', '966501234567'],
    ['00966501234567', '966501234567'],
    ['966-50-123-4567', '966501234567'],
    ['٠٥٠١٢٣٤٥٦٧', '966501234567'],
  ])('normalises %s', (input, expected) => {
    expect(normalizeSaudiMobile(input)).toBe(expected);
  });

  it('treats an empty value as "no phone"', () => {
    expect(normalizeSaudiMobile('')).toBeNull();
    expect(normalizeSaudiMobile('  ')).toBeNull();
    expect(normalizeSaudiMobile(null)).toBeNull();
  });

  it('rejects numbers that are not Saudi mobiles', () => {
    expect(normalizeSaudiMobile('0112345678')).toBeUndefined(); // landline
    expect(normalizeSaudiMobile('+971501234567')).toBeUndefined();
    expect(normalizeSaudiMobile('05012345')).toBeUndefined();
    expect(normalizeSaudiMobile('abc')).toBeUndefined();
  });
});

describe('escapeLike', () => {
  it('escapes LIKE wildcards and the escape character', () => {
    expect(escapeLike('100%_off\\x')).toBe('100\\%\\_off\\\\x');
  });
});
