import { cookies } from "next/headers";
import type { CategoryVisibility } from "./catalog-prefs";
import { CATEGORY_VISIBILITY_COOKIE } from "./catalog-prefs";

export async function readCategoryVisibility(): Promise<CategoryVisibility | null> {
  const store = await cookies();
  const raw = store.get(CATEGORY_VISIBILITY_COOKIE)?.value;
  if (raw === "open" || raw === "closed") return raw;
  return null;
}
