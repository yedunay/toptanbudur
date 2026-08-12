/**
 * Frontend permission helpers — JWT payload üzerinden sayfa erişim kontrolü.
 *
 * JWT'deki `permissions` claim'i ya:
 *   - `["*"]` (OWNER ya da legacy token) → her sayfaya erişim
 *   - veya açık page key listesi (örn. ["dashboard", "orders", ...])
 *
 * Bu modül sadece token'ı *okur* — kaynak doğruluk hâlâ backend
 * `PagePermissionGuard`'da. Frontend kontrolleri sadece UX içindir
 * (sidebar gizleme, erken 403 ekranı). Kullanıcı URL'yi doğrudan yazsa
 * bile backend her zaman aynı kararı verir.
 *
 * Token decode'unda *imza doğrulaması yapılmaz*. JWT zaten Authorization
 * header'ı ile sunucuya gidiyor; sunucu imzayı orada doğruluyor. Burada
 * sadece istemci-tarafı UI kararını veriyoruz.
 */

import { getToken } from "./auth";
import { PAGE_KEYS, isValidPageKey, type PageKey } from "./permission-keys";

interface JwtPayload {
  sub?: string;
  email?: string;
  tenantId?: string;
  role?: string;
  permissions?: unknown;
  exp?: number;
}

/** Base64url → JSON. Bozuk token'da `null` döner — caller'a aktarmaz. */
function decodeJwtPayload(token: string): JwtPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const json = atob(padded);
    return JSON.parse(json) as JwtPayload;
  } catch {
    return null;
  }
}

export interface CurrentPermissions {
  /** OWNER veya `["*"]` taşıyan legacy token → tüm sayfalar erişilebilir. */
  unbounded: boolean;
  /** Açık page key seti. `unbounded` true ise yok sayılır. */
  pageKeys: ReadonlySet<PageKey>;
  /** Token üzerindeki rol — UI etiketleri için. */
  role: string | null;
}

const EMPTY_PERMISSIONS: CurrentPermissions = {
  unbounded: false,
  pageKeys: new Set<PageKey>(),
  role: null,
};

/**
 * Sunucudan taze çekilmiş izinler (GET /admin/permissions/me). AdminShell
 * periyodik doldurur; doluysa JWT claim'ine TERCİH edilir — böylece patron
 * matristen izin değiştirince menü, token yenilenmeden de tazelenir.
 * `forUserId` güvence: token sahibi değişirse (logout→başka giriş) bayat
 * kayıt yok sayılır.
 */
let serverPermissions:
  | { forUserId: string; unbounded: boolean; pageKeys: ReadonlySet<PageKey> }
  | null = null;

export function setServerPermissions(
  eff: { unbounded: boolean; effective: readonly string[] } | null,
): void {
  if (!eff) {
    serverPermissions = null;
    return;
  }
  const userId = getCurrentUserId();
  if (!userId) {
    serverPermissions = null;
    return;
  }
  const keys = new Set<PageKey>();
  for (const k of eff.effective) {
    if (isValidPageKey(k)) keys.add(k);
  }
  serverPermissions = { forUserId: userId, unbounded: eff.unbounded, pageKeys: keys };
}

/**
 * Mevcut access token'dan izinleri çıkarır. Token yoksa veya geçersizse
 * "hiçbir şeye erişim yok" döner — bu güvenli default'tur (ProtectedRoute
 * 403 gösterir, AdminShell guard zaten /login'e yönlendirir).
 */
export function getCurrentPermissions(): CurrentPermissions {
  const token = getToken();
  if (!token) return EMPTY_PERMISSIONS;

  const payload = decodeJwtPayload(token);
  if (!payload) return EMPTY_PERMISSIONS;

  // Sunucu-taze kayıt aynı kullanıcıya aitse onu kullan (JWT claim bayat
  // olabilir — 1 saate kadar). role etiketi yine token'dan gelir.
  if (
    serverPermissions &&
    typeof payload.sub === "string" &&
    serverPermissions.forUserId === payload.sub
  ) {
    return {
      unbounded: serverPermissions.unbounded,
      pageKeys: serverPermissions.pageKeys,
      role: typeof payload.role === "string" ? payload.role : null,
    };
  }

  const role = typeof payload.role === "string" ? payload.role : null;
  const raw = payload.permissions;

  if (!Array.isArray(raw)) {
    // Eski token (permissions yok) — OWNER ise unbounded say, değilse boş.
    if (role === "OWNER") {
      return { unbounded: true, pageKeys: new Set<PageKey>(), role };
    }
    return { unbounded: false, pageKeys: new Set<PageKey>(), role };
  }

  // `["*"]` (veya içinde "*" varsa) → unbounded.
  if (raw.some((v) => v === "*")) {
    return { unbounded: true, pageKeys: new Set<PageKey>(), role };
  }

  const keys = new Set<PageKey>();
  for (const v of raw) {
    if (typeof v === "string" && isValidPageKey(v)) keys.add(v);
  }
  return { unbounded: false, pageKeys: keys, role };
}

