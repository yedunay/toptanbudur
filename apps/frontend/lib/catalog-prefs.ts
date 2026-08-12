export const CATEGORY_VISIBILITY_COOKIE = "yed_cat_visibility";

export type CategoryVisibility = "open" | "closed";

export const CATEGORY_VISIBILITY_MAX_AGE = 60 * 60 * 24 * 365;

export function buildCategoryVisibilityCookie(value: CategoryVisibility): string {
  const isProd = process.env.NODE_ENV === "production";
  const parts = [
    `${CATEGORY_VISIBILITY_COOKIE}=${value}`,
    "Path=/",
    `Max-Age=${CATEGORY_VISIBILITY_MAX_AGE}`,
    "SameSite=Lax",
  ];
  if (isProd) parts.push("Secure");
  return parts.join("; ");
}

export function clearCategoryVisibilityCookie(): string {
  return `${CATEGORY_VISIBILITY_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}
