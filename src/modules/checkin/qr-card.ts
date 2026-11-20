import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import QRCode from 'qrcode';

/**
 * The entry card sent to the guest on WhatsApp: the QR inside a branded invitation card (event
 * name, guest name, day, venue and reception time) instead of a bare code. Drawn as SVG and
 * rasterised with resvg using the bundled brand font, so the image never depends on system fonts.
 */

// src/modules/checkin and dist/modules/checkin are both three levels below the app root.
const FONT_DIR = join(__dirname, '..', '..', '..', 'assets', 'fonts');
const FONT_FILES = [
  join(FONT_DIR, 'IBMPlexSansArabic-Regular.ttf'),
  join(FONT_DIR, 'IBMPlexSansArabic-SemiBold.ttf'),
];
const FONT = 'IBM Plex Sans Arabic';

const C = {
  burgundy: '#4A1F30',
  ivory: '#F7F2EA',
  rose: '#A87C75',
  gray: '#8C7B7B',
  charcoal: '#2A2A2F',
  white: '#FFFFFF',
};

const W = 1080;
const H = 1440;

export interface QrCardDetails {
  url: string;
  eventName: string;
  guestName: string;
  startsAt: Date;
  timezone: string;
  venueName: string;
}

const esc = (s: string): string =>
  s.replace(/[<>&"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** A rough fit: shrinks the font for long strings so one line stays inside `maxWidth`. */
const fit = (text: string, max: number, maxWidth: number, min = 28): number =>
  Math.max(min, Math.min(max, Math.floor(maxWidth / (text.length * 0.52))));

/** Splits at the space nearest the middle when the text is longer than `limit` characters. */
const wrap = (text: string, limit: number): string[] => {
  if (text.length <= limit || !text.includes(' ')) return [text];
  const mid = text.length / 2;
  let best = -1;
  for (let i = 0; i < text.length; i++)
    if (
      text[i] === ' ' &&
      (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))
    )
      best = i;
  // The break replaces a separator (، , ·), which resvg would draw on the wrong side of the line.
  return [
    text.slice(0, best).replace(/\s*[،,·]$/, ''),
    text.slice(best + 1).replace(/^[·]\s*/, ''),
  ];
};

const fmt = (timeZone: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', {
    timeZone,
    ...options,
  });

const text = (
  x: number,
  y: number,
  value: string,
  size: number,
  fill: string,
  weight = 400,
): string =>
  `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="middle" direction="rtl">${esc(value)}</text>`;

const diamond = (cx: number, cy: number, r: number, fill: string): string =>
  `<path d="M${cx} ${cy - r}L${cx + r} ${cy}L${cx} ${cy + r}L${cx - r} ${cy}Z" fill="${fill}"/>`;

/** Line · diamond · line, the logo's diamond motif as a divider. */
const divider = (cy: number, half: number): string =>
  `<line x1="${W / 2 - half}" y1="${cy}" x2="${W / 2 - 22}" y2="${cy}" stroke="${C.rose}" stroke-width="2"/>` +
  diamond(W / 2, cy, 9, C.rose) +
  `<line x1="${W / 2 + 22}" y1="${cy}" x2="${W / 2 + half}" y2="${cy}" stroke="${C.rose}" stroke-width="2"/>`;

const cornerOrnaments = (): string => {
  const inset = 70;
  const pts: [number, number][] = [
    [inset, inset],
    [W - inset, inset],
    [inset, H - inset],
    [W - inset, H - inset],
  ];
  return pts
    .map(([x, y]) => diamond(x, y, 14, C.burgundy) + diamond(x, y, 6, C.ivory))
    .join('');
};

