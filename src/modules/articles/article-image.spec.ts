import { COVER_URL, coverImageId, detectImageType } from './article-image';

const ID = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';

describe('detectImageType', () => {
  it('recognises JPEG, PNG and WebP by their bytes', () => {
    expect(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(
      'image/jpeg',
    );
    expect(
      detectImageType(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
      ),
    ).toBe('image/png');
    expect(detectImageType(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe(
      'image/webp',
    );
  });

  it('refuses anything else, including SVG', () => {
    expect(detectImageType(Buffer.from('<svg onload="x()"></svg>'))).toBeNull();
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
  });
});

describe('COVER_URL', () => {
  it('accepts uploaded images and bundled files', () => {
    expect(COVER_URL.test(`/api/articles/images/${ID}`)).toBe(true);
    expect(COVER_URL.test('/articles/guest-list.png')).toBe(true);
  });

  it('refuses other origins and paths', () => {
    expect(COVER_URL.test('https://evil.example/a.png')).toBe(false);
    expect(COVER_URL.test('//evil.example/a.png')).toBe(false);
    expect(COVER_URL.test('/articles/../secret.png')).toBe(false);
    expect(COVER_URL.test('/api/articles/images/not-a-uuid')).toBe(false);
  });
});

describe('coverImageId', () => {
  it('extracts the id of an upload only', () => {
    expect(coverImageId(`/api/articles/images/${ID}`)).toBe(ID);
    expect(coverImageId('/articles/qr.png')).toBeNull();
    expect(coverImageId(null)).toBeNull();
  });
});
