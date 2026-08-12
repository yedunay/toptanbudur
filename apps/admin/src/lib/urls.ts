export const APP_URLS = {
  landing: import.meta.env.VITE_LANDING_URL ?? "http://localhost:3002",
  storefront: import.meta.env.VITE_STOREFRONT_URL ?? "http://localhost:3000",
} as const;

export function storefrontProductUrl(
  slug: string | null | undefined,
): string | null {
  const trimmed = (slug ?? "").trim();
  if (!trimmed) return null;
  return `${APP_URLS.storefront.replace(/\/$/, "")}/katalog/${encodeURIComponent(trimmed)}`;
}
