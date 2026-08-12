import { apiFetch } from "./auth";

/**
 * Admin "Cari Hareketler" (Cari Ledger) unified akışı.
 *
 * Backend: GET /admin/cari-ledger
 *
 * Bu endpoint hem CariLedger (gerçek finansal hareketler) hem de CariTopup
 * (bekleyen/reddedilen yükleme talepleri) kayıtlarını tek bir akışta
 * birleştirir. PENDING ve REJECTED kayıtlar synthetic olarak gelir; bu
 * durumlarda `balanceAfter` null'dur.
 */

export type CariLedgerEntryType =
  | "TOPUP"
  | "ORDER_PAYMENT"
  | "REFUND"
  | "ADJUSTMENT";

export type CariTopupStatus = "PENDING" | "APPROVED" | "REJECTED";

export type CariLedgerTypeFilter = CariLedgerEntryType | "ALL";

export const CARI_LEDGER_TYPE_FILTERS = [
  "ALL",
  "TOPUP",
  "ADJUSTMENT",
  "ORDER_PAYMENT",
  "REFUND",
] as const;

export const CARI_LEDGER_TYPE_FILTER_LABELS: Record<
  CariLedgerTypeFilter,
  string
> = {
  ALL: "Tümü",
  TOPUP: "Yükleme",
  ADJUSTMENT: "Manuel Düzeltme",
  ORDER_PAYMENT: "Sipariş Ödemesi",
  REFUND: "İade",
};

export const CARI_LEDGER_TYPE_LABELS: Record<CariLedgerEntryType, string> = {
  TOPUP: "Yükleme",
  ORDER_PAYMENT: "Sipariş Ödemesi",
  REFUND: "İade",
  ADJUSTMENT: "Manuel Düzeltme",
};

export type CariLedgerStatusFilter = CariTopupStatus | "ALL";

export const CARI_LEDGER_STATUS_FILTERS = [
  "ALL",
  "PENDING",
  "APPROVED",
  "REJECTED",
] as const;

export const CARI_LEDGER_STATUS_FILTER_LABELS: Record<
  CariLedgerStatusFilter,
  string
> = {
  ALL: "Tümü",
  PENDING: "Bekleyen",
  APPROVED: "Onaylanan",
  REJECTED: "Reddedilen",
};

export interface AdminLedgerCustomer {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  cariBalance: number;
}

export interface AdminLedgerBank {
  id: string;
  bankName: string;
  iban: string;
}

/** Yükleme türü — havale/EFT (admin onaylı) ya da kredi kartı (otomatik). */
export type CariTopupMethod = "bank_transfer" | "card";

/** Sipariş ödeme tipi — cari bakiyeden ('cari') ya da kredi kartı/POS ('card'). */
export type CariOrderPaymentType = "cari" | "card";

export interface AdminLedgerEntry {
  id: string;
  type: CariLedgerEntryType;
  amount: number;
  balanceAfter: number | null;
  description: string | null;
  createdAt: string;
  orderId: string | null;
  humanOrderNo: string | null;
  /**
   * Sipariş bağlı satırlarda (ORDER_PAYMENT/REFUND) siparişin ödeme tipi.
   * 'card' → "Kredi Kartı", 'cari' → "Cari Bakiye". Sipariş yoksa null.
   */
  orderPaymentType: CariOrderPaymentType | null;
  topupId: string | null;
  humanTopupNo: string | null;
  topupStatus: CariTopupStatus | null;
  /** Sadece TOPUP kayıtlarında anlamlı — 'card' ise kartla yükleme. */
  topupMethod: CariTopupMethod | null;
  /** Kartlı yüklemede müşteriye yansıtılan komisyon (₺) — yoksa null. */
  topupCommissionAmount: number | null;
  /** Kartlı yüklemede karttan çekilen toplam (= amount + komisyon) — yoksa null. */
  topupChargedAmount: number | null;
  customerNote: string | null;
  adminNote: string | null;
  decidedAt: string | null;
  customer: AdminLedgerCustomer | null;
  bankAccount: AdminLedgerBank | null;
}

