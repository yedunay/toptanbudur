import { apiFetch } from "./auth";

// ──────────────────────────────────────────────────────────────────────────
//  TEDARİKÇİ BAKİYE SENKRONU — admin API istemcisi
//  Backend route prefix: admin/tedarikci-bakiye (tedarikci-cari ile çakışmaz)
//  Bu modül KÂR/MALİYET ile temas etmez; sadece adminin tedarikçi sitesindeki
//  kendi cüzdan bakiyesinin yerel kopyasını okur/yazar.
//
//  NOT: Backend bu uçlarda global zarf (envelope) kullanmaz — servis sonucu
//  ham döner. Yine de projedeki savunmacı desene uyup hem ham hem
//  { success, data } biçimini çözebiliyoruz.
// ──────────────────────────────────────────────────────────────────────────

export type SupplierLedgerType =
  | "MANUAL_SET"
  | "TOPUP"
  | "ORDER_PURCHASE"
  | "ORDER_REFUND"
  | "ADJUSTMENT";

export interface SupplierBalanceRow {
  supplierId: string;
  supplierName: string;
  active: boolean;
  balance: number;
  threshold: number;
  isLow: boolean;
  lowBalanceNotifiedAt: string | null;
  lastMovementAt: string | null;
}

export interface SupplierBalanceSummary {
  totals: {
    totalBalance: number;
    supplierCount: number;
    lowCount: number;
    currency: "TRY";
  };
  suppliers: SupplierBalanceRow[];
}

export interface SupplierLedgerEntry {
  id: string;
  type: SupplierLedgerType;
  amount: number;
  balanceAfter: number;
  orderId: string | null;
  humanOrderNo: string | null;
  description: string | null;
  createdByUserId: string | null;
  createdAt: string;
}

