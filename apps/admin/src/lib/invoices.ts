import { apiFetch } from "./auth";

/**
 * Faz 7 — Admin konsolide fatura paneli API istemcisi (birfatura.md §9).
 *
 * Backend `/admin/invoices/*` uçları her zaman `{ success, data }` zarfı döner;
 * burada her fonksiyon `.data`'yı açar. Tüm `birfaturaOrderId` (BigInt) backend'de
 * string'e, tüm `Decimal` tutarlar `number`'a serialize edilmiştir.
 */

// ── Tipler (backend DTO'larının birebir aynası) ─────────────────────────────

/** Panelde gösterilen + düzenlenen fatura ayar bloğu. */
export interface InvoiceSettings {
  /** Ayın kaçında kesim donar (1..28). */
  cutoffDay: number;
  /** "Kargo Bedeli" birim ücreti (KDV dahil), decimal string. */
  packagingUnitFee: string;
  /** Otomatik (cron) konsolidasyon açık mı. */
  consolidationEnabled: boolean;
  /** BirFatura'ya canlı sipariş push kill-switch'i. */
  ordersEnabled: boolean;
}

export type InvoiceBatchStatus =
  | "FROZEN"
  | "PUSHED"
  | "INVOICED"
  | "FAILED"
  | "CANCELLED"
  | string;

/** Liste/detay başlığında dönen tek batch satırı. */
export interface InvoiceBatchRow {
  id: string;
  customerId: string;
  customerName: string;
  /** 'card' | 'cari' (normalize edilmiş). */
  paymentType: string;
  paymentTypeId: number;
  paymentTypeLabel: string;
  periodStart: string;
  periodEnd: string;
  birfaturaOrderId: string;
  orderCode: string;
  status: InvoiceBatchStatus;
  orderCount: number;
  productsTotalTaxExcluding: number;
  productsTotalTaxIncluding: number;
  totalPaidTaxExcluding: number;
  totalPaidTaxIncluding: number;
  invoiceUrl: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  invoicedAt: string | null;
  frozenAt: string | null;
  createdAt: string;
}

/** Ay-ay gruplanmış batch listesi (panelde ana görünüm). */
export interface InvoiceMonthGroup {
  /** `YYYY-MM` (Europe/Istanbul). */
  month: string;
  /** "Haziran 2026" gibi TR etiketi. */
  monthLabel: string;
  batchCount: number;
  totalTaxIncluding: number;
  batches: InvoiceBatchRow[];
}

/** Batch detayındaki tek üye sipariş. */
export interface InvoiceBatchMember {
  id: string;
  humanOrderNo: string;
  status: string;
  shippedAt: string | null;
  invoicedAt: string | null;
  quantity: number;
  itemCount: number;
  totalTaxIncluding: number;
}

/** Batch detayındaki / önizlemedeki tek kalem satırı (insan-okur döküm). */
export interface InvoiceLine {
  /** Bu satırın ait olduğu siparişin no'su (humanOrderNo, önek yok). */
  orderCode: string;
  productCode: string;
  productName: string;
  quantity: number;
  vatRate: number;
  unitPriceTaxExcluding: number;
  unitPriceTaxIncluding: number;
  lineTotalTaxExcluding: number;
  lineTotalTaxIncluding: number;
  isPackaging: boolean;
}

/** Tam batch detayı (başlık + üye siparişler + kalem dökümü). */
export interface InvoiceBatchDetail extends InvoiceBatchRow {
  totalQuantity: number;
  members: InvoiceBatchMember[];
  lines: InvoiceLine[];
}

/** Liste yanıtı (ay grupları + toplam batch sayısı). */
export interface InvoiceBatchListResponse {
  months: InvoiceMonthGroup[];
  batchCount: number;
}

/** Tek bayinin fatura geçmişi yanıtı. */
export interface CustomerInvoiceBatchesResponse {
  customer: { id: string; name: string };
  months: InvoiceMonthGroup[];
  batchCount: number;
}

// ── Kesim sonucu ────────────────────────────────────────────────────────────

export type FreezeTrigger = "cron" | "manual_single" | "manual_all";

export interface FreezeBatchResult {
  batchId: string;
  birfaturaOrderId: string;
  customerId: string;
  paymentType: string;
  orderCount: number;
  orderCodes: string[];
  totalPaidTaxIncluding: number;
}

export interface FreezeResult {
  trigger: FreezeTrigger;
  /** ISO (backend Date → JSON). */
  periodEnd: string;
  periodStart: string;
  batchCount: number;
  orderCount: number;
  skippedGroups: number;
  batches: FreezeBatchResult[];
}

// ── Önizleme sonucu ─────────────────────────────────────────────────────────

/** Önizleme fatura başlığındaki billing snapshot. */
export interface BillingSnapshot {
  billingName: string | null;
  billingCompanyTitle: string | null;
  billingVergiNo: string | null;
  billingVergiDairesi: string | null;
  billingTcNo: string | null;
  billingEmail: string | null;
  billingPhone: string | null;
  billingMobilePhone: string | null;
  billingAddressLine: string | null;
  billingDistrict: string | null;
  billingCity: string | null;
  billingPostal: string | null;
}