/** Belirli bir sayfaya erişim var mı? OWNER her zaman true. */
export function canAccess(page: PageKey): boolean {
  const perms = getCurrentPermissions();
  return perms.unbounded || perms.pageKeys.has(page);
}

/** Mevcut access token'daki kullanıcı id'si (`sub` claim'i). Token yoksa
 *  veya geçersizse `null`. Sadece UI'da self-kontrol için (self-force-logout
 *  butonu disable etmek gibi) — backend zaten kendi guard'larıyla koruyor. */
export function getCurrentUserId(): string | null {
  const token = getToken();
  if (!token) return null;
  const payload = decodeJwtPayload(token);
  if (!payload) return null;
  return typeof payload.sub === "string" ? payload.sub : null;
}

/**
 * Maliyet/kâr bilgilerini görebilir mi? İzin matrisindeki
 * "⚙ Yetki — Maliyet & Kâr Görebilir" satırına bağlıdır; patron istediği
 * kullanıcıya açar. OWNER daima, ADMIN varsayılan açık.
 */
export function canSeeCostProfit(): boolean {
  return canAccess("yetki_maliyet_kar");
}

/**
 * Para yazan işlemleri (bakiye, hediye bakiye, iade onayı, ödeme kaydı)
 * yapabilir mi? "⚙ Yetki — Para İşlemi Yapabilir" satırına bağlıdır.
 */
export function canDoMoneyOps(): boolean {
  return canAccess("yetki_para_islemleri");
}

/**
 * Hesap güvenliği işlemleri (şifre görüntüleme/sıfırlama, token yenileme,
 * kullanıcı silme) — bunlar sayfa izniyle değil ROL ile yönetilir.
 */
export function isPrivilegedAdmin(): boolean {
  const role = getCurrentPermissions().role;
  return role === "OWNER" || role === "ADMIN";
}

/** Her sayfa anahtarının birincil rotası (App.tsx route tanımlarıyla eş). */
const PAGE_PRIMARY_ROUTES: Readonly<Record<PageKey, string>> = {
  dashboard: "/",
  products: "/products",
  suppliers: "/suppliers",
  orders: "/orders",
  customers: "/customers",
  comparisons: "/karsilastirmalar",
  cari: "/cari",
  banka_bilgileri: "/banka-bilgileri",
  pos: "/pos",
  makbuzlar: "/makbuzlar",
  muhasebe_cari_hareketler: "/muhasebe/cari-hareketler",
  muhasebe_tedarikci_hesap: "/muhasebe/tedarikci-hesap",
  muhasebe_bayi_hesap: "/muhasebe/bayi-hesap",
  muhasebe_kar_dagilimi: "/muhasebe/aylik-kar-dagilimi",
  mesajlar: "/mesajlar",
  popup: "/popups",
  karlilik_analizi: "/karlilik-analizi",
  loglar: "/loglar",
  ayarlar_degiskenler: "/ayarlar/degiskenler",
  ayarlar_kullanicilar: "/ayarlar/kullanicilar",
  ayarlar_hesap: "/ayarlar/hesap",
  ayarlar_fatura: "/ayarlar/fatura",
  ayarlar_raporlar: "/ayarlar/raporlar",
  bildirimler: "/bildirimler",
  depo_stogu: "/depo-stogu",
  // Yetenek anahtarlarının rotası yok — sayfa değil, sayfa içi yetki.
  yetki_maliyet_kar: "",
  yetki_para_islemleri: "",
};

/** İlk-izinli-sayfa önceliği: çalışanın günlük işine en yakın sayfalar önde;
 *  listede olmayanlar PAGE_KEYS kanonik sırasıyla denenir. */
const FIRST_ROUTE_PRIORITY: readonly PageKey[] = [
  "dashboard",
  "orders",
  "mesajlar",
  "customers",
  ...PAGE_KEYS,
];

/**
 * Login sonrası düşülecek rota. Dashboard izni olmayan çalışan "/"e
 * gönderilirse 403 ekranıyla karşılaşıyordu; bunun yerine izinli ilk
 * sayfaya yönlendirilir. Hiç izin yoksa "/" (403 ekranı) döner —
 * MEMBER'da `ayarlar_hesap` default açık olduğundan pratikte boş kalmaz.
 */
export function firstAllowedRoute(): string {
  const perms = getCurrentPermissions();
  if (perms.unbounded) return "/";
  for (const key of FIRST_ROUTE_PRIORITY) {
    // Rotası olmayan yetenek anahtarlarını atla.
    const route = PAGE_PRIMARY_ROUTES[key];
    if (route && perms.pageKeys.has(key)) return route;
  }
  return "/";
}
