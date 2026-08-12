import { detectImage, detectMedia } from './image-magic-bytes';

/** İlk baytları verilen imzayla, kalanı sıfırla 32 bayta tamamlar. */
function buf(sig: number[]): Buffer {
  const b = Buffer.alloc(32);
  Buffer.from(sig).copy(b);
  return b;
}

/** ISO-BMFF: 4 bayt boyut + "ftyp" + major brand. */
function ftyp(brand: string): Buffer {
  const b = Buffer.alloc(32);
  b.writeUInt32BE(24, 0);
  b.write('ftyp', 4, 'latin1');
  b.write(brand, 8, 'latin1');
  return b;
}

describe('detectMedia — foto+video magic-byte tespiti (2026-08-02)', () => {
  it('mevcut görsel türlerini aynen tanır (jpeg/png/webp)', () => {
    expect(detectMedia(buf([0xff, 0xd8, 0xff]))).toEqual({
      mimetype: 'image/jpeg',
      extension: 'jpg',
      kind: 'image',
    });
    expect(
      detectMedia(buf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))?.kind,
    ).toBe('image');
  });

  it('GIF tanır', () => {
    expect(detectMedia(buf([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toEqual({
      mimetype: 'image/gif',
      extension: 'gif',
      kind: 'image',
    });
  });

  it('iPhone HEIC fotoğrafını GÖRSEL olarak tanır', () => {
    expect(detectMedia(ftyp('heic'))).toEqual({
      mimetype: 'image/heic',
      extension: 'heic',
      kind: 'image',
    });
    expect(detectMedia(ftyp('mif1'))?.kind).toBe('image');
  });

  it('MP4 ve iPhone MOV videolarını tanır', () => {
    expect(detectMedia(ftyp('isom'))).toEqual({
      mimetype: 'video/mp4',
      extension: 'mp4',
      kind: 'video',
    });
    expect(detectMedia(ftyp('mp42'))?.kind).toBe('video');
    expect(detectMedia(ftyp('qt  '))).toEqual({
      mimetype: 'video/quicktime',
      extension: 'mov',
      kind: 'video',
    });
  });

  it('WebM ve AVI tanır', () => {
    const webm = Buffer.alloc(64);
    Buffer.from([0x1a, 0x45, 0xdf, 0xa3]).copy(webm);
    webm.write('webm', 24, 'latin1');
    expect(detectMedia(webm)?.mimetype).toBe('video/webm');

    const avi = buf([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20]);
    expect(detectMedia(avi)?.mimetype).toBe('video/x-msvideo');
  });

  it('bilinmeyen türü (zip/exe) reddeder', () => {
    expect(detectMedia(buf([0x50, 0x4b, 0x03, 0x04]))).toBeNull();
    expect(detectMedia(Buffer.alloc(4))).toBeNull();
  });

  it('detectImage DARALTILMIŞ kalır — HEIC/video ürün-görseli yüzeylerine sızmaz', () => {
    expect(detectImage(ftyp('heic'))).toBeNull();
    expect(detectImage(ftyp('isom'))).toBeNull();
    expect(detectImage(buf([0xff, 0xd8, 0xff]))?.mimetype).toBe('image/jpeg');
  });
});
