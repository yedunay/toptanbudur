import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { IFileStorage, UploadResult } from './storage.interface';
import { PUBLIC_REDIRECT_PATH } from './storage.constants';

/**
 * Cloudflare R2 (S3-compatible) implementation. R2 endpoint is
 * `https://<account_id>.r2.cloudflarestorage.com`; region must be `auto`.
 *
 * URL strategy:
 *   - If R2_PUBLIC_URL is set (custom domain bound to bucket), upload() returns
 *     `${R2_PUBLIC_URL}/${key}` so <img>/<a href> can hit the CDN directly.
 *   - Otherwise upload() returns a 7-day presigned GET URL — works for private
 *     buckets but rotates with the URL TTL. Support/iade attachments still go
 *     through getSignedUrl() per request, so this is mostly for one-shot
 *     references stored alongside DB rows.
 */
@Injectable()
export class R2StorageService implements IFileStorage {
  private readonly logger = new Logger(R2StorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicUrl: string;
  /// App origin for the durable redirect route fallback when no CDN is bound.
  private readonly appBaseUrl: string;

  constructor(config: ConfigService) {
    const accountId = required(config, 'R2_ACCOUNT_ID');
    const accessKeyId = required(config, 'R2_ACCESS_KEY_ID');
    const secretAccessKey = required(config, 'R2_SECRET_ACCESS_KEY');
    this.bucket = required(config, 'R2_BUCKET');
    const endpoint =
      config.get<string>('R2_ENDPOINT') ??
      `https://${accountId}.r2.cloudflarestorage.com`;
    this.publicUrl = (config.get<string>('R2_PUBLIC_URL') ?? '')
      .trim()
      .replace(/\/+$/, '');
    this.appBaseUrl = (config.get<string>('STORAGE_PUBLIC_BASE_URL') ?? '')
      .trim()
      .replace(/\/+$/, '');

    this.client = new S3Client({
      region: 'auto',
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
    });

    if (!this.publicUrl) {
      this.logger.warn(
        'R2_PUBLIC_URL not set; public assets served via the durable ' +
          `${PUBLIC_REDIRECT_PATH} route instead of direct CDN links.`,
      );
    }
    // MARKETPLACE SAFETY: with neither a CDN (R2_PUBLIC_URL) nor an app origin
    // (STORAGE_PUBLIC_BASE_URL), getPublicUrl() would persist a RELATIVE
    // `/api/storage-public/<key>` URL. That renders fine same-origin but breaks
    // anywhere absolute URLs are required — above all in marketplace product
    // feeds (Trendyol/Hepsiburada cannot resolve a relative path → broken
    // listing image). Loudly flag the misconfig; we do NOT throw, so a missing
    // env var can never take the live site down on boot.
    if (!this.publicUrl && !this.appBaseUrl) {
      this.logger.error(
        'STORAGE_PUBLIC_BASE_URL (and R2_PUBLIC_URL) are EMPTY — public image ' +
          'URLs will be stored RELATIVE and will break in marketplace feeds. ' +
          'Set STORAGE_PUBLIC_BASE_URL=https://<your-domain> immediately.',
      );
    }
  }

  async upload(
    key: string,
    buffer: Buffer,
    mimetype: string,
  ): Promise<UploadResult> {
    const safeKey = assertSafeKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: safeKey,
        Body: buffer,
        ContentType: mimetype,
      }),
    );
    return { key: safeKey, url: await this.getPublicUrl(safeKey) };
  }

  async getSignedUrl(key: string, expiresInSec = 600): Promise<string> {
    const safeKey = assertSafeKey(key);
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: safeKey }),
      { expiresIn: Math.max(60, expiresInSec) },
    );
  }

  /**
   * Durable URL for a public asset persisted in a DB row. With a public bucket
   * (R2_PUBLIC_URL) we return the permanent CDN URL. WITHOUT one we must NOT
   * store a presigned URL — AWS SigV4 caps presigned GETs at 7 days, so it
   * would rot (this was the "photos vanish after a while" bug). Instead we
   * return the stable `${appBase}/api/storage-public/<key>` route, which
   * StoragePublicController serves by STREAMING the bytes directly (no
   * signature, no expiry — it never rots under any cache TTL).
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async getPublicUrl(key: string): Promise<string> {
    const safeKey = assertSafeKey(key);
    if (this.publicUrl) return `${this.publicUrl}/${safeKey}`;
    const path = `${PUBLIC_REDIRECT_PATH}/${safeKey}`;
    return this.appBaseUrl ? `${this.appBaseUrl}${path}` : path;
  }

  // R2 is consumed via presigned URLs; backend rarely needs the bytes back.
  // Implemented for completeness so StorageController can fall back if asked.
  async read(key: string): Promise<Buffer> {
    const safeKey = assertSafeKey(key);
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: safeKey }),
    );
    const body = res.Body;
    if (!body) {
      throw new Error(`R2 object empty: ${safeKey}`);
    }
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async delete(key: string): Promise<void> {
    const safeKey = assertSafeKey(key);
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: safeKey }),
      );
    } catch (err) {
      // R2 returns 204 even for missing keys, so a thrown error here is a real
      // failure (auth, network) — log but don't crash the caller.
      this.logger.warn(
        `R2 delete failed key=${safeKey} err=${(err as Error).message}`,
      );
    }
  }
}

function required(config: ConfigService, name: string): string {
  const v = config.get<string>(name);
  if (!v || v.trim().length === 0) {
    throw new Error(
      `R2 not configured — missing env var ${name}. Set STORAGE_DRIVER=local or provide all R2_* vars.`,
    );
  }
  return v.trim();
}

function assertSafeKey(key: string): string {
  if (typeof key !== 'string' || key.length === 0) {
    throw new Error('storage key required');
  }
  if (key.startsWith('/') || key.startsWith('\\')) {
    throw new Error('storage key must be relative');
  }
  if (key.split(/[\\/]/).some((seg) => seg === '..')) {
    throw new Error('storage key contains traversal segment');
  }
  return key.replace(/\\/g, '/');
}
