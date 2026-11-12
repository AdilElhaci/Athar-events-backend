import { bodyVariablesValid } from './whatsapp-templates.service';

describe('bodyVariablesValid (Meta body-variable rules)', () => {
  it('accepts plain text and sequential variables with one example each', () => {
    expect(bodyVariablesValid('مرحباً بكم في المنصة.', [])).toBe(true);
    expect(
      bodyVariablesValid('أهلاً {{1}}، موعدكم {{2}} في القاعة.', [
        'سارة',
        'غداً',
      ]),
    ).toBe(true);
    // A repeated variable needs one example.
    expect(bodyVariablesValid('أهلاً {{1}} ثم {{1}} مرة أخرى.', ['سارة'])).toBe(
      true,
    );
  });

  it('rejects gaps, missing or extra examples', () => {
    expect(bodyVariablesValid('أهلاً {{1}} و {{3}} هنا.', ['a', 'b'])).toBe(
      false,
    );
    expect(bodyVariablesValid('أهلاً {{1}} هنا.', [])).toBe(false);
    expect(bodyVariablesValid('أهلاً {{1}} هنا.', ['a', 'b'])).toBe(false);
  });

  it('rejects a body that starts or ends with a variable', () => {
    expect(bodyVariablesValid('{{1}} مرحباً بك.', ['سارة'])).toBe(false);
    expect(bodyVariablesValid('مرحباً بك {{1}}.', ['سارة'])).toBe(false);
  });

  it('rejects malformed braces', () => {
    expect(bodyVariablesValid('أهلاً {{name}} هنا.', [])).toBe(false);
    expect(bodyVariablesValid('أهلاً {{1} هنا.', [])).toBe(false);
  });
});
