import { apiFetch } from "./auth";

/**
 * Depo Stoğu — admin frontend API client.
 *
 * Bu modül yalnızca OWNER kullanıcılar tarafından çağrılır; controller
 * tarafında @Roles('OWNER') ile zorunlu kılınmıştır. Tüm endpoint'ler
 * `/admin/house-stock` altında.
 *
 * Müşteri tarafı bu sayfanın varlığından haberdar olmaz; bu nedenle bu
 * dosyada müşteri-yüzlü hiçbir alan (cost price, supplier name, profit)
 * dönüştürülmez.
 */

// ───────────────────── Types ─────────────────────

export interface HouseStockOwner {
  id: string;
  name: string | null;
  email: string;
  profilePhotoUrl: string | null;
}

export interface HouseStockItem {
  id: string;
  tbdrCode: string;
  productName: string | null;
  productImage: string | null;
  stockQty: number;
  reservedQty: number;
  freeQty: number;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HouseStockSettings {
  ownerId: string;
  vacationMode: boolean;
  vacationOnAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type HouseStockOrdersTab =
  | "bekleyen"
  | "kargoVerilecek"
  | "kargoVerildi";

export type HouseStockDispatchKind = "manual" | "from_depot" | "via_supplier" | null;

/** Sipariş içindeki tek bir Depo kalemi (order-grouped satırın altında). */
export interface HouseStockOrderItem {
  id: string;
  productName: string | null;
  productImage: string | null;
  tbdrCode: string | null;
  qty: number;
  reservedQty: number;
  unitPrice: string;
}

/**
 * ORDER-GROUPED satır. Bir siparişin tüm Depo kalemleri tek satırda toplanır
 * (whole-order kuralı: hepsi tek bir OWNER deposuna aittir). Müşteri/şehir
 * alanları DÖNMEZ.
 */
export interface HouseStockOrderRow {
  orderId: string;
  humanOrderNo: string;
  status: string;
  total: string;
  createdAt: string;
  cargoCompany: string | null;
  cargoBarcode: string | null;
  /** Dispatch sonrası "Depo Stoğu {ad}" — bekleyen sekmesinde null olabilir. */
  supplierOrderNo: string | null;
  ownerId: string;
  ownerName: string | null;
  /** "Depo Stoğu {ad}" — her zaman dolu (görüntü için). */
  depotLabel: string;
  reservedQty: number;
  reservedUntil: string | null;
  expiringSoon: boolean;
  dispatchedAt: string | null;
  dispatchKind: HouseStockDispatchKind;
  items: HouseStockOrderItem[];
}

export interface HouseStockSalesSummary {
  monthAmount: string;
  monthCount: number;
  totalAmount: string;
  totalCount: number;
}

export interface HouseStockBadgePayload {
  myCount: number;
  totalCount: number;
  byOwner: Array<{
    ownerId: string;
    ownerName: string | null;
    pendingCount: number;
  }>;
}

export interface UpsertHouseStockItemInput {
  tbdrCode: string;
  stockQty: number;
  note?: string | null;
  mode?: "set" | "add";
}

export interface DispatchActionResult {
  ok: boolean;
  [key: string]: unknown;
}

// ───────────────────── API helpers ─────────────────────

function qs(params: Record<string, string | undefined>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") {
      usp.set(k, v);
    }
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}

// ───────────────────── Owners ─────────────────────

export function fetchOwners(): Promise<HouseStockOwner[]> {
  return apiFetch<HouseStockOwner[]>("/admin/house-stock/owners");
}

// ───────────────────── Items ─────────────────────

export function fetchItems(ownerId: string): Promise<HouseStockItem[]> {
  return apiFetch<HouseStockItem[]>(
    `/admin/house-stock/items${qs({ ownerId })}`,
  );
}

export function upsertItem(
  ownerId: string,
  input: UpsertHouseStockItemInput,
): Promise<HouseStockItem> {
  return apiFetch<HouseStockItem>(
    `/admin/house-stock/items${qs({ ownerId })}`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export function deleteItem(
  itemId: string,
  ownerId: string,
): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(
    `/admin/house-stock/items/${encodeURIComponent(itemId)}${qs({ ownerId })}`,
    { method: "DELETE" },
  );
}

// ───────────────────── Settings ─────────────────────

export function fetchSettings(ownerId: string): Promise<HouseStockSettings> {
  return apiFetch<HouseStockSettings>(
    `/admin/house-stock/settings${qs({ ownerId })}`,
  );
}

export function updateSettings(
  ownerId: string,
  input: { vacationMode: boolean },
): Promise<HouseStockSettings> {
  return apiFetch<HouseStockSettings>(
    `/admin/house-stock/settings${qs({ ownerId })}`,
    {
      method: "PUT",
      body: JSON.stringify(input),
    },
  );
}

// ───────────────────── Orders ─────────────────────

export function fetchOrdersByTab(
  ownerId: string,
  tab: HouseStockOrdersTab,
): Promise<HouseStockOrderRow[]> {
  return apiFetch<HouseStockOrderRow[]>(
    `/admin/house-stock/orders${qs({ ownerId, tab })}`,
  );
}

// ───────────────────── Order-level actions ─────────────────────
//
// Tüm aksiyonlar order-level (orderId). Backend whole-order kuralı gereği bir
// siparişin TÜM Depo kalemleri tek OWNER deposuna aittir; bu yüzden tek
// orderId ile hepsi birlikte işlenir.

/**
 * "Depodan Gönder" (Bekleyen) — siparişin tüm Depo kalemlerini evdeki
 * stoktan gönder. Geri alınamaz; stok düşer, paid→preparing, sipariş "Kargoya
 * Verilecek" sekmesine geçer.
 */
export function dispatchOrderFromDepot(
  orderId: string,
): Promise<DispatchActionResult> {
  return apiFetch<DispatchActionResult>(
    `/admin/house-stock/orders/${encodeURIComponent(orderId)}/dispatch`,
    { method: "POST" },
  );
}

/**
 * "Tedarikçiye Devret" (Bekleyen) — evden gönderilemez, sipariş depo
 * stoğundan çıkar; tedarikten temin edilir. Statü değişmez (paid kalır).
 */
export function transferOrderToSupplier(
  orderId: string,
): Promise<DispatchActionResult> {
  return apiFetch<DispatchActionResult>(
    `/admin/house-stock/orders/${encodeURIComponent(orderId)}/transfer-to-supplier`,
    { method: "POST" },
  );
}

/**
 * "Kargoya Verdim" (Kargoya Verilecek) — ürün fiziksel olarak kargoya teslim
 * edildi. Statü preparing→shipped (nihai aşama).
 */
export function markOrderShipped(
  orderId: string,
): Promise<DispatchActionResult> {
  return apiFetch<DispatchActionResult>(
    `/admin/house-stock/orders/${encodeURIComponent(orderId)}/mark-shipped`,
    { method: "POST" },
  );
}

/**
 * "Gönderimi Sağlayamayacağım Tedarikçiye Devret" (Kargoya Verilecek) —
 * depodan gönderildi ama kargoya verilemiyor. Statü preparing→paid düşer,
 * düşülen stok geri eklenir, sipariş tedarikçiye devredilir.
 */
export function revertOrderToSupplier(
  orderId: string,
): Promise<DispatchActionResult> {
  return apiFetch<DispatchActionResult>(
    `/admin/house-stock/orders/${encodeURIComponent(orderId)}/revert-to-supplier`,
    { method: "POST" },
  );
}

// ───────────────────── Sales / Badge ─────────────────────

export function fetchSalesSummary(
  ownerId: string,
): Promise<HouseStockSalesSummary> {
  return apiFetch<HouseStockSalesSummary>(
    `/admin/house-stock/sales-summary${qs({ ownerId })}`,
  );
}

export function fetchBadge(): Promise<HouseStockBadgePayload> {
  return apiFetch<HouseStockBadgePayload>("/admin/house-stock/badge");
}
