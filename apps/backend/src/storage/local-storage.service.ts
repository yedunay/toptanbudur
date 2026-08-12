import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IFileStorage, UploadResult } from './storage.interface';
import { PUBLIC_REDIRECT_PATH } from './storage.constants';

const SIGNED_URL_PREFIX = '/api/storage';

/**
 * Disk-backed implementation of IFileStorage. Files are written under
 * `<UPLOAD_ROOT>/<key>` (default `apps/backend/uploads/`) and served back via
 * StorageController behind HMAC-signed URLs (NOT the legacy public static
 * route — that was removed because it leaked support attachments). URLs look
 * like `/api/storage/support/<id>/<file>.jpg?exp=<unix>&sig=<base64url>` and
 * stop working once `exp` passes.
 */
@Injectable()
export class LocalStorageService implements IFileStorage {
  private readonly logger = new Logger(LocalStorageService.name);
  private readonly root: string;
  private readonly hmacSecret: string;
  /**
   * Optional absolute origin to prepend to signed URLs so consumers on a
   * different origin (admin SPA on :3002, frontend on :3001) can render
   * `<img>` / `<a href>` tags without writing their own join-URL helpers.
   * Empty string keeps the legacy relative form (`/api/storage/...`).
   */
  private readonly publicBaseUrl: string;

  constructor(config: ConfigService) {
    const configured = config.get<string>('LOCAL_STORAGE_ROOT');
    // resolve relative to backend cwd so docker + dev both end up under
    // apps/backend/uploads when not overridden.
    this.root = resolve(process.cwd(), configured ?? 'uploads');
    // Reuse JWT_SECRET as fallback so dev environments work out-of-the-box;
    // operators should still set STORAGE_HMAC_SECRET in production for
    // independent rotation.
    this.hmacSecret =
      config.get<string>('STORAGE_HMAC_SECRET') ??
      config.get<string>('JWT_SECRET') ??
      'dev-storage-secret-change-me';
    this.publicBaseUrl = (config.get<string>('STORAGE_PUBLIC_BASE_URL') ?? '')
      .trim()
      .replace(/\/+$/, '');
    // MARKETPLACE SAFETY (mirrors R2 driver): without STORAGE_PUBLIC_BASE_URL,
    // getPublicUrl() persists a RELATIVE `/api/storage-public/<key>` URL — fine
    // same-origin, but broken in marketplace feeds (Trendyol/Hepsiburada can't
    // resolve a relative path). Flag loudly; never throw (a missing env var must
    // not crash boot on the live site).
    if (!this.publicBaseUrl) {
      this.logger.error(
        'STORAGE_PUBLIC_BASE_URL is EMPTY — public image URLs will be stored ' +
          'RELATIVE and will break in marketplace feeds. Set ' +
          'STORAGE_PUBLIC_BASE_URL=https://<your-domain>.',
      );
    }
  }

  async upload(
    key: string,
    buffer: Buffer,
    _mimetype: string,
  ): Promise<UploadResult> {
    const safeKey = this.assertSafeKey(key);
    const fullPath = join(this.root, safeKey);
    await fs.mkdir(dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, buffer);
    return {
      key: safeKey,
      url: await this.getSignedUrl(safeKey),
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getSignedUrl(key: string, expiresInSec = 600): Promise<string> {
    const safeKey = this.assertSafeKey(key);
    const exp = Math.floor(Date.now() / 1000) + Math.max(60, expiresInSec);
    const sig = this.signKey(safeKey, exp);
    const path = `${SIGNED_URL_PREFIX}/${safeKey}?exp=${exp}&sig=${sig}`;
    return this.publicBaseUrl ? `${this.publicBaseUrl}${path}` : path;
  }

  /**
   * Durable URL for a public asset persisted in a DB row. Returns the stable
   * `/api/storage-public/<key>` route (NO `exp`, so it cannot rot); the
   * StoragePublicController streams the bytes directly on each hit. Driver-
   * agnostic: same URL shape as the R2 driver's non-CDN path.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async getPublicUrl(key: string): Promise<string> {
    const safeKey = this.assertSafeKey(key);
    const path = `${PUBLIC_REDIRECT_PATH}/${safeKey}`;
    return this.publicBaseUrl ? `${this.publicBaseUrl}${path}` : path;
  }

  async read(key: string): Promise<Buffer> {
    const safeKey = this.assertSafeKey(key);
    const fullPath = join(this.root, safeKey);
    return fs.readFile(fullPath);
  }

  async delete(key: string): Promise<void> {
    const safeKey = this.assertSafeKey(key);
    const fullPath = join(this.root, safeKey);
    try {
      await fs.unlink(fullPath);
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') return;
      this.logger.warn(
        `local-storage delete failed key=${safeKey} code=${code ?? 'unknown'}`,
      );
    }
  }

  /**
   * StorageController calls this to validate inbound `?exp&sig` query params
   * before streaming the file. Returns true only when the signature matches
   * AND the URL has not expired. Constant-time comparison prevents timing
   * oracles on the HMAC.
   */
  verifySignature(key: string, expRaw: string, sigRaw: string): boolean {
    if (!key || !expRaw || !sigRaw) return false;
    let safeKey: string;
    try {
      safeKey = this.assertSafeKey(key);
    } catch {
      return false;
    }
    const exp = Number.parseInt(expRaw, 10);
    if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
    const expected = this.signKey(safeKey, exp);
    const a = Buffer.from(sigRaw);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  resolvePath(key: string): string {
    const safeKey = this.assertSafeKey(key);
    return join(this.root, safeKey);
  }

  private signKey(key: string, exp: number): string {
    return createHmac('sha256', this.hmacSecret)
      .update(`${key}|${exp}`)
      .digest('base64url');
  }

  /**
   * Block path traversal and absolute paths. The key must be a relative
   * POSIX-style path with no `..` segments.
   */
  private assertSafeKey(key: string): string {
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
}