export interface SupplierLedgerPage {
  rows: SupplierLedgerEntry[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SupplierMutationResult {
  balance: number;
  ledgerId: string;
}

export interface SupplierThresholdResult {
  threshold: number;
  balance: number;
  isLow: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Backend ham obje döner; yine de zarf gelirse (eski uyumluluk) çöz. */
function unwrap<T>(raw: unknown): T {
  if (raw && typeof raw === "object" && "data" in (raw as Record<string, unknown>)) {
    const inner = (raw as { data?: unknown }).data;
    if (inner !== undefined && inner !== null) return inner as T;
  }
  return raw as T;
}

function num(value: unknown, fallback = 0): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function mapRow(raw: unknown): SupplierBalanceRow {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    supplierId: typeof r.supplierId === "string" ? r.supplierId : "",
    supplierName: typeof r.supplierName === "string" ? r.supplierName : "",
    active: Boolean(r.active),
    balance: num(r.balance),
    threshold: num(r.threshold),
    isLow: Boolean(r.isLow),
    lowBalanceNotifiedAt: str(r.lowBalanceNotifiedAt),
    lastMovementAt: str(r.lastMovementAt),
  };
}

function mapEntry(raw: unknown): SupplierLedgerEntry {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    id: typeof r.id === "string" ? r.id : "",
    type: (r.type as SupplierLedgerType) ?? "ADJUSTMENT",
    amount: num(r.amount),
    balanceAfter: num(r.balanceAfter),
    orderId: str(r.orderId),
    humanOrderNo: str(r.humanOrderNo),
    description: str(r.description),
    createdByUserId: str(r.createdByUserId),
    createdAt: typeof r.createdAt === "string" ? r.createdAt : new Date().toISOString(),
  };
}

// ─── Reads ───────────────────────────────────────────────────────────────────

export async function fetchSupplierBalanceSummary(): Promise<SupplierBalanceSummary> {
  const raw = await apiFetch<unknown>(`/admin/tedarikci-bakiye/summary`);
  const data = unwrap<Record<string, unknown>>(raw);
  const totals = (data?.totals ?? {}) as Record<string, unknown>;
  const suppliers = Array.isArray(data?.suppliers) ? data.suppliers : [];
  return {
    totals: {
      totalBalance: num(totals.totalBalance),
      supplierCount: Math.trunc(num(totals.supplierCount)),
      lowCount: Math.trunc(num(totals.lowCount)),
      currency: "TRY",
    },
    suppliers: suppliers.map(mapRow),
  };
}

export async function fetchSupplierAccount(
  supplierId: string,
): Promise<SupplierBalanceRow> {
  const raw = await apiFetch<unknown>(
    `/admin/tedarikci-bakiye/${encodeURIComponent(supplierId)}`,
  );
  return mapRow(unwrap(raw));
}

export interface SupplierLedgerQuery {
  page?: number;
  pageSize?: number;
  type?: SupplierLedgerType;
}

export async function fetchSupplierLedger(
  supplierId: string,
  query: SupplierLedgerQuery = {},
): Promise<SupplierLedgerPage> {
  const params = new URLSearchParams();
  if (query.page) params.set("page", String(query.page));
  if (query.pageSize) params.set("pageSize", String(query.pageSize));
  if (query.type) params.set("type", query.type);
  const qs = params.toString();
  const raw = await apiFetch<unknown>(
    `/admin/tedarikci-bakiye/${encodeURIComponent(supplierId)}/ledger${qs ? `?${qs}` : ""}`,
  );
  const data = unwrap<Record<string, unknown>>(raw);
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  return {
    rows: rows.map(mapEntry),
    total: Math.trunc(num(data?.total)),
    page: Math.trunc(num(data?.page, 1)) || 1,
    pageSize: Math.trunc(num(data?.pageSize, 50)) || 50,
  };
}

// ─── Mutations ─────────────────────────────────────────────────────────────

export async function topUpSupplier(
  supplierId: string,
  body: { amount: number; description?: string },
): Promise<SupplierMutationResult> {
  const raw = await apiFetch<unknown>(
    `/admin/tedarikci-bakiye/${encodeURIComponent(supplierId)}/topup`,
    { method: "POST", body: JSON.stringify(body) },
  );
  const d = unwrap<Record<string, unknown>>(raw);
  return { balance: num(d?.balance), ledgerId: typeof d?.ledgerId === "string" ? d.ledgerId : "" };
}

export async function adjustSupplier(
  supplierId: string,
  body: { amount: number; reason?: string },
): Promise<SupplierMutationResult> {
  const raw = await apiFetch<unknown>(
    `/admin/tedarikci-bakiye/${encodeURIComponent(supplierId)}/adjust`,
    { method: "POST", body: JSON.stringify(body) },
  );
  const d = unwrap<Record<string, unknown>>(raw);
  return { balance: num(d?.balance), ledgerId: typeof d?.ledgerId === "string" ? d.ledgerId : "" };
}

export async function setSupplierBalance(
  supplierId: string,
  body: { newBalance: number; reason?: string },
): Promise<SupplierMutationResult> {
  const raw = await apiFetch<unknown>(
    `/admin/tedarikci-bakiye/${encodeURIComponent(supplierId)}/set-balance`,
    { method: "POST", body: JSON.stringify(body) },
  );
  const d = unwrap<Record<string, unknown>>(raw);
  return { balance: num(d?.balance), ledgerId: typeof d?.ledgerId === "string" ? d.ledgerId : "" };
}

export async function setSupplierThreshold(
  supplierId: string,
  body: { threshold: number },
): Promise<SupplierThresholdResult> {
  const raw = await apiFetch<unknown>(
    `/admin/tedarikci-bakiye/${encodeURIComponent(supplierId)}/threshold`,
    { method: "PATCH", body: JSON.stringify(body) },
  );
  const d = unwrap<Record<string, unknown>>(raw);
  return {
    threshold: num(d?.threshold),
    balance: num(d?.balance),
    isLow: Boolean(d?.isLow),
  };
}

// ─── UI yardımcıları ─────────────────────────────────────────────────────────

export const LEDGER_TYPE_LABELS: Record<SupplierLedgerType, string> = {
  MANUAL_SET: "Bakiye Ayarlandı",
  TOPUP: "Para Girişi",
  ORDER_PURCHASE: "Sipariş Düşümü",
  ORDER_REFUND: "Sipariş İadesi",
  ADJUSTMENT: "Manuel Düzeltme",
};
