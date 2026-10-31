/** Arabic-Indic and Persian digits → ASCII. */
const asciiDigits = (value: string): string =>
  value
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

/**
 * Normalises a Saudi mobile number to `9665XXXXXXXX` (E.164 without "+").
 * Accepts 05XXXXXXXX, 5XXXXXXXX, +9665…, 009665… and 9665…, with spaces, dashes or Arabic digits.
 * Returns null for an empty value and undefined when the value is not a Saudi mobile number.
 */
export function normalizeSaudiMobile(
  raw: string | null | undefined,
): string | null | undefined {
  if (raw === null || raw === undefined) return null;
  const compact = asciiDigits(raw).replace(/[\s\-().]/g, '');
  if (compact === '') return null;
  const digits = compact.replace(/^\+/, '').replace(/^00/, '');
  const local = digits.startsWith('966')
    ? digits.slice(3)
    : digits.replace(/^0/, '');
  return /^5\d{8}$/.test(local) ? `966${local}` : undefined;
}
