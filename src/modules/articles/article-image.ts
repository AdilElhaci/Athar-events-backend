export const MAX_COVER_BYTES = 2 * 1024 * 1024;

const UPLOADED_COVER_PREFIX = '/api/articles/images/';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** An uploaded image, or a bundled file: covers never point at another origin. */
export const COVER_URL = new RegExp(
  `^(${UPLOADED_COVER_PREFIX}${UUID}|/articles/[a-z0-9-]+\\.(png|jpe?g|webp))$`,
);

export const coverUrlFor = (imageId: string) =>
  `${UPLOADED_COVER_PREFIX}${imageId}`;

/** The upload id in a cover URL; null for bundled files and empty covers. */
export const coverImageId = (url: string | null | undefined): string | null =>
  url?.startsWith(UPLOADED_COVER_PREFIX)
    ? url.slice(UPLOADED_COVER_PREFIX.length)
    : null;

/** Trusts the file's bytes, not the client's name or MIME type. SVG is refused: it can carry script. */
export function detectImageType(data: Buffer): string | null {
  if (data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])))
    return 'image/jpeg';
  if (
    data
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return 'image/png';
  if (
    data.subarray(0, 4).toString('latin1') === 'RIFF' &&
    data.subarray(8, 12).toString('latin1') === 'WEBP'
  )
    return 'image/webp';
  return null;
}
