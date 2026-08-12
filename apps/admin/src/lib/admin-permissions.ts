import { apiFetch } from "./auth";
import type { PageKey } from "./permission-keys";

export type Role = "OWNER" | "ADMIN" | "MEMBER" | "CUSTOMER";

export interface PermissionOverride {
  pageKey: PageKey;
  granted: boolean;
}

export interface EffectivePermissions {
  role: Role;
  defaults: readonly PageKey[];
  overrides: PermissionOverride[];
  effective: PageKey[];
  unbounded: boolean;
}

export interface PageCatalogItem {
  key: PageKey;
  label: string;
}

export interface PermissionCatalog {
  pages: PageCatalogItem[];
  /** OWNER `'*'`, diğer roller için açık page key dizisi. */
  roleDefaults: Record<Role, readonly PageKey[] | "*">;
  /** MEMBER (çalışan) rolüne matristen dahi açılamayan sayfalar. */
  memberBlocked: readonly PageKey[];
}

export type OverrideUpdate = {
  pageKey: PageKey;
  /** `true` zorla aç, `false` zorla kapat, `null` override'ı temizle. */
  granted: boolean | null;
};

/** Sayfa kataloğu + role default'ları. Bu çağrı session başına bir defa. */
export async function fetchPermissionCatalog(): Promise<PermissionCatalog> {
  const res = await apiFetch<{ success: boolean; data: PermissionCatalog }>(
    "/admin/permissions/catalog",
  );
  return res.data;
}

/**
 * Aktörün KENDİ efektif izinleri — AdminShell menüyü taze tutmak için
 * periyodik çağırır (backend'de MEMBER dahil her panel rolüne açık).
 */
export async function fetchMyPermissions(): Promise<EffectivePermissions> {
  const res = await apiFetch<{ success: boolean; data: EffectivePermissions }>(
    "/admin/permissions/me",
  );
  return res.data;
}

/** Hedef kullanıcının efektif izinleri — matrix doldurma için. */
export async function fetchUserPermissions(
  userId: string,
): Promise<EffectivePermissions> {
  const res = await apiFetch<{ success: boolean; data: EffectivePermissions }>(
    `/admin/permissions/${userId}`,
  );
  return res.data;
}

/** Override güncellemesi — backend yeni efektif izinleri döner. */
export async function updateUserPermissions(
  userId: string,
  updates: OverrideUpdate[],
): Promise<EffectivePermissions> {
  const res = await apiFetch<{ success: boolean; data: EffectivePermissions }>(
    `/admin/permissions/${userId}`,
    {
      method: "PUT",
      body: JSON.stringify({ updates }),
    },
  );
  return res.data;
}