export interface AdminLedgerResponse {
  data: AdminLedgerEntry[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

interface RawLedgerCustomer {
  id: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  cariBalance?: number | string | null;
}

interface RawLedgerBank {
  id: string;
  bankName?: string | null;
  iban?: string | null;
}

interface RawLedgerEntry {
  id: string;
  type?: string | null;
  amount?: number | string | null;
  balanceAfter?: number | string | null;
  description?: string | null;
  createdAt?: string | null;
  orderId?: string | null;
  humanOrderNo?: string | null;
  orderPaymentType?: string | null;
  topupId?: string | null;
  humanTopupNo?: string | null;
  topupStatus?: string | null;
  // Backend topup yöntemini `topupMethod` ya da `method` anahtarıyla
  // gönderebilir — ikisi de kabul edilir.
  topupMethod?: string | null;
  method?: string | null;
  topupCommissionAmount?: number | string | null;
  commissionAmount?: number | string | null;
  topupChargedAmount?: number | string | null;
  chargedAmount?: number | string | null;
  customerNote?: string | null;
  adminNote?: string | null;
  decidedAt?: string | null;
  customer?: RawLedgerCustomer | null;
  bankAccount?: RawLedgerBank | null;
}

interface RawListEnvelope {
  success?: boolean;
  data?: RawLedgerEntry[] | null;
  meta?: {
    total?: number;
    page?: number;
    pageSize?: number;
    limit?: number;
    totalPages?: number;
  };
}

function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toNullableNumber(
  value: number | string | null | undefined,
): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const TYPE_SET = new Set<CariLedgerEntryType>([
  "TOPUP",
  "ORDER_PAYMENT",
  "REFUND",
  "ADJUSTMENT",
]);

function toType(value: string | null | undefined): CariLedgerEntryType {
  if (value && TYPE_SET.has(value as CariLedgerEntryType)) {
    return value as CariLedgerEntryType;
  }
  return "ADJUSTMENT";
}

function toStatus(
  value: string | null | undefined,
): CariTopupStatus | null {
  if (value === "PENDING" || value === "APPROVED" || value === "REJECTED") {
    return value;
  }
  return null;
}

function toMethod(
  value: string | null | undefined,
): CariTopupMethod | null {
  if (value === "card" || value === "bank_transfer") return value;
  return null;
}

function toOrderPaymentType(
  value: string | null | undefined,
): CariOrderPaymentType | null {
  if (value === "cari" || value === "card") return value;
  return null;
}

function mapCustomer(
  raw: RawLedgerCustomer | null | undefined,
): AdminLedgerCustomer | null {
  if (!raw) return null;
  return {
    id: raw.id,
    name: raw.name ?? null,
    email: raw.email ?? null,
    phone: raw.phone ?? null,
    cariBalance: toNumber(raw.cariBalance),
  };
}

function mapBank(
  raw: RawLedgerBank | null | undefined,
): AdminLedgerBank | null {
  if (!raw) return null;
  return {
    id: raw.id,
    bankName: raw.bankName ?? "",
    iban: raw.iban ?? "",
  };
}

function mapEntry(raw: RawLedgerEntry): AdminLedgerEntry {
  return {
    id: raw.id,
    type: toType(raw.type),
    amount: toNumber(raw.amount),
    balanceAfter: toNullableNumber(raw.balanceAfter),
    description: raw.description ?? null,
    createdAt: raw.createdAt ?? new Date().toISOString(),
    orderId: raw.orderId ?? null,
    humanOrderNo: raw.humanOrderNo ?? null,
    orderPaymentType: toOrderPaymentType(raw.orderPaymentType),
    topupId: raw.topupId ?? null,
    humanTopupNo: raw.humanTopupNo ?? null,
    topupStatus: toStatus(raw.topupStatus),
    topupMethod: toMethod(raw.topupMethod ?? raw.method),
    topupCommissionAmount: toNullableNumber(
      raw.topupCommissionAmount ?? raw.commissionAmount,
    ),
    topupChargedAmount: toNullableNumber(
      raw.topupChargedAmount ?? raw.chargedAmount,
    ),
    customerNote: raw.customerNote ?? null,
    adminNote: raw.adminNote ?? null,
    decidedAt: raw.decidedAt ?? null,
    customer: mapCustomer(raw.customer),
    bankAccount: mapBank(raw.bankAccount),
  };
}

export interface FetchAdminLedgerParams {
  type?: CariLedgerTypeFilter;
  status?: CariLedgerStatusFilter;
  page?: number;
  pageSize?: number;
}

export async function fetchAdminCariLedger(
  params: FetchAdminLedgerParams = {},
): Promise<AdminLedgerResponse> {
  const qs = new URLSearchParams();
  if (params.type && params.type !== "ALL") qs.set("type", params.type);
  if (params.status && params.status !== "ALL") qs.set("status", params.status);
  if (params.page && params.page > 1) qs.set("page", String(params.page));
  if (params.pageSize && params.pageSize !== 50) {
    qs.set("pageSize", String(params.pageSize));
  }

  const query = qs.toString();
  const raw = await apiFetch<unknown>(
    `/admin/cari-ledger${query ? `?${query}` : ""}`,
  );

  if (raw && typeof raw === "object" && "data" in (raw as object)) {
    const env = raw as RawListEnvelope;
    const list = Array.isArray(env.data) ? env.data.map(mapEntry) : [];
    const meta = env.meta ?? {};
    return {
      data: list,
      meta: {
        total: meta.total ?? list.length,
        page: meta.page ?? 1,
        pageSize: meta.pageSize ?? meta.limit ?? list.length,
        totalPages: meta.totalPages ?? 1,
      },
    };
  }

  if (Array.isArray(raw)) {
    const list = (raw as RawLedgerEntry[]).map(mapEntry);
    return {
      data: list,
      meta: {
        total: list.length,
        page: 1,
        pageSize: list.length,
        totalPages: 1,
      },
    };
  }

  return {
    data: [],
    meta: { total: 0, page: 1, pageSize: 0, totalPages: 1 },
  };
}

export function formatLedgerDate(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("tr-TR");
  } catch {
    return String(value);
  }
}

const TRY_FORMATTER = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatTRY(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return TRY_FORMATTER.format(value);
}

/**
 * İşaretli TL biçimi: +1.234,56 ₺ / -1.234,56 ₺
 * Sıfır için "0,00 ₺" döner.
 */
export function formatSignedTRY(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const formatted = TRY_FORMATTER.format(abs);
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `−${formatted}`;
  return formatted;
}
