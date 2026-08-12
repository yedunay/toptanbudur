import { apiFetch } from "./auth";
import type { OrderListItem } from "./orders";
import type { AutoTag, CustomerTag } from "./customer-tags";

export type CustomerStatus = "STANDARD" | "ADMIN_DISCOUNT";

export interface CustomerListItem {
  id: string;
  /** Bayi ID — Customer.bayiNo (BAYI-XXXXXX). */
  bayiNo?: string | null;
  name: string;
  email?: string | null;
  phone?: string | null;
  vergiNo?: string | null;
  vergiDairesi?: string | null;
  tcKimlik?: string | null;
  companyTitle?: string | null;
  mersisNumber?: string | null;
  companyAddress?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  ordersCount: number;
  totalSpent: number;
  lastOrderAt?: string | null;
  /** LEGACY off-list (liste fiyatından) iskonto — yalnız okunur, fallback. */
  discountPercent?: number;
  /** "Kâr İndirimi" (kardan) — düzenlenebilir global oran (0-100). */
  profitDiscountPercent?: number;
  cariBalance?: number;
  xmlToken?: string | null;
  createdAt?: string | null;
  isActive?: boolean;
  mustChangePassword?: boolean;
  /** Manuel etiketler (YALNIZ ADMIN). */
  tags?: CustomerTag[];
  /** Otomatik/sistem etiketleri (veriden hesaplanır, salt-okunur). */
  autoTags?: AutoTag[];
  /**
   * `ADMIN_DISCOUNT` ise müşteri sipariş kalemlerinde maliyet fiyatından
   * faydalanır (paketleme ücreti yine uygulanır). Default `STANDARD`.
   */
  customerStatus?: CustomerStatus;
  /** Tatil modu: bayinin geçici olarak siparişe kapalı olduğunu işaretler. */
  vacationMode?: boolean;
  vacationStartedAt?: string | null;
  /**
   * Fatura kesimi toggle'ı (birfatura.md §9). KAPALI iken bu bayinin
   * siparişleri konsolide aylık e-fatura kesimine (freeze) HİÇ girmez.
   * Default AÇIK (true).
   */
  invoicingEnabled?: boolean;
}

export interface CustomerAddress {
  id: string;
  label?: string | null;
  fullName?: string | null;
  phone?: string | null;
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  district?: string | null;
  postalCode?: string | null;
  isDefault?: boolean;
}

export interface CustomerDetail extends CustomerListItem {
  addresses?: CustomerAddress[];
  recentOrders?: OrderListItem[];
  /** Tüm siparişlerin ortalama tutarı (₺). Backend aggregate'inden gelir. */
  avgOrderValue?: number;
}

export interface CustomerFilters {
  page?: number;
  // "all" → tüm müşteriler tek sayfada. buildQuery String("all") = "all" gönderir;
  // backend bu sentinel'ı tanır (parseInt denemez).
  pageSize?: number | "all";
  q?: string;
  /** Manuel etikete göre filtre (CustomerTag.id). */
  tagId?: string;
  /** Otomatik etikete göre filtre (ör. "no_orders"). */
  autoTag?: string;
}

