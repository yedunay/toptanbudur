import { apiFetch, getToken } from "./auth";

// ─────────────────────────────────────────────────────────────────────────────
// Muhasebe API istemcisi — backend `admin/muhasebe` uçlarının birebir
// karşılığı (muhasebe.md Faz 3/4/5). Tipler backend servisindeki
// LedgerResult / SupplierAccountReport / DealerAccountReport ile aynı şekli
// taşır; sözleşme değişirse iki tarafı birlikte güncelle.
// ─────────────────────────────────────────────────────────────────────────────

export type LedgerType = "supplier" | "dealer";

export interface LedgerRow {
  id: string;
  date: string;
  type: string;
  description: string | null;
  debit: number;
  credit: number;
  balanceAfter: number | null;
  orderId: string | null;
  humanOrderNo: string | null;
  // Tedarikçide oluşturulan sipariş no (Order.supplierOrderNo); yoksa null → "—".
  supplierOrderNo: string | null;
}

export interface LedgerResult {
  type: LedgerType;
  entity: { id: string; name: string };
  currentBalance: number;
  rows: LedgerRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SupplierAccountReport {
  supplier: { id: string; name: string };
  range: { from: string | null; to: string | null };
  openingBalance: number;
  closingBalance: number;
  currentBalance: number;
  topupTotal: number;
  purchaseTotal: number;
  refundTotal: number;
  adjustmentNet: number;
  netBalance: number;
  // §orta — Tedarikçi tarafı mutabakat (Bayi Hesap ile aynı kimlik).
  reconciliation: {
    inflow: number;
    outflow: number;
    expectedClosing: number;
    closingBalance: number;
    diff: number;
    consistent: boolean;
  };
  topups: Array<{
    id: string;
    date: string;
    amount: number;
    description: string | null;
  }>;
  purchases: Array<{
    id: string;
    date: string;
    amount: number;
    orderId: string | null;
    humanOrderNo: string | null;
    supplierOrderNo: string | null;
    description: string | null;
  }>;
  // Sipariş iadeleri / iptalleri (ORDER_REFUND) — kalem kalem.
  refunds: Array<{
    id: string;
    date: string;
    amount: number;
    orderId: string | null;
    humanOrderNo: string | null;
    supplierOrderNo: string | null;
    description: string | null;
  }>;
  movements: LedgerRow[];
}

export interface DealerAccountReport {
  customer: {
    id: string;
    name: string;
    companyTitle: string | null;
    email: string;
    bayiNo: string | null;
  };
  range: { from: string | null; to: string | null };
  openingBalance: number;
  closingBalance: number;
  currentBalance: number;
  orders: Array<{
    id: string;
    date: string;
    humanOrderNo: string;
    supplierOrderNo: string | null;
    total: number;
    paymentType: string | null;
    status: string;
    invoiceNumber: string | null;
    invoiceUrl: string | null;
    invoicedAt: string | null;
  }>;
  orderTotal: number;
  topups: Array<{
    id: string;
    date: string;
    amount: number;
    method: string;
    source: string;
    status: string;
    humanTopupNo: string | null;
  }>;
  topupHavaleTotal: number;
  topupCardTotal: number;
  topupTotal: number;
  cardOrderTotal: number;
  cariPaymentTotal: number;
  purchaseTotal: number;
  refundTotal: number;
  adjustmentNet: number;
  invoiceTotal: number;
  reconciliation: {
    inflow: number;
    outflow: number;
    expectedClosing: number;
    closingBalance: number;
    diff: number;
    consistent: boolean;
  };
}

export interface SupplierOption {
  id: string;
  name: string;
}

export interface CustomerOption {
  id: string;
  name: string;
  companyTitle: string | null;
  email: string;
  bayiNo: string | null;
}

export interface LedgerQuery {
  type: LedgerType;
  id: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface DateRange {
  from?: string;
  to?: string;
}

const XLSX_ACCEPT =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/octet-stream";

const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

function buildQs(params: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    p.set(key, String(value));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

// ── Hareket tipi etiketleri ──────────────────────────────────────────────────
// CariLedgerType (bayi) + SupplierLedgerType (tedarikçi) birleşik harita.
// Bilinmeyen kod gelirse ham değer gösterilir.

const LEDGER_TYPE_LABELS: Record<string, string> = {
  // Bayi (CariLedgerType)
  TOPUP: "Bakiye Yükleme",
  ORDER_PAYMENT: "Sipariş Ödemesi",
  REFUND: "İade",
  ADJUSTMENT: "Düzeltme",
  // Tedarikçi (SupplierLedgerType) — TOPUP/ADJUSTMENT yukarıda paylaşımlı
  MANUAL_SET: "Manuel Bakiye",
  ORDER_PURCHASE: "Sipariş Alımı",
  ORDER_REFUND: "Sipariş İadesi",
};

export function ledgerTypeLabel(type: string): string {
  return LEDGER_TYPE_LABELS[type] ?? type;
}

// ── Arama ────────────────────────────────────────────────────────────────────

export async function searchSuppliers(q: string): Promise<SupplierOption[]> {
  return apiFetch(`/admin/muhasebe/search/suppliers${buildQs({ q })}`);
}

export async function searchCustomers(q: string): Promise<CustomerOption[]> {
  return apiFetch(`/admin/muhasebe/search/customers${buildQs({ q })}`);
}

// ── Faz 3: Birleşik cari hareket dökümü ──────────────────────────────────────

export async function fetchLedger(query: LedgerQuery): Promise<LedgerResult> {
  const qs = buildQs({
    type: query.type,
    id: query.id,
    from: query.from,
    to: query.to,
    page: query.page,
    pageSize: query.pageSize,
  });
  return apiFetch(`/admin/muhasebe/ledger${qs}`);
}

export async function downloadLedger(query: {
  type: LedgerType;
  id: string;
  from?: string;
  to?: string;
}): Promise<void> {
  const qs = buildQs({
    type: query.type,
    id: query.id,
    from: query.from,
    to: query.to,
  });
  await downloadXlsx(`${API_BASE}/admin/muhasebe/ledger/export${qs}`);
}

// ── Faz 4: Tedarikçi hesabı ──────────────────────────────────────────────────

export async function fetchSupplierAccount(
  supplierId: string,
  range: DateRange,
): Promise<SupplierAccountReport> {
  const qs = buildQs({ supplierId, from: range.from, to: range.to });
  return apiFetch(`/admin/muhasebe/tedarikci-hesap${qs}`);
}

export async function downloadSupplierAccount(
  supplierId: string,
  range: DateRange,
): Promise<void> {
  const qs = buildQs({ supplierId, from: range.from, to: range.to });
  await downloadXlsx(`${API_BASE}/admin/muhasebe/tedarikci-hesap/export${qs}`);
}

// ── Faz 5: Bayi hesabı ───────────────────────────────────────────────────────

export async function fetchDealerAccount(
  customerId: string,
  range: DateRange,
): Promise<DealerAccountReport> {
  const qs = buildQs({ customerId, from: range.from, to: range.to });
  return apiFetch(`/admin/muhasebe/bayi-hesap${qs}`);
}

export async function downloadDealerAccount(
  customerId: string,
  range: DateRange,
): Promise<void> {
  const qs = buildQs({ customerId, from: range.from, to: range.to });
  await downloadXlsx(`${API_BASE}/admin/muhasebe/bayi-hesap/export${qs}`);
}

// ── Yetkili xlsx blob indirme ─────────────────────────────────────────────────
//
// Düz `<a href>` çalışmaz: export uçları Bearer token + Accept header ister.
// Bu yüzden fetch ile indirip blob'u object URL üzerinden tetikliyoruz.
// İndirme sırasında oturum süresi dolarsa apiFetch'in 401 akışına benzer
// şekilde hata fırlatır; çağıran taraf kullanıcıya gösterir.

function parseFilename(
  contentDisposition: string | null,
  fallback: string,
): string {
  if (!contentDisposition) return fallback;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition);
  if (utf8?.[1]) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      // ignore, düz filename'e düş
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(contentDisposition);
  return plain?.[1] ?? fallback;
}

async function downloadXlsx(url: string): Promise<void> {
  const token = getToken();
  const headers = new Headers();
  headers.set("Accept", XLSX_ACCEPT);
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(url, { headers, credentials: "include" });
  if (!response.ok) {
    let message = `Excel indirilemedi (HTTP ${response.status})`;
    try {
      const data = (await response.json()) as { message?: string };
      if (data?.message) message = data.message;
    } catch {
      // gövde xlsx/binary olabilir; varsayılan mesajda kal
    }
    throw new Error(message);
  }

  const blob = await response.blob();
  const filename = parseFilename(
    response.headers.get("Content-Disposition"),
    "muhasebe.xlsx",
  );
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}
