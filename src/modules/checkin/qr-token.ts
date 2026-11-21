import { createHash, createHmac, randomBytes } from 'node:crypto';
import QRCode from 'qrcode';

/** 32 random bytes as base64url (43 characters, SP-05). Tokens issued before D-55; tests. */
export const newQrToken = (): string => randomBytes(32).toString('base64url');

/**
 * D-55: the guest's token for a QR version, 32 bytes of HMAC-SHA256 as base64url (43 characters,
 * the same shape as a random token). The server can render the same QR again for the reminders;
 * a new version is a new token. Never stored or logged; the database keeps only its hash.
 */
export const deriveQrToken = (
  secret: string,
  guestId: string,
  qrVersion: number,
): string =>
  createHmac('sha256', secret)
    .update(`${guestId}:${qrVersion}`)
    .digest('base64url');

/** What the database keeps: the SHA-256 hex of the token. */
export const hashQrToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

/** The guest page; the QR encodes this URL, so a phone camera also opens it. */
export const qrUrl = (appOrigin: string, token: string): string =>
  `${appOrigin.replace(/\/+$/, '')}/i/${token}`;

/** The same URL as an SVG for the guest page, so the browser needs no QR library. */
export const renderQrSvg = (url: string): Promise<string> =>
  QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 4 });