/** Tek bir konsolide önizleme faturası = bir `(müşteri, ödeme tipi)` grubu. */
export interface PreviewInvoice {
  customerId: string;
  customerName: string;
  paymentType: string;
  paymentTypeId: number;
  paymentTypeLabel: string;
  isCorporate: boolean;
  billing: BillingSnapshot;
  orderCount: number;
  orderCodes: string[];
  totalQuantity: number;
  productsTotalTaxExcluding: number;
  productsTotalTaxIncluding: number;
  totalPaidTaxExcluding: number;
  totalPaidTaxIncluding: number;
  lines: InvoiceLine[];
  birfaturaOrder: Record<string, unknown>;
}

/** Önizleme sonucu (kapsam + dönem + üretilen faturalar). DB'ye yazılmaz. */
export interface PreviewResult {
  isPreview: true;
  scope: "single" | "all";
  customerId: string | null;
  asOf: string;
  periodStart: string;
  periodEnd: string;
  invoiceCount: number;
  orderCount: number;
  invoices: PreviewInvoice[];
}

// ── Zarf açıcı ──────────────────────────────────────────────────────────────

/** Backend `{ success, data }` zarfından `data`'yı esnekçe çıkarır. */
function unwrap<T>(raw: unknown): T {
  if (raw && typeof raw === "object" && "data" in (raw as object)) {
    return (raw as { data: T }).data;
  }
  return raw as T;
}

// ── İstemci fonksiyonları ───────────────────────────────────────────────────

/** GET /api/admin/invoices/settings */
export async function fetchInvoiceSettings(): Promise<InvoiceSettings> {
  const raw = await apiFetch<unknown>("/admin/invoices/settings");
  return unwrap<InvoiceSettings>(raw);
}

/** PUT /api/admin/invoices/settings — sadece verilen alanları yazar. */
export async function updateInvoiceSettings(patch: {
  cutoffDay?: number;
  packagingUnitFee?: string;
  consolidationEnabled?: boolean;
  ordersEnabled?: boolean;
}): Promise<InvoiceSettings> {
  const raw = await apiFetch<unknown>("/admin/invoices/settings", {
    method: "PUT",
    body: JSON.stringify(patch),
  });
  return unwrap<InvoiceSettings>(raw);
}

/** GET /api/admin/invoices/batches — ay-ay gruplu batch listesi. */
export async function fetchInvoiceBatches(filters: {
  customerId?: string;
  status?: string;
} = {}): Promise<InvoiceBatchListResponse> {
  const params = new URLSearchParams();
  if (filters.customerId) params.set("customerId", filters.customerId);
  if (filters.status) params.set("status", filters.status);
  const qs = params.toString();
  const raw = await apiFetch<unknown>(
    `/admin/invoices/batches${qs ? `?${qs}` : ""}`,
  );
  const data = unwrap<InvoiceBatchListResponse>(raw);
  return {
    months: Array.isArray(data?.months) ? data.months : [],
    batchCount: data?.batchCount ?? 0,
  };
}

/** GET /api/admin/invoices/batches/:id — tek batch tam detayı. */
export async function fetchInvoiceBatch(
  id: string,
): Promise<InvoiceBatchDetail> {
  const raw = await apiFetch<unknown>(`/admin/invoices/batches/${id}`);
  return unwrap<InvoiceBatchDetail>(raw);
}

/** GET /api/admin/invoices/customers/:customerId/batches — bayi fatura geçmişi. */
export async function fetchCustomerInvoiceBatches(
  customerId: string,
): Promise<CustomerInvoiceBatchesResponse> {
  const raw = await apiFetch<unknown>(
    `/admin/invoices/customers/${customerId}/batches`,
  );
  const data = unwrap<CustomerInvoiceBatchesResponse>(raw);
  return {
    customer: data?.customer ?? { id: customerId, name: "—" },
    months: Array.isArray(data?.months) ? data.months : [],
    batchCount: data?.batchCount ?? 0,
  };
}

/**
 * POST /api/admin/invoices/freeze — tekli (customerId verili) veya toplu kesim.
 * Gerçek InvoiceBatch'leri donar (geri alınamaz; UI onay ister).
 */
export async function freezeInvoices(
  customerId?: string,
  asOf?: string,
): Promise<FreezeResult> {
  const body: Record<string, string> = {};
  if (customerId) body.customerId = customerId;
  if (asOf) body.asOf = asOf;
  const raw = await apiFetch<unknown>("/admin/invoices/freeze", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return unwrap<FreezeResult>(raw);
}

/**
 * POST /api/admin/invoices/batches/:id/cancel — donmuş batch'i iptal eder ve
 * üye siparişleri serbest bırakır (birfatura.md §12.9). Faturalanmış batch
 * iptal edilemez (backend 409 döner); zaten iptalse idempotent güncel detay döner.
 * Yanıt: güncellenmiş tam batch detayı.
 */
export async function cancelInvoiceBatch(
  id: string,
): Promise<InvoiceBatchDetail> {
  const raw = await apiFetch<unknown>(
    `/admin/invoices/batches/${id}/cancel`,
    { method: "POST" },
  );
  return unwrap<InvoiceBatchDetail>(raw);
}

/**
 * POST /api/admin/invoices/preview — DB'ye yazmadan kesilecek faturanın
 * birebir aynısını üretir (tekli veya toplu; opsiyonel `asOf` cutoff).
 */
export async function previewInvoices(opts: {
  customerId?: string;
  asOf?: string;
} = {}): Promise<PreviewResult> {
  const body: Record<string, string> = {};
  if (opts.customerId) body.customerId = opts.customerId;
  if (opts.asOf) body.asOf = opts.asOf;
  const raw = await apiFetch<unknown>("/admin/invoices/preview", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return unwrap<PreviewResult>(raw);
}
