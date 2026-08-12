import { apiFetch } from "./auth";

/**
 * Cari (B2B bayi) tarafından yapılan banka havalesi/EFT ödemeleri.
 * Bayi ödemeyi yaptığını sisteme bildirir, admin manuel olarak onaylar/reddeder.
 */

export type CariPaymentStatus = "pending" | "approved" | "rejected";

export type CariPaymentFilter = CariPaymentStatus | "all";

export const CARI_PAYMENT_FILTERS = [
  "pending",
  "approved",
  "rejected",
  "all",
] as const;

export const CARI_PAYMENT_FILTER_LABELS: Record<CariPaymentFilter, string> = {
  pending: "Bekleyen",
  approved: "Onaylanan",
  rejected: "Reddedilen",
  all: "Tümü",
};

export const CARI_PAYMENT_STATUS_LABELS: Record<CariPaymentStatus, string> = {
  pending: "Beklemede",
  approved: "Onaylandı",
  rejected: "Reddedildi",
};

export interface CariPayment {
  id: string;
  orderId?: string | null;
  orderNumber?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  /** Bayinin/müşterinin bildirdiği tutar. */
  amount: number;
  /** Banka havalesi açıklaması/dekont referansı. */
  reference?: string | null;
  note?: string | null;
  /** Talep tarihi — bayinin bildirim yaptığı an. */
  requestedAt: string;
  decidedAt?: string | null;
  decidedBy?: string | null;
  status: CariPaymentStatus;
}

interface RawCariPayment {
  id: string;
  orderId?: string | null;
  orderNumber?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  amount?: number | string | null;
  reference?: string | null;
  note?: string | null;
  requestedAt?: string | null;
  createdAt?: string | null;
  decidedAt?: string | null;
  decidedBy?: string | null;
  status?: string | null;
}

interface RawListEnvelope {
  success?: boolean;
  data?: RawCariPayment[] | null;
  meta?: {
    total?: number;
    page?: number;
    pageSize?: number;
    limit?: number;
    totalPages?: number;
  };
}

export interface CariPaymentsResponse {
  data: CariPayment[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toStatus(value: string | null | undefined): CariPaymentStatus {
  if (value === "approved" || value === "rejected") return value;
  return "pending";
}

function mapCariPayment(raw: RawCariPayment): CariPayment {
  return {
    id: raw.id,
    orderId: raw.orderId ?? null,
    orderNumber: raw.orderNumber ?? null,
    customerName: raw.customerName ?? null,
    customerEmail: raw.customerEmail ?? null,
    amount: toNumber(raw.amount),
    reference: raw.reference ?? null,
    note: raw.note ?? null,
    requestedAt: raw.requestedAt ?? raw.createdAt ?? new Date().toISOString(),
    decidedAt: raw.decidedAt ?? null,
    decidedBy: raw.decidedBy ?? null,
    status: toStatus(raw.status),
  };
}

export async function fetchCariPayments(
  filter: CariPaymentFilter = "pending",
): Promise<CariPaymentsResponse> {
  const params = new URLSearchParams();
  if (filter !== "all") params.set("status", filter);
  const qs = params.toString();
  const raw = await apiFetch<unknown>(
    `/admin/cari-payments${qs ? `?${qs}` : ""}`,
  );

  if (Array.isArray(raw)) {
    const list = (raw as RawCariPayment[]).map(mapCariPayment);
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

  if (raw && typeof raw === "object" && "data" in (raw as object)) {
    const env = raw as RawListEnvelope;
    const list = Array.isArray(env.data) ? env.data.map(mapCariPayment) : [];
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

  return {
    data: [],
    meta: { total: 0, page: 1, pageSize: 0, totalPages: 1 },
  };
}

export type CariPaymentDecision = "approve" | "reject";

export async function decideCariPayment(
  id: string,
  decision: CariPaymentDecision,
  note?: string,
): Promise<CariPayment> {
  const trimmedNote = note?.trim();
  const raw = await apiFetch<unknown>(`/admin/cari-payments/${id}`, {
    method: "PATCH",
    body: JSON.stringify({
      decision,
      ...(trimmedNote && trimmedNote.length > 0 ? { note: trimmedNote } : {}),
    }),
  });
  if (raw && typeof raw === "object" && "data" in (raw as object)) {
    const env = raw as { data: RawCariPayment };
    return mapCariPayment(env.data);
  }
  return mapCariPayment(raw as RawCariPayment);
}

export function formatCariPaymentDate(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("tr-TR");
  } catch {
    return String(value);
  }
}
