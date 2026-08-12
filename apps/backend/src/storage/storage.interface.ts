/**
 * Driver-agnostic file storage contract used by support tickets (and any
 * future feature that needs object storage). Local disk + R2 (S3-compatible)
 * implementations live in this folder; pick via STORAGE_DRIVER env var.
 *
 * `key` is the relative path inside the storage bucket/root. Callers should
 * never read/write the filesystem directly; route everything through this
 * interface so we can flip to Cloudflare R2 with zero call-site changes.
 */
export interface UploadResult {
  url: string;
  key: string;
}

export interface IFileStorage {
  /**
   * Persist `buffer` under `key`. Returns the publicly addressable URL (for
   * the local driver this is the static `/uploads/...` route; for R2 this is
   * the R2 public/CDN URL after upload).
   */
  upload(
    key: string,
    buffer: Buffer,
    mimetype: string,
  ): Promise<UploadResult>;

  /**
   * Returns a URL the client can use to download the object. For the local
   * driver this is an HMAC-signed `/api/storage/...?exp&sig` URL routed
   * through the authenticated StorageController; for R2 we mint a short-lived
   * S3 presigned URL so private buckets stay private.
   */
  getSignedUrl(key: string, expiresInSec?: number): Promise<string>;

  /**
   * Returns a DURABLE URL for a PUBLIC asset (product images, avatars) that is
   * persisted in a DB row and rendered long after upload. Unlike getSignedUrl
   * (which mints a short-lived, expire-soon URL), this is meant to keep working
   * for the lifetime of the record.
   *   - Local driver: HMAC-signed URL with a multi-year expiry (the file never
   *     moves and the HMAC secret is stable, so it stays valid).
   *   - R2 driver: the CDN URL when R2_PUBLIC_URL is set, otherwise a 7-day
   *     presigned URL (AWS SigV4's hard ceiling for presigned GETs).
   *
   * WHY THIS EXISTS: storing the short-lived `upload()` URL directly in a DB
   * column made manual-product images & profile photos go 403 ~10 min after
   * creation ("photos got deleted" — files were intact, the URL just expired).
   */
  getPublicUrl(key: string): Promise<string>;

  /**
   * Reads the object back as a Buffer. Used by StorageController (private files
   * behind signed URLs) and by StoragePublicController, which streams public
   * assets (product images, avatars) straight to the client so their URLs never
   * expire. Implemented by BOTH drivers (local disk + R2 GetObject).
   */
  read(key: string): Promise<Buffer>;

  /**
   * Removes the object. Idempotent: missing keys must not throw.
   */
  delete(key: string): Promise<void>;
}
