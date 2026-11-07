import { createHash, randomBytes } from 'node:crypto';
import QRCode from 'qrcode';

/** 32 random bytes as base64url (43 characters, SP-05). Never stored or logged. */
export const newQrToken = (): string => randomBytes(32).toString('base64url');

/** What the database keeps: the SHA-256 hex of the token. */
export const hashQrToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

/** The guest page; the QR encodes this URL, so a phone camera also opens it. */
export const qrUrl = (appOrigin: string, token: string): string =>
  `${appOrigin.replace(/\/+$/, '')}/i/${token}`;

export const renderQrPng = (url: string): Promise<Buffer> =>
  QRCode.toBuffer(url, {
    type: 'png',
    errorCorrectionLevel: 'M',
    margin: 4,
    width: 640,
  });