/** The QR as burgundy squares on white; quiet zone comes from the white panel. */
const qrModules = (url: string, x: number, y: number, size: number): string => {
  const qr = QRCode.create(url, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const cell = size / n;
  let d = '';
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (qr.modules.get(r, c))
        d += `M${(x + c * cell).toFixed(2)} ${(y + r * cell).toFixed(2)}h${cell.toFixed(2)}v${cell.toFixed(2)}h-${cell.toFixed(2)}z`;
  return `<path d="${d}" fill="${C.burgundy}" shape-rendering="crispEdges"/>`;
};

export const buildQrCardSvg = (d: QrCardDetails): string => {
  // resvg does not reorder mixed Arabic/number runs reliably, so every line is either all
  // Arabic or all digits: "2026.10.01" and "9:00" sit on their own lines.
  const weekday = fmt(d.timezone, { weekday: 'long' }).format(d.startsAt);
  const part = (
    o: Intl.DateTimeFormatOptions,
    type: Intl.DateTimeFormatPartTypes,
  ) =>
    fmt(d.timezone, o)
      .formatToParts(d.startsAt)
      .find((p) => p.type === type)?.value ?? '';
  const ymd = { year: 'numeric', month: '2-digit', day: '2-digit' } as const;
  const date = `${part(ymd, 'year')}.${part(ymd, 'month')}.${part(ymd, 'day')}`;
  const hm = { hour: 'numeric', minute: '2-digit', hour12: true } as const;
  const time = `${part(hm, 'hour')}:${part(hm, 'minute')}`;
  const hour24 = Number(
    fmt(d.timezone, { hour: 'numeric', hourCycle: 'h23' })
      .formatToParts(d.startsAt)
      .find((p) => p.type === 'hour')?.value,
  );
  const period = hour24 < 12 ? 'صباحاً' : 'مساءً';

  const qrPanel = 540;
  const qrX = (W - qrPanel) / 2;
  const qrY = 380;
  const quiet = 36;

  const venueLines = wrap(d.venueName, 16);
  const venueSize = fit(
    venueLines.reduce((a, b) => (a.length > b.length ? a : b)),
    34,
    280,
    24,
  );

  const colY = 1170;
  const cols = [
    { x: W - 230, label: 'اليوم', lines: [weekday, date] },
    { x: W / 2, label: 'المكان', lines: venueLines },
    { x: 230, label: 'الاستقبال', lines: [time, period] },
  ];

  const columns = cols
    .map(
      (col) =>
        diamond(col.x, colY - 70, 7, C.rose) +
        text(col.x, colY - 25, col.label, 26, C.gray) +
        col.lines
          .map((line, i) =>
            text(
              col.x,
              colY + 25 + i * 44,
              line,
              col.label === 'المكان' ? venueSize : 34,
              C.burgundy,
              600,
            ),
          )
          .join(''),
    )
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="${C.ivory}"/>
<rect x="34" y="34" width="${W - 68}" height="${H - 68}" fill="none" stroke="${C.burgundy}" stroke-width="4"/>
<rect x="52" y="52" width="${W - 104}" height="${H - 104}" fill="none" stroke="${C.rose}" stroke-width="1.5"/>
${cornerOrnaments()}
${text(W / 2, 150, 'أثر إيفنتس', 28, C.rose)}
${text(W / 2, 255, d.eventName, fit(d.eventName, 76, 860), C.burgundy, 600)}
${divider(320, 170)}
<rect x="${qrX}" y="${qrY}" width="${qrPanel}" height="${qrPanel}" rx="18" fill="${C.white}" stroke="${C.rose}" stroke-opacity="0.45" stroke-width="2"/>
${qrModules(d.url, qrX + quiet, qrY + quiet, qrPanel - quiet * 2)}
${text(W / 2, 985, 'بطاقة دخول شخصية', 26, C.gray)}
${text(W / 2, 1042, d.guestName, fit(d.guestName, 48, 760), C.burgundy, 600)}
<line x1="140" y1="1085" x2="${W - 140}" y2="1085" stroke="${C.rose}" stroke-opacity="0.5" stroke-width="1.5"/>
${columns}
${divider(1322, 120)}
${text(W / 2, 1370, 'يُرجى إبراز البطاقة لفريق الاستقبال عند الوصول', 24, C.gray)}
</svg>`;
};

export const renderQrCardPng = (d: QrCardDetails): Buffer =>
  new Resvg(buildQrCardSvg(d), {
    font: {
      fontFiles: FONT_FILES,
      loadSystemFonts: false,
      defaultFontFamily: FONT,
    },
  })
    .render()
    .asPng();