export interface CustomersResponse {
  data: CustomerListItem[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

function buildQuery(filters: CustomerFilters): string {
  const params = new URLSearchParams();
  if (filters.page) params.set("page", String(filters.page));
  if (filters.pageSize) params.set("pageSize", String(filters.pageSize));
  if (filters.q && filters.q.trim().length > 0) params.set("q", filters.q.trim());
  if (filters.tagId) params.set("tagId", filters.tagId);
  if (filters.autoTag) params.set("autoTag", filters.autoTag);
  return params.toString();
}

interface RawCustomer {
  id: string;
  bayiNo?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  vergiNo?: string | null;
  vergiDairesi?: string | null;
  tcKimlik?: string | null;
  companyTitle?: string | null;
  mersisNumber?: string | null;
  companyAddress?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  ordersCount?: number;
  totalOrders?: number;
  totalSpent?: number | string | null;
  lastOrderAt?: string | null;
  discountPercent?: number | null;
  profitDiscountPercent?: number | null;
  cariBalance?: number | string | null;
  xmlToken?: string | null;
  createdAt?: string | null;
  isActive?: boolean | null;
  mustChangePassword?: boolean | null;
  tags?: CustomerTag[] | null;
  autoTags?: AutoTag[] | null;
  customerStatus?: string | null;
  vacationMode?: boolean | null;
  vacationStartedAt?: string | null;
  invoicingEnabled?: boolean | null;
}

interface RawCustomerDetail extends RawCustomer {
  addresses?: RawAddress[];
  recentOrders?: RawOrder[];
  // backend may also return `orders` instead of `recentOrders`
  orders?: RawOrder[];
  avgOrderValue?: number | string | null;
}

interface RawAddress {
  id?: string;
  label?: string | null;
  title?: string | null;
  fullName?: string | null;
  phone?: string | null;
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  district?: string | null;
  postalCode?: string | null;
  isDefault?: boolean | null;
}

interface RawOrder {
  id: string;
  orderNumber?: string | null;
  humanOrderNo?: string | null;
  status?: string | null;
  total?: number | string | null;
  createdAt?: string | null;
  trackingNumber?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  marketplace?: string | null;
  supplierNames?: string[] | null;
  products?:
    | Array<{
        name?: string | null;
        qty?: number | null;
        imageUrl?: string | null;
      }>
    | null;
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function normalize(raw: RawCustomer): CustomerListItem {
  return {
    id: raw.id,
    bayiNo: raw.bayiNo ?? null,
    name: raw.name ?? "—",
    email: raw.email ?? null,
    phone: raw.phone ?? null,
    vergiNo: raw.vergiNo ?? null,
    vergiDairesi: raw.vergiDairesi ?? null,
    tcKimlik: raw.tcKimlik ?? null,
    companyTitle: raw.companyTitle ?? null,
    mersisNumber: raw.mersisNumber ?? null,
    companyAddress: raw.companyAddress ?? null,
    contactName: raw.contactName ?? null,
    contactPhone: raw.contactPhone ?? null,
    contactEmail: raw.contactEmail ?? null,
    ordersCount: toNumber(raw.ordersCount ?? raw.totalOrders, 0),
    totalSpent: toNumber(raw.totalSpent, 0),
    lastOrderAt: raw.lastOrderAt ?? null,
    discountPercent: toNumber(raw.discountPercent, 0),
    profitDiscountPercent: toNumber(raw.profitDiscountPercent, 0),
    cariBalance: toNumber(raw.cariBalance, 0),
    xmlToken: raw.xmlToken ?? null,
    tags: raw.tags ?? [],
    autoTags: raw.autoTags ?? [],
    createdAt: raw.createdAt ?? null,
    isActive: raw.isActive === null || raw.isActive === undefined ? undefined : Boolean(raw.isActive),
    mustChangePassword:
      raw.mustChangePassword === null || raw.mustChangePassword === undefined
        ? undefined
        : Boolean(raw.mustChangePassword),
    customerStatus:
      raw.customerStatus === "ADMIN_DISCOUNT" ? "ADMIN_DISCOUNT" : "STANDARD",
    vacationMode:
      raw.vacationMode === null || raw.vacationMode === undefined
        ? undefined
        : Boolean(raw.vacationMode),
    vacationStartedAt: raw.vacationStartedAt ?? null,
    // Default AÇIK: backend alanı yoksa (undefined/null) faturalanabilir say.
    invoicingEnabled:
      raw.invoicingEnabled === null || raw.invoicingEnabled === undefined
        ? true
        : Boolean(raw.invoicingEnabled),
  };
}

function normalizeAddress(a: RawAddress, idx: number): CustomerAddress {
  return {
    id: a.id ?? String(idx),
    label: a.label ?? a.title ?? null,
    fullName: a.fullName ?? null,
    phone: a.phone ?? null,
    line1: a.line1 ?? null,
    line2: a.line2 ?? null,
    city: a.city ?? null,
    district: a.district ?? null,
    postalCode: a.postalCode ?? null,
    isDefault: Boolean(a.isDefault),
  };
}

function normalizeOrder(o: RawOrder): OrderListItem {
  return {
    id: o.id,
    orderNumber: o.orderNumber ?? o.id.slice(0, 8),
    humanOrderNo: o.humanOrderNo ?? null,
    customerName: o.customerName ?? "",
    customerEmail: o.customerEmail ?? null,
    createdAt: o.createdAt ?? new Date().toISOString(),
    total: toNumber(o.total, 0),
    status: (o.status ?? "paid") as OrderListItem["status"],
    trackingNumber: o.trackingNumber ?? null,
    marketplace: (o.marketplace ?? null) as OrderListItem["marketplace"],
    supplierNames: Array.isArray(o.supplierNames) ? o.supplierNames : [],
    products: Array.isArray(o.products)
      ? o.products
          .filter((p): p is NonNullable<typeof p> => Boolean(p))
          .map((p, idx) => {
            const raw = p as Record<string, unknown>;
            const itemId =
              typeof raw.itemId === "string" && raw.itemId.length > 0
                ? raw.itemId
                : typeof raw.id === "string" && raw.id.length > 0
                ? raw.id
                : `${o.id}-${idx}`;
            const productId =
              typeof raw.productId === "string" && raw.productId.length > 0
                ? raw.productId
                : null;
            const supplierOrderNo =
              typeof raw.supplierOrderNo === "string" &&
              raw.supplierOrderNo.length > 0
                ? raw.supplierOrderNo
                : null;
            const supplierId =
              typeof raw.supplierId === "string" && raw.supplierId.length > 0
                ? raw.supplierId
                : null;
            const supplierName =
              typeof raw.supplierName === "string" &&
              raw.supplierName.length > 0
                ? raw.supplierName
                : null;
            return {
              itemId,
              productId,
              name: p.name ?? "",
              qty: toNumber(p.qty, 0),
              imageUrl: p.imageUrl ?? null,
              supplierOrderNo,
              supplierId,
              supplierName,
            };
          })
      : [],
  };
}

function normalizeDetail(raw: RawCustomerDetail): CustomerDetail {
  const base = normalize(raw);
  const ordersRaw = raw.recentOrders ?? raw.orders ?? [];
  const orders = ordersRaw.map(normalizeOrder);
  const totalSpent =
    base.totalSpent > 0
      ? base.totalSpent
      : orders.reduce((sum, o) => sum + (o.total || 0), 0);
  const ordersCount =
    base.ordersCount > 0 ? base.ordersCount : orders.length;
  const avgOrderValue =
    raw.avgOrderValue !== null && raw.avgOrderValue !== undefined
      ? toNumber(raw.avgOrderValue, 0)
      : ordersCount > 0
      ? totalSpent / ordersCount
      : 0;
  return {
    ...base,
    ordersCount,
    totalSpent,
    avgOrderValue,
    addresses: (raw.addresses ?? []).map(normalizeAddress),
    recentOrders: orders,
  };
}

/** Backend `{success, data, meta}` zarfını esnekçe açar. */
function unwrap<T>(raw: unknown): { data: T; meta?: unknown } {
  if (raw && typeof raw === "object" && "data" in (raw as object)) {
    const obj = raw as { data: T; meta?: unknown };
    return { data: obj.data, meta: obj.meta };
  }
  return { data: raw as T };
}

export async function fetchCustomers(
  filters: CustomerFilters = {},
): Promise<CustomersResponse> {
  const qs = buildQuery(filters);
  const raw = await apiFetch<unknown>(`/admin/customers${qs ? `?${qs}` : ""}`);

  if (Array.isArray(raw)) {
    const data = (raw as RawCustomer[]).map(normalize);
    return {
      data,
      meta: { total: data.length, page: 1, pageSize: data.length, totalPages: 1 },
    };
  }

  const { data: list, meta } = unwrap<RawCustomer[]>(raw);
  const safeList = Array.isArray(list) ? list : [];
  const m = (meta ?? {}) as {
    total?: number;
    page?: number;
    pageSize?: number;
    limit?: number;
    totalPages?: number;
  };
  return {
    data: safeList.map(normalize),
    meta: {
      total: m.total ?? safeList.length,
      page: m.page ?? 1,
      pageSize: m.pageSize ?? m.limit ?? safeList.length,
      totalPages: m.totalPages ?? 1,
    },
  };
}

export async function fetchCustomer(id: string): Promise<CustomerDetail> {
  const raw = await apiFetch<unknown>(`/admin/customers/${id}`);
  const { data } = unwrap<RawCustomerDetail>(raw);
  if (!data || typeof data !== "object") {
    throw new Error("Beklenmeyen müşteri verisi");
  }
  return normalizeDetail(data);
}

export async function updateCustomerDiscount(
  id: string,
  discountPercent: number,
): Promise<CustomerListItem> {
  const raw = await apiFetch<unknown>(`/admin/customers/${id}/discount`, {
    method: "PATCH",
    body: JSON.stringify({ discountPercent }),
  });
  const { data } = unwrap<RawCustomer>(raw);
  return normalize(data);
}

/**
 * PATCH /api/admin/customers/:id
 * Müşterinin "Admin İndirimi" statüsünü değiştirir. `ADMIN_DISCOUNT` ise tüm
 * ürünler maliyet fiyatından satılır; `STANDARD` ise mevcut iskonto akışına
 * geri döner. Paketleme ücreti her iki durumda da aynen uygulanır.
 */
export async function updateCustomerStatus(
  id: string,
  customerStatus: CustomerStatus,
): Promise<CustomerListItem> {
  const raw = await apiFetch<unknown>(`/admin/customers/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ customerStatus }),
  });
  const { data } = unwrap<RawCustomer>(raw);
  return normalize(data);
}

/**
 * PATCH /api/admin/customers/:id
 * Müşteri profilini günceller (ad/email/telefon/iskonto).
 * Backend hazır değilse 404/501 — UI inline mesaj gösterir.
 */
export interface CustomerProfilePatch {
  name?: string;
  email?: string;
  phone?: string;
  vergiDairesi?: string | null;
  vergiNo?: string | null;
  tcKimlik?: string | null;
  companyTitle?: string | null;
  mersisNumber?: string | null;
  companyAddress?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  discountPercent?: number;
  /** "Kâr İndirimi" (kardan) — global oran (0-100). */
  profitDiscountPercent?: number;
  /** Fatura kesimi toggle'ı (birfatura.md §9). */
  invoicingEnabled?: boolean;
}

export async function updateCustomerProfile(
  id: string,
  patch: CustomerProfilePatch,
): Promise<CustomerListItem> {
  const raw = await apiFetch<unknown>(`/admin/customers/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  const { data } = unwrap<RawCustomer>(raw);
  return normalize(data);
}

/**
 * POST /api/admin/customers/:id/regenerate-token
 * Yeni XML feed token üretir.
 */
export async function regenerateCustomerToken(
  id: string,
): Promise<{ xmlToken: string }> {
  const raw = await apiFetch<unknown>(
    `/admin/customers/${id}/regenerate-token`,
    { method: "POST" },
  );
  const { data } = unwrap<{ xmlToken?: string | null }>(raw);
  return { xmlToken: data?.xmlToken ?? "" };
}

/**
 * POST /api/admin/customers/:id/reset-password
 * Şifreyi sabit varsayılana ("toptan1234") sıfırlar. Backend yanıtında
 * `defaultPassword` alanını döner — eski sürümlerle uyumluluk için
 * `password` alanı da fallback olarak okunur.
 */
export async function resetCustomerPassword(
  id: string,
): Promise<{ password: string }> {
  const raw = await apiFetch<unknown>(
    `/admin/customers/${id}/reset-password`,
    { method: "POST" },
  );
  const { data } = unwrap<{
    password?: string | null;
    defaultPassword?: string | null;
  }>(raw);
  return {
    password: data?.defaultPassword ?? data?.password ?? "toptan1234",
  };
}

/**
 * PATCH /api/admin/customers/:id/password
 * Admin özel şifre atar; bcrypt hash + AES sealed kopya güncellenir.
 */
export async function setCustomerPassword(
  id: string,
  password: string,
): Promise<void> {
  await apiFetch<unknown>(`/admin/customers/${id}/password`, {
    method: "PATCH",
    body: JSON.stringify({ password }),
  });
}

/**
 * GET /api/admin/customers/:id/password
 * Mail servisi devreye alınana kadar admin'in şifreyi görüntüleyebilmesi
 * için AES-256-GCM ile saklanmış parolayı çözer ve döner.
 *
 * - hasEncryptedPassword=false  →  legacy kullanıcı, şifre kasada yok
 *   (yalnızca şifre sıfırlama mümkün)
 * - password!=null              →  düz metin parola, tek seferlik gösterim
 *
 * Endpoint Throttler ile dakika başına 5 istekle sınırlandırılmıştır ve
 * her çağrı admin audit log'una yazılır.
 */
export async function fetchCustomerPassword(
  id: string,
): Promise<{ password: string | null; hasEncryptedPassword: boolean }> {
  const raw = await apiFetch<unknown>(`/admin/customers/${id}/password`);
  const { data } = unwrap<{
    password?: string | null;
    hasEncryptedPassword?: boolean;
  }>(raw);
  return {
    password: data?.password ?? null,
    hasEncryptedPassword: Boolean(data?.hasEncryptedPassword),
  };
}

/**
 * DELETE /api/admin/customers/:id
 * Müşteriyi kalıcı olarak siler.
 */
export async function deleteCustomer(id: string): Promise<void> {
  await apiFetch<unknown>(`/admin/customers/${id}`, { method: "DELETE" });
}

export interface CustomerSupplierDiscount {
  supplierId: string;
  supplierName: string;
  /** "Kâr İndirimi" (kardan) — DÜZENLENEBİLİR. null = girilmemiş. */
  profitDiscountPercent: number | null;
  /** LEGACY off-list (liste fiyatından) — yalnız OKUNUR not; null = yok. */
  discountPercent: number | null;
  /** true ise bu tedarikçide Admin İndirimi (maliyet + paketleme) uygulanır. */
  adminDiscount: boolean;
}

export async function fetchSupplierDiscounts(
  customerId: string,
): Promise<CustomerSupplierDiscount[]> {
  const raw = await apiFetch<unknown>(
    `/admin/customers/${customerId}/supplier-discounts`,
  );
  const { data } = unwrap<CustomerSupplierDiscount[]>(raw);
  return Array.isArray(data) ? data : [];
}

export async function updateSupplierDiscounts(
  customerId: string,
  discounts: Array<{
    supplierId: string;
    /** "Kâr İndirimi" (kardan). Gönderilmezse Kâr İndirimi'ne dokunulmaz. */
    profitDiscountPercent?: number | null;
    adminDiscount?: boolean;
    /** true ise override tamamen silinir (✕ / alanı boşalt) → global'e dön. */
    clearOverride?: boolean;
  }>,
): Promise<void> {
  await apiFetch<unknown>(`/admin/customers/${customerId}/supplier-discounts`, {
    method: "PUT",
    body: JSON.stringify({ discounts }),
  });
}

export interface ActivateCustomerResult {
  customer: { id: string; email: string; name: string; isActive: boolean };
  oneTimePassword: string;
}

export async function activateCustomer(id: string): Promise<ActivateCustomerResult> {
  const raw = await apiFetch<unknown>(`/admin/customers/${id}/activate`, {
    method: "POST",
  });
  const { data } = unwrap<ActivateCustomerResult>(raw);
  return data;
}

/**
 * PATCH /api/admin/customers/:id/vacation
 * Tatil modu toggle. Açık iken müşterinin iade satışı ilanları public listeden
 * gizlenir; mevcut RESERVED akışları etkilenmez. Banlı müşteride bile admin
 * tarafından çağrılabilir (ban ayrı flag).
 */
export interface SetVacationResult {
  id: string;
  vacationMode: boolean;
  vacationStartedAt?: string | null;
  changed?: boolean;
}

export async function setCustomerVacationMode(
  id: string,
  enabled: boolean,
): Promise<SetVacationResult> {
  const raw = await apiFetch<unknown>(`/admin/customers/${id}/vacation`, {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });
  const { data } = unwrap<SetVacationResult>(raw);
  return data;
}

/**
 * POST /admin/customers/bulk-action — toplu aktivasyon/pasifizasyon.
 * Tek müşteri aktivasyon akışından farklıdır; sadece isActive flag'ini değiştirir
 * (welcome mail veya temp parola üretmez).
 */
export interface BulkCustomerActionResult {
  updated: number;
}

export async function bulkCustomerAction(
  ids: string[],
  action: "activate" | "deactivate",
): Promise<BulkCustomerActionResult> {
  const raw = await apiFetch<unknown>(`/admin/customers/bulk-action`, {
    method: "POST",
    body: JSON.stringify({ ids, action }),
  });
  const { data } = unwrap<BulkCustomerActionResult>(raw);
  return data;
}

/**
 * Backend ekibi: hızlı test için seed/oluşturma endpoint'i.
 *   POST /admin/customers/test
 *   Response: { success, data: { id, name?, email, password? } }
 *
 * Endpoint hazır olmadığında 404/501 döner; çağıran taraf butonu disable
 * tutmak yerine kullanıcıya "henüz hazır değil" uyarısı gösterir.
 */
export async function createTestCustomer(): Promise<
  CustomerListItem & { password?: string }
> {
  const raw = await apiFetch<unknown>(`/admin/customers/test`, {
    method: "POST",
  });
  const { data } = unwrap<RawCustomer & { password?: string }>(raw);
  return { ...normalize(data), password: data.password };
}

// ---------------------------------------------------------------------------
// Cari bakiye — admin görüntüleme + düzeltme
// ---------------------------------------------------------------------------

export type CariLedgerType =
  | "TOPUP"
  | "ORDER_PAYMENT"
  | "REFUND"
  | "ADJUSTMENT";

/** Cari hareket tipleri için TR etiketler. */
export const CARI_LEDGER_TYPE_LABELS: Record<CariLedgerType, string> = {
  TOPUP: "Yükleme",
  ORDER_PAYMENT: "Sipariş Ödemesi",
  REFUND: "İade",
  ADJUSTMENT: "Manuel Düzeltme",
};

export interface CariLedgerEntry {
  id: string;
  type: CariLedgerType;
  /** İşaretli tutar: pozitif = alacak, negatif = borç. */
  amount: number;
  /** İşlem sonrası bakiye snapshot'ı. */
  balanceAfter: number;
  description?: string | null;
  createdAt: string;
  orderId?: string | null;
  topupId?: string | null;
  humanOrderNo?: string | null;
  humanTopupNo?: string | null;
  /** Hediye bakiye kaydı mı? true ise "🎁 Hediye Bakiye" etiketi gösterilir. */
  isGift?: boolean;
}

export interface CariLedgerResponse {
  data: CariLedgerEntry[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface AdjustBalanceResult {
  customerId: string;
  previousBalance: number;
  newBalance: number;
  delta: number;
  ledgerId: string;
  currency: string;
}

export interface GiftBalanceResult {
  customerId: string;
  previousBalance: number;
  giftAmount: number;
  newBalance: number;
  ledgerId: string;
  currency: string;
}

interface RawCariLedgerEntry {
  id: string;
  type?: string | null;
  amount?: number | string | null;
  balanceAfter?: number | string | null;
  description?: string | null;
  createdAt?: string | null;
  orderId?: string | null;
  topupId?: string | null;
  humanOrderNo?: string | null;
  humanTopupNo?: string | null;
  isGift?: boolean | null;
}

function normalizeLedgerEntry(raw: RawCariLedgerEntry): CariLedgerEntry {
  return {
    id: raw.id,
    type: (raw.type ?? "ADJUSTMENT") as CariLedgerType,
    amount: toNumber(raw.amount, 0),
    balanceAfter: toNumber(raw.balanceAfter, 0),
    description: raw.description ?? null,
    createdAt: raw.createdAt ?? new Date().toISOString(),
    orderId: raw.orderId ?? null,
    topupId: raw.topupId ?? null,
    humanOrderNo: raw.humanOrderNo ?? null,
    humanTopupNo: raw.humanTopupNo ?? null,
    isGift: raw.isGift ?? false,
  };
}

/**
 * POST /api/admin/customers/:id/balance-adjustment
 * Admin manuel cari bakiye düzeltmesi. `newBalance` yeni MUTLAK bakiye
 * değeridir; backend işaretli farkı hesaplayıp ADJUSTMENT ledger kaydı yazar.
 */
export async function adjustCustomerBalance(
  id: string,
  newBalance: number,
  reason?: string,
): Promise<AdjustBalanceResult> {
  const raw = await apiFetch<unknown>(
    `/admin/customers/${id}/balance-adjustment`,
    {
      method: "POST",
      body: JSON.stringify({
        newBalance,
        ...(reason && reason.trim().length > 0
          ? { reason: reason.trim() }
          : {}),
      }),
    },
  );
  const { data } = unwrap<AdjustBalanceResult>(raw);
  return data;
}

/**
 * POST /api/admin/customers/:id/gift-balance
 * Admin HEDİYE BAKİYE tanımlar. `amount` cari bakiyeye EKLENECEK pozitif hediye
 * tutarıdır (mutlak bakiye değil). Backend isGift+isPromo işaretli ADJUSTMENT
 * ledger kaydı yazar ve müşteriye hediye e-postası gönderir.
 */
export async function giftCustomerBalance(
  id: string,
  amount: number,
  note?: string,
): Promise<GiftBalanceResult> {
  const raw = await apiFetch<unknown>(`/admin/customers/${id}/gift-balance`, {
    method: "POST",
    body: JSON.stringify({
      amount,
      ...(note && note.trim().length > 0 ? { note: note.trim() } : {}),
    }),
  });
  const { data } = unwrap<GiftBalanceResult>(raw);
  return data;
}

/**
 * GET /api/admin/customers/:id/cari-ledger?page=&pageSize=
 * Müşterinin cari hareket defteri — bakiye doğruluğunu denetlemek için.
 */
export async function fetchCustomerCariLedger(
  id: string,
  page = 1,
  pageSize = 20,
): Promise<CariLedgerResponse> {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  const raw = await apiFetch<unknown>(
    `/admin/customers/${id}/cari-ledger?${params.toString()}`,
  );
  const { data, meta } = unwrap<RawCariLedgerEntry[]>(raw);
  const safeList = Array.isArray(data) ? data : [];
  const m = (meta ?? {}) as {
    total?: number;
    page?: number;
    limit?: number;
    pageSize?: number;
    totalPages?: number;
  };
  return {
    data: safeList.map(normalizeLedgerEntry),
    meta: {
      total: m.total ?? safeList.length,
      page: m.page ?? page,
      limit: m.limit ?? m.pageSize ?? pageSize,
      totalPages: m.totalPages ?? 1,
    },
  };
}
