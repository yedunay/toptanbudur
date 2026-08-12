/**
 * DI token for the file storage abstraction. Use this with @Inject() rather
 * than depending on the concrete service class so the driver (local/R2) can
 * be swapped via STORAGE_DRIVER env var without touching call sites.
 */
export const STORAGE_SERVICE = Symbol('STORAGE_SERVICE');

/**
 * Stable, never-expiring backend route for PUBLIC assets (product images,
 * avatars). `getPublicUrl()` mints `<base>/api/storage-public/<key>` and
 * StoragePublicController 302-redirects each hit to a freshly minted
 * download URL (local signed stream OR R2 presigned). This is what makes the
 * URL persistable: the stored value never carries an `exp`, so it cannot rot.
 *
 * NOTE: global prefix `api` is applied by Nest, so the controller path is
 * `storage-public` and the public URL is `/api/storage-public/...`.
 */
export const PUBLIC_REDIRECT_PATH = '/api/storage-public';

/**
 * Key prefixes that StoragePublicController is allowed to redirect to. Only
 * inherently-public asset families belong here — NEVER add private prefixes
 * (conversation-messages/, refund-*, order-pdfs/) or they'd become readable
 * without the HMAC signature the StorageController enforces.
 */
export const PUBLIC_ASSET_PREFIXES = [
  'manual-products/',
  'users/',
  'popups/',
] as const;

/// True when `key` belongs to a public asset family (redirect-safe).
export function isPublicAssetKey(key: string): boolean {
  if (!key || key.includes('..')) return false;
  return PUBLIC_ASSET_PREFIXES.some((p) => key.startsWith(p));
}
