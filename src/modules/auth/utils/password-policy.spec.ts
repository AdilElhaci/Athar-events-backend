import { escapeLike } from '../../../shared/pagination';
import { checkPassword } from './password-policy';

describe('checkPassword', () => {
  const id = { email: 'sara.alqahtani@example.com', name: 'Sara Ali' };

  it('accepts a long passphrase, including Arabic and spaces', () => {
    expect(checkPassword('قصر الضيافة 2026 مساءً', id)).toBeNull();
    expect(checkPassword('correct horse battery', id)).toBeNull();
  });

  it('counts code points, not UTF-16 units', () => {
    expect(checkPassword('😀😀😀😀😀😀😀😀😀😀😀', id)).toBe(
      'password.too_short',
    ); // 11 emoji
  });

  it('enforces length bounds', () => {
    expect(checkPassword('short pass1', id)).toBe('password.too_short');
    expect(checkPassword('x'.repeat(129), id)).toBe('password.too_long');
  });

  it('rejects common and repeated passwords', () => {
    expect(checkPassword('Password1234', id)).toBe('password.too_common');
    expect(checkPassword('aaaaaaaaaaaaaa', id)).toBe('password.too_common');
  });

  it('rejects passwords containing the email local part or the name', () => {
    expect(checkPassword('sara.alqahtani2026!', id)).toBe(
      'password.contains_identity',
    );
    expect(checkPassword('my name is saraali!!', id)).toBe(
      'password.contains_identity',
    );
  });

  it('never trims: surrounding spaces are part of the password', () => {
    expect(checkPassword('  eleven ch ', id)).toBeNull();
  });
});

describe('escapeLike', () => {
  it('escapes LIKE wildcards and the escape character', () => {
    expect(escapeLike('100%_off\\x')).toBe('100\\%\\_off\\\\x');
  });
});
