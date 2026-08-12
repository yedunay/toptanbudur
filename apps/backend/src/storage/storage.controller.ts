import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { LocalStorageService } from './local-storage.service';
import { STORAGE_SERVICE } from './storage.constants';
import type { IFileStorage } from './storage.interface';

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

/**
 * Routes signed-URL traffic for the local storage driver. The URL shape is
 * `/api/storage/<key>?exp=<unix>&sig=<base64url>` and is minted by
 * LocalStorageService.getSignedUrl(). Verification is constant-time HMAC over
 * `<key>|<exp>` so unauthenticated browsers can still load support attachments
 * via `<img src>` while expired/forged URLs return 403.
 *
 * STORAGE_DRIVER=r2 callers never hit this controller — R2 mints native
 * S3 presigned URLs that the browser fetches directly from Cloudflare.
 */
@Controller('storage')
export class StorageController {
  constructor(
    @Inject(STORAGE_SERVICE) private readonly storage: IFileStorage,
  ) {}

  @Get('*splat')
  async download(
    @Param('splat') splat: string | string[],
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!(this.storage instanceof LocalStorageService)) {
      throw new NotFoundException();
    }
    const key = Array.isArray(splat) ? splat.join('/') : splat;
    if (!key) throw new NotFoundException();

    if (!this.storage.verifySignature(key, exp, sig)) {
      throw new ForbiddenException('Imzası geçersiz veya süresi dolmuş');
    }

    let fullPath: string;
    try {
      fullPath = this.storage.resolvePath(key);
    } catch {
      throw new NotFoundException();
    }

    let size: number;
    try {
      const s = await stat(fullPath);
      if (!s.isFile()) throw new NotFoundException();
      size = s.size;
    } catch {
      throw new NotFoundException();
    }

    const ext = extname(key).toLowerCase();
    const contentType = MIME_BY_EXT[ext] ?? 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', String(size));
    res.setHeader('Cache-Control', 'private, max-age=600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Helmet defaults `Cross-Origin-Resource-Policy: same-origin` for the
    // whole API. JSON endpoints are fetched with CORS so that's fine, but
    // browsers honour CORP for `<img src>`/`<iframe>` no-cors loads —
    // admin SPA (:3002), frontend (:3001) and any other cross-origin
    // client cannot render attachments unless this is loosened. Match
    // industry norm for signed URL endpoints (S3/R2/CDN'ler `cross-origin`
    // döndürür) — auth zaten HMAC imzayla sağlanıyor, CORP burada
    // savunma katmanı değil. Per-route override; helmet'in genel
    // `same-origin` ayarı diğer endpoint'ler için aynen kalır.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    const stream = createReadStream(fullPath);
    stream.on('error', () => {
      if (!res.headersSent) res.status(404).end();
      else res.end();
    });
    stream.pipe(res);
  }
}
