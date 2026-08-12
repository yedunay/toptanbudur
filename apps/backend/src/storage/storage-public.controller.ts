import {
  Controller,
  Get,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { STORAGE_SERVICE, isPublicAssetKey } from './storage.constants';
import type { IFileStorage } from './storage.interface';

/**
 * Durable PUBLIC asset route. `getPublicUrl()` persists
 * `/api/storage-public/<key>` into ProductImage.url / User.profilePhotoUrl /
 * Popup.imageUrl — a stable reference that NEVER expires.
 *
 * This controller STREAMS the object's bytes straight from storage (R2 / local
 * disk). It deliberately does NOT redirect to a presigned URL: there is no
 * signature, no `exp`, nothing that can age out. The image is served from a
 * permanent same-origin URL and cached `immutable` for a year by the CDN /
 * browser, so manual-product images and profile photos stay up FOREVER.
 *
 * History — why streaming, not a presigned redirect:
 *   v1: stored the short-lived presigned URL in the DB → 403'd after 7 days.
 *   v2: stored a durable route that 302-redirected to a fresh 10-min presigned
 *       URL. But Cloudflare cached the *redirect* for 4h while the signature in
 *       it only lived 10 min, so every image worked for the first ~10 min of
 *       each 4h cache cycle and went blank for the other ~3h50m. The files were
 *       always intact in R2 — only the cached signature had expired.
 *   v3 (this): stream the bytes. No signature to expire under any cache TTL.
 *
 * Keys are content-addressed (random UUID filename per upload), so the bytes
 * under a key never change → `immutable` caching is exact and safe. Replacing an
 * image writes a NEW key and repoints the DB row.
 *
 * SECURITY: only whitelisted public prefixes (manual-products/, users/,
 * popups/) are servable. Private attachments (conversation-messages/, refunds,
 * order PDFs) are NOT here — they keep going through the HMAC-signed
 * StorageController, so this route never widens their exposure.
 */
@Controller('storage-public')
export class StoragePublicController {
  private readonly logger = new Logger(StoragePublicController.name);

  constructor(
    @Inject(STORAGE_SERVICE) private readonly storage: IFileStorage,
  ) {}

  @Get('*splat')
  async serve(
    @Param('splat') splat: string | string[],
    @Res() res: Response,
  ): Promise<void> {
    const key = Array.isArray(splat) ? splat.join('/') : splat;
    if (!isPublicAssetKey(key)) throw new NotFoundException();

    let body: Buffer;
    try {
      body = await this.storage.read(key);
    } catch (err) {
      // Missing object (or transient read failure) — 404 so the browser shows
      // its broken-image placeholder rather than a 500. We do NOT cache 404s.
      this.logger.warn(
        `storage-public read failed key=${key}: ${(err as Error).message}`,
      );
      throw new NotFoundException();
    }

    res.setHeader('Content-Type', detectContentType(key, body));
    res.setHeader('Content-Length', body.length);
    // Permanent, never-revalidating cache. The key is content-addressed, so the
    // bytes can never change under it — this is what keeps the image instant and
    // alive forever, with no expiry anywhere in the chain.
    res.setHeader(
      'Cache-Control',
      'public, max-age=31536000, immutable',
    );
    // helmet defaults CORP to same-origin; loosen it so the admin SPA /
    // storefront / landing on other origins can render these <img> (no auth —
    // public assets). Mirrors StorageController.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.status(200).end(body);
  }
}

const EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  ico: 'image/x-icon',
};

/**
 * Best-effort content type: trust the (content-addressed) key extension first,
 * then sniff magic bytes so the image still renders even if the extension is
 * missing or wrong. Falls back to a generic image type — never blocks the byte
 * stream on a metadata guess.
 */
function detectContentType(key: string, body: Buffer): string {
  const ext = key.split('?')[0].split('.').pop()?.toLowerCase();
  if (ext && EXT_MIME[ext]) return EXT_MIME[ext];

  // Magic-byte sniff (covers every image format we accept on upload).
  if (body.length >= 12) {
    if (body[0] === 0x89 && body[1] === 0x50 && body[2] === 0x4e && body[3] === 0x47)
      return 'image/png';
    if (body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff)
      return 'image/jpeg';
    if (body[0] === 0x47 && body[1] === 0x49 && body[2] === 0x46)
      return 'image/gif';
    if (body[0] === 0x42 && body[1] === 0x4d) return 'image/bmp';
    if (
      body[0] === 0x52 && body[1] === 0x49 && body[2] === 0x46 && body[3] === 0x46 &&
      body[8] === 0x57 && body[9] === 0x45 && body[10] === 0x42 && body[11] === 0x50
    )
      return 'image/webp';
    // ISO-BMFF (AVIF/HEIC): "ftyp" at offset 4.
    if (body[4] === 0x66 && body[5] === 0x74 && body[6] === 0x79 && body[7] === 0x70)
      return 'image/avif';
  }
  return 'application/octet-stream';
}
