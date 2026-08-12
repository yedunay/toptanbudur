import { apiFetch } from "./auth";

/**
 * Cari bakiye yüklemeleri (top-up).
 * Müşteri bakiyesine para yüklemek için talep oluşturur.
 * Admin onaylar -> bakiye artar + ledger TOPUP kaydı.
 * Admin reddeder -> sadece status değişir, bakiye dokunulmaz.
 */

export type AdminCariTopupStatus = "PENDING" | "APPROVED" | "REJECTED";

export type AdminCariTopupFilter = AdminCariTopupStatus | "ALL";

export const ADMIN_CARI_TOPUP_FILTERS = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "ALL",
] as const;

export const ADMIN_CARI_TOPUP_FILTER_LABELS: Record<AdminCariTopupFilter, string> = {
  PENDING: "Bekleyen",
  APPROVED: "Onaylanan",
  REJECTED: "Reddedilen",
  ALL: "Tümü",
};

export const ADMIN_CARI_TOPUP_STATUS_LABELS: Record<AdminCariTopupStatus, string> = {
  PENDING: "Beklemede",
  APPROVED: "Onaylandı",
  REJECTED: "Reddedildi",
};

export interface AdminCariTopupCustomer {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  cariBalance: number;
}

export interface AdminCariTopupBank {
  id: string;
  bankName: string;
  iban: string;
}

/** Yükleme türü — havale/EFT (admin onaylı) ya da kredi kartı (otomatik). */
export type AdminCariTopupMethod = "bank_transfer" | "card";

export interface AdminCariTopup {
  id: string;
  humanTopupNo: string | null;
  amount: number;
  /** 'card' → kartla anında yükleme; aksi halde havale/EFT talebi. */
  method: AdminCariTopupMethod;
  /** Kartlı yüklemede müşteriye yansıtılan komisyon (₺) — havalede null. */
  commissionAmount: number | null;
  /** Kartlı yüklemede karttan çekilen toplam (= amount + komisyon) — havalede null. */
  chargedAmount: number | null;
  status: AdminCariTopupStatus;
  customerNote: string | null;
  adminNote: string | null;
  requestedAt: string;
  decidedAt: string | null;
  customer: AdminCariTopupCustomer | null;
  bankAccount: AdminCariTopupBank | null;
}

interface RawTopupCustomer {
  id: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  cariBalance?: number | string | null;
}

interface RawTopupBank {
  id: string;
  bankName?: string | null;
  iban?: string | null;
}

interface RawTopup {
  id: string;
  humanTopupNo?: string | null;
  amount?: number | string | null;
  method?: string | null;
  commissionAmount?: number | string | null;
  chargedAmount?: number | string | null;
  status?: string | null;
  customerNote?: string | null;
  adminNote?: string | null;
  requestedAt?: string | null;
  decidedAt?: string | null;
  customer?: RawTopupCustomer | null;
  bankAccount?: RawTopupBank | null;
}

interface RawListEnvelope {
  success?: boolean;
  data?: RawTopup[] | null;
  meta?: {
    total?: number;
    page?: number;
    pageSize?: number;
    limit?: number;
    totalPages?: number;
  };
}

