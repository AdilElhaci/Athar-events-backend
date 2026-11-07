import ExcelJS from 'exceljs';
import { badRequest } from '../../../shared/exceptions/app.exception';
import { normalizeSaudiMobile } from '../../users/utils/phone';
import { GuestKind } from '../entities/guest.entity';

export const MAX_SHEET_BYTES = 2 * 1024 * 1024;
export const MAX_SHEET_ROWS = 2000; // OQ-05, OQ-21
const EXAMPLE_PREFIX = 'مثال:';

/** Direction marks, isolates and BOMs (Unicode format characters) that copy-paste from WhatsApp or Excel leaves around text. */
const BIDI_MARKS = /\p{Cf}/gu;

/** Header text (Arabic or English, any case) → column. */
const HEADERS: Record<string, 'name' | 'phone' | 'kind' | 'note'> = {
  الاسم: 'name',
  name: 'name',
  الجوال: 'phone',
  'رقم الجوال': 'phone',
  phone: 'phone',
  النوع: 'kind',
  type: 'kind',
  kind: 'kind',
  ملاحظة: 'note',
  note: 'note',
};

const KINDS: Record<string, GuestKind> = {
  أساسي: GuestKind.INITIAL,
  اساسي: GuestKind.INITIAL,
  initial: GuestKind.INITIAL,
  احتياطي: GuestKind.RESERVE,
  reserve: GuestKind.RESERVE,
};

export type RowReason =
  | 'imports.row.name_invalid'
  | 'imports.row.phone_missing'
  | 'imports.row.phone_invalid'
  | 'imports.row.kind_invalid'
  | 'imports.row.note_too_long'
  | 'imports.row.formula';

export interface ParsedRow {
  rowNumber: number;
  rawName: string;
  rawPhone: string;
  name: string | null;
  phone: string | null;
  kind: GuestKind | null;
  note: string | null;
  reason: RowReason | null;
}

const clean = (value: string) =>
  value.replace(BIDI_MARKS, '').replace(/\s+/g, ' ').trim();

/** A leading = + - @ would run as a formula if the admin ever exported it again. */
export const neutralise = (value: string, max: number) =>
  (/^[=+\-@\t\r]/.test(value) ? `'${value}` : value).slice(0, max);

/** `+9665XXXXXXXX`, or null for empty and undefined for a non-Saudi number. */
export const guestPhone = (raw: string): string | null | undefined => {
  const normalized = normalizeSaudiMobile(raw.replace(BIDI_MARKS, ''));
  return normalized ? `+${normalized}` : normalized;
};

/** Validates one guest the same way for manual entry and import. */
export function validateGuest(input: {
  name: string;
  phone: string;
  kind?: string;
  note?: string;
}): Omit<ParsedRow, 'rowNumber' | 'rawName' | 'rawPhone'> {
  const name = clean(input.name);
  const phone = guestPhone(input.phone);
  const kindText = clean(input.kind ?? '').toLowerCase();
  const kind = kindText ? KINDS[kindText] : GuestKind.INITIAL;
  const note = clean(input.note ?? '') || null;
  const reason: RowReason | null =
    name.length < 2 || name.length > 120
      ? 'imports.row.name_invalid'
      : phone === null
        ? 'imports.row.phone_missing'
        : phone === undefined
          ? 'imports.row.phone_invalid'
          : !kind
            ? 'imports.row.kind_invalid'
            : note && note.length > 200
              ? 'imports.row.note_too_long'
              : null;
  return {
    name: reason ? null : name,
    phone: reason ? null : (phone as string),
    kind: reason ? null : kind,
    note: reason ? null : note,
    reason,
  };
}

interface CellRead {
  text: string;
  formula: boolean;
}

function readCell(cell: ExcelJS.Cell): CellRead {
  const value = cell.value as unknown;
  if (value && typeof value === 'object' && 'formula' in value)
    return {
      text: `=${String((value as { formula: string }).formula)}`,
      formula: true,
    };
  if (value && typeof value === 'object' && 'sharedFormula' in value)
    return { text: '=…', formula: true };
  // Numbers keep all digits (a phone typed as 501234567 has no leading zero to lose).
  if (typeof value === 'number') return { text: String(value), formula: false };
  return { text: cell.text ?? '', formula: false };
}

/** Parses the first sheet of an `.xlsx` in memory. Throws `imports.*` codes for whole-file problems. */
export async function parseGuestSheet(data: Buffer): Promise<ParsedRow[]> {
  // An .xlsx is a zip: refuse anything else before handing it to the parser.
  if (!data.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])))
    throw badRequest('imports.unreadable');
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(data as unknown as ArrayBuffer);
  } catch {
    throw badRequest('imports.unreadable');
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw badRequest('imports.unreadable');

  const columns: Partial<Record<'name' | 'phone' | 'kind' | 'note', number>> =
    {};
  sheet.getRow(1).eachCell((cell, col) => {
    const key = HEADERS[clean(cell.text ?? '').toLowerCase()];
    if (key && columns[key] === undefined) columns[key] = col;
  });
  if (!columns.name || !columns.phone)
    throw badRequest('imports.missing_columns');

  const rows: ParsedRow[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const get = (key: keyof typeof columns): CellRead =>
      columns[key]
        ? readCell(row.getCell(columns[key]))
        : { text: '', formula: false };
    const name = get('name');
    const phone = get('phone');
    const kind = get('kind');
    const note = get('note');
    if (![name, phone, kind, note].some((c) => c.text.trim())) continue;
    // The template's example row, left in by mistake.
    if (clean(name.text).startsWith(EXAMPLE_PREFIX)) continue;
    if (rows.length === MAX_SHEET_ROWS)
      throw badRequest('imports.too_many_rows');

    const base = {
      rowNumber: r,
      rawName: neutralise(name.text, 160),
      rawPhone: neutralise(phone.text, 40),
    };
    if ([name, phone, kind, note].some((c) => c.formula)) {
      rows.push({
        ...base,
        name: null,
        phone: null,
        kind: null,
        note: null,
        reason: 'imports.row.formula',
      });
      continue;
    }
    rows.push({
      ...base,
      ...validateGuest({
        name: name.text,
        phone: phone.text,
        kind: kind.text,
        note: note.text,
      }),
    });
  }
  return rows;
}

/** The fixed template (SP-03 §3): Arabic headers, an example row, a list on the type column. */
export async function buildGuestTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('الضيوف', {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }],
  });
  sheet.columns = [
    { header: 'الاسم', key: 'name', width: 32 },
    { header: 'الجوال', key: 'phone', width: 18, style: { numFmt: '@' } },
    { header: 'النوع', key: 'kind', width: 14 },
    { header: 'ملاحظة', key: 'note', width: 36 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.addRow({
    name: `${EXAMPLE_PREFIX} محمد العتيبي`,
    phone: '0500000000',
    kind: 'أساسي',
    note: 'صف توضيحي: يتجاهله النظام عند الاستيراد',
  });
  for (let r = 2; r <= MAX_SHEET_ROWS + 1; r++)
    sheet.getCell(`C${r}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: ['"أساسي,احتياطي"'],
    };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