export interface AdminCariTopupsResponse {
  data: AdminCariTopup[];
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

function toStatus(value: string | null | undefined): AdminCariTopupStatus {
  if (value === "APPROVED" || value === "REJECTED") return value;
  return "PENDING";
}

function toNullableNumber(
  value: number | string | null | undefined,
): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toMethod(value: string | null | undefined): AdminCariTopupMethod {
  // DB varsayılanı 'bank_transfer' — bilinmeyen/eksik değerde havale kabul et.
  return value === "card" ? "card" : "bank_transfer";
}

function mapCustomer(raw: RawTopupCustomer | null | undefined): AdminCariTopupCustomer | null {
  if (!raw) return null;
  return {
    id: raw.id,
    name: raw.name ?? null,
    email: raw.email ?? null,
    phone: raw.phone ?? null,
    cariBalance: toNumber(raw.cariBalance),
  };
}

function mapBank(raw: RawTopupBank | null | undefined): AdminCariTopupBank | null {
  if (!raw) return null;
  return {
    id: raw.id,
    bankName: raw.bankName ?? "",
    iban: raw.iban ?? "",
  };
}

function mapTopup(raw: RawTopup): AdminCariTopup {
  return {
    id: raw.id,
    humanTopupNo: raw.humanTopupNo ?? null,
    amount: toNumber(raw.amount),
    method: toMethod(raw.method),
    commissionAmount: toNullableNumber(raw.commissionAmount),
    chargedAmount: toNullableNumber(raw.chargedAmount),
    status: toStatus(raw.status),
    customerNote: raw.customerNote ?? null,
    adminNote: raw.adminNote ?? null,
    requestedAt: raw.requestedAt ?? new Date().toISOString(),
    decidedAt: raw.decidedAt ?? null,
    customer: mapCustomer(raw.customer),
    bankAccount: mapBank(raw.bankAccount),
  };
}

export async function fetchAdminCariTopups(
  filter: AdminCariTopupFilter = "PENDING",
  page = 1,
  pageSize = 20,
): Promise<AdminCariTopupsResponse> {
  const params = new URLSearchParams();
  if (filter !== "ALL") params.set("status", filter);
  if (page > 1) params.set("page", String(page));
  if (pageSize !== 20) params.set("pageSize", String(pageSize));
  const qs = params.toString();
  const raw = await apiFetch<unknown>(
    `/admin/cari-topups${qs ? `?${qs}` : ""}`,
  );

  if (raw && typeof raw === "object" && "data" in (raw as object)) {
    const env = raw as RawListEnvelope;
    const list = Array.isArray(env.data) ? env.data.map(mapTopup) : [];
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
    const list = (raw as RawTopup[]).map(mapTopup);
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

/**
 * Admin nav badge için: bekleyen (PENDING) cari yükleme talepleri sayısı.
 */
export async function fetchPendingCariTopupsCount(): Promise<number> {
  try {
    const params = new URLSearchParams();
    params.set("status", "PENDING");
    params.set("pageSize", "1");
    const raw = await apiFetch<unknown>(
      `/admin/cari-topups?${params.toString()}`,
    );
    if (raw && typeof raw === "object" && "meta" in (raw as object)) {
      const meta = (raw as { meta?: { total?: number } }).meta;
      return typeof meta?.total === "number" ? meta.total : 0;
    }
    return 0;
  } catch {
    return 0;
  }
}

export type AdminTopupDecision = "approved" | "rejected";

export interface AdminTopupDecisionResult {
  id: string;
  humanTopupNo: string | null;
  status: AdminCariTopupStatus;
  decidedAt: string | null;
  adminNote: string | null;
  amount: number;
  newBalance: number | null;
  ledgerId: string | null;
}

interface RawDecisionData {
  id: string;
  humanTopupNo?: string | null;
  status?: string | null;
  decidedAt?: string | null;
  adminNote?: string | null;
  amount?: number | string | null;
  newBalance?: number | string | null;
  ledgerId?: string | null;
}

export async function decideAdminCariTopup(
  id: string,
  decision: AdminTopupDecision,
  adminNote?: string,
): Promise<AdminTopupDecisionResult> {
  const trimmed = adminNote?.trim();
  const raw = await apiFetch<unknown>(`/admin/cari-topups/${id}`, {
    method: "PATCH",
    body: JSON.stringify({
      decision,
      ...(trimmed && trimmed.length > 0 ? { adminNote: trimmed } : {}),
    }),
  });

  let body: RawDecisionData;
  if (raw && typeof raw === "object" && "data" in (raw as object)) {
    body = (raw as { data: RawDecisionData }).data;
  } else {
    body = raw as RawDecisionData;
  }

  return {
    id: body.id,
    humanTopupNo: body.humanTopupNo ?? null,
    status: toStatus(body.status),
    decidedAt: body.decidedAt ?? null,
    adminNote: body.adminNote ?? null,
    amount: toNumber(body.amount),
    newBalance:
      body.newBalance === null || body.newBalance === undefined
        ? null
        : toNumber(body.newBalance),
    ledgerId: body.ledgerId ?? null,
  };
}

export function formatAdminCariTopupDate(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("tr-TR");
  } catch {
    return String(value);
  }
}
