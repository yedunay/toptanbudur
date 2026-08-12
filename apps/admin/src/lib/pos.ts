import { apiFetch } from "./auth";

/**
 * Sanal POS sağlayıcıları — admin "POS" sayfası.
 *
 * Aynı anda tek sağlayıcı aktiftir; kartlı tahsilatlar aktif sağlayıcı
 * üzerinden çekilir. İstatistikler PaymentTransaction(success) eşleşmesinden
 * gelir. PayTR rapor araçları yalnızca görüntülemedir.
 */

export interface PosProviderStats {
  orderCount: number;
  totalAmount: string; // Decimal — string taşınır, UI formatlar
  lastPaymentAt: string | null;
}

export interface PosProvider {
  id: string;
  key: string;
  name: string;
  description: string | null;
  active: boolean;
  commissionRate: string | null; // Decimal — "2.49" gibi string taşınır (gerçek/POS kesintisi)
  /** Sitede müşteriye yansıtılan kart komisyonu (%) — Decimal string. */
  customerCommissionRate: string | null;
  valorDays: number | null;
  testMode: boolean;
  noInstallment: boolean;
  maxInstallment: number;
  createdAt: string;
  updatedAt: string;
  stats: PosProviderStats;
}

export interface PosProviderInput {
  key: string;
  name: string;
  description?: string;
}

export interface PosProviderUpdateInput {
  name?: string;
  description?: string;
  commissionRate?: number | null;
  customerCommissionRate?: number | null;
  valorDays?: number | null;
  testMode?: boolean;
  noInstallment?: boolean;
  maxInstallment?: number;
}

export interface PosDetailStats extends PosProviderStats {
  monthOrderCount: number;
  monthTotalAmount: string;
}

export interface PosTransactionOrder {
  id: string;
  humanOrderNo: string | null;
  customerName: string | null;
}

export interface PosTransactionTopup {
  id: string;
  humanTopupNo: string | null;
  customerName: string | null;
}

export interface PosTransaction {
  id: string;
  merchantOid: string;
  status: string;
  amount: string;
  totalAmount: string | null;
  currency: string | null;
  paymentType: string | null;
  failedReasonCode: string | null;
  failedReasonMsg: string | null;
  testMode: boolean;
  callbackAt: string | null;
  order: PosTransactionOrder | null;
  topup: PosTransactionTopup | null;
}

/**
 * Maskeli önizlemeler ("1234••••89") — düz değer asla dönmez. Sağlayıcıya göre
 * farklı alanlar dolu gelir (PayTR: merchant*, TOSLA: clientId/apiUser/apiPass).
 */
export interface PosCredentials {
  merchantId?: string | null;
  merchantKey?: string | null;
  merchantSalt?: string | null;
  clientId?: string | null;
  apiUser?: string | null;
  apiPass?: string | null;
}

export interface PosDetail {
  provider: PosProvider;
  stats: PosDetailStats;
  recentTransactions: PosTransaction[];
  credentials: PosCredentials | null;
}

interface RawStats {
  orderCount?: number | null;
  totalAmount?: string | number | null;
  lastPaymentAt?: string | null;
  monthOrderCount?: number | null;
  monthTotalAmount?: string | number | null;
}

interface RawPosProvider {
  id: string;
  key?: string | null;
  name?: string | null;
  description?: string | null;
  active?: boolean | null;
  commissionRate?: string | number | null;
  customerCommissionRate?: string | number | null;
  valorDays?: number | null;
  testMode?: boolean | null;
  noInstallment?: boolean | null;
  maxInstallment?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  stats?: RawStats | null;
}

interface RawTransactionOrder {
  id?: string | null;
  humanOrderNo?: string | null;
  customerName?: string | null;
}

interface RawTransactionTopup {
  id?: string | null;
  humanTopupNo?: string | null;
  customer?: { name?: string | null } | null;
}

interface RawTransaction {
  id?: string | null;
  merchantOid?: string | null;
  status?: string | null;
  amount?: string | number | null;
  totalAmount?: string | number | null;
  currency?: string | null;
  paymentType?: string | null;
  failedReasonCode?: string | null;
  failedReasonMsg?: string | null;
  testMode?: boolean | null;
  callbackAt?: string | null;
  order?: RawTransactionOrder | null;
  topup?: RawTransactionTopup | null;
}

interface RawCredentials {
  merchantId?: string | null;
  merchantKey?: string | null;
  merchantSalt?: string | null;
  clientId?: string | null;
  apiUser?: string | null;
  apiPass?: string | null;
}

interface RawDetail {
  provider?: RawPosProvider | null;
  stats?: RawStats | null;
  recentTransactions?: RawTransaction[] | null;
  credentials?: RawCredentials | null;
}

interface RawListEnvelope {
  success?: boolean;
  data?: RawPosProvider[] | null;
}

interface RawSingleEnvelope {
  success?: boolean;
  data?: RawPosProvider | null;
}

interface RawDetailEnvelope {
  success?: boolean;
  data?: RawDetail | null;
}

function mapProvider(raw: RawPosProvider): PosProvider {
  return {
    id: raw.id,
    key: raw.key ?? "",
    name: raw.name ?? "",
    description: raw.description ?? null,
    active: raw.active ?? false,
    commissionRate:
      raw.commissionRate === null || raw.commissionRate === undefined
        ? null
        : String(raw.commissionRate),
    customerCommissionRate:
      raw.customerCommissionRate === null || raw.customerCommissionRate === undefined
        ? null
        : String(raw.customerCommissionRate),
    valorDays: typeof raw.valorDays === "number" ? raw.valorDays : null,
    testMode: raw.testMode ?? false,
    noInstallment: raw.noInstallment ?? false,
    maxInstallment: typeof raw.maxInstallment === "number" ? raw.maxInstallment : 0,
    createdAt: raw.createdAt ?? new Date().toISOString(),
    updatedAt: raw.updatedAt ?? new Date().toISOString(),
    stats: {
      orderCount: raw.stats?.orderCount ?? 0,
      totalAmount: String(raw.stats?.totalAmount ?? "0"),
      lastPaymentAt: raw.stats?.lastPaymentAt ?? null,
    },
  };
}

function mapTransaction(raw: RawTransaction): PosTransaction {
  return {
    id: raw.id ?? "",
    merchantOid: raw.merchantOid ?? "",
    status: raw.status ?? "",
    amount: String(raw.amount ?? "0"),
    totalAmount:
      raw.totalAmount === null || raw.totalAmount === undefined
        ? null
        : String(raw.totalAmount),
    currency: raw.currency ?? null,
    paymentType: raw.paymentType ?? null,
    failedReasonCode: raw.failedReasonCode ?? null,
    failedReasonMsg: raw.failedReasonMsg ?? null,
    testMode: raw.testMode ?? false,
    callbackAt: raw.callbackAt ?? null,
    order: raw.order
      ? {
          id: raw.order.id ?? "",
          humanOrderNo: raw.order.humanOrderNo ?? null,
          customerName: raw.order.customerName ?? null,
        }
      : null,
    topup: raw.topup
      ? {
          id: raw.topup.id ?? "",
          humanTopupNo: raw.topup.humanTopupNo ?? null,
          customerName: raw.topup.customer?.name ?? null,
        }
      : null,
  };
}

function mapDetail(raw: RawDetail): PosDetail {
  return {
    provider: mapProvider(raw.provider ?? ({ id: "" } as RawPosProvider)),
    stats: {
      orderCount: raw.stats?.orderCount ?? 0,
      totalAmount: String(raw.stats?.totalAmount ?? "0"),
      lastPaymentAt: raw.stats?.lastPaymentAt ?? null,
      monthOrderCount: raw.stats?.monthOrderCount ?? 0,
      monthTotalAmount: String(raw.stats?.monthTotalAmount ?? "0"),
    },
    recentTransactions: Array.isArray(raw.recentTransactions)
      ? raw.recentTransactions.map(mapTransaction)
      : [],
    credentials: raw.credentials
      ? {
          merchantId: raw.credentials.merchantId ?? null,
          merchantKey: raw.credentials.merchantKey ?? null,
          merchantSalt: raw.credentials.merchantSalt ?? null,
          clientId: raw.credentials.clientId ?? null,
          apiUser: raw.credentials.apiUser ?? null,
          apiPass: raw.credentials.apiPass ?? null,
        }
      : null,
  };
}

export async function fetchPosProviders(): Promise<PosProvider[]> {
  const raw = await apiFetch<unknown>("/admin/pos");
  if (Array.isArray(raw)) return (raw as RawPosProvider[]).map(mapProvider);
  if (raw && typeof raw === "object" && "data" in (raw as object)) {
    const env = raw as RawListEnvelope;
    return Array.isArray(env.data) ? env.data.map(mapProvider) : [];
  }
  return [];
}

function unwrapSingle(raw: unknown): PosProvider {
  if (raw && typeof raw === "object" && "data" in (raw as object)) {
    const env = raw as RawSingleEnvelope;
    if (env.data) return mapProvider(env.data);
  }
  return mapProvider(raw as RawPosProvider);
}

export async function fetchPosDetail(key: string): Promise<PosDetail> {
  const raw = await apiFetch<unknown>(
    `/admin/pos/${encodeURIComponent(key)}/detail`,
  );
  if (raw && typeof raw === "object" && "data" in (raw as object)) {
    const env = raw as RawDetailEnvelope;
    if (env.data) return mapDetail(env.data);
  }
  return mapDetail(raw as RawDetail);
}

export async function createPosProvider(input: PosProviderInput): Promise<PosProvider> {
  const raw = await apiFetch<unknown>("/admin/pos", {
    method: "POST",
    body: JSON.stringify({
      key: input.key.trim().toLowerCase(),
      name: input.name.trim(),
      description: input.description?.trim() || undefined,
    }),
  });
  return unwrapSingle(raw);
}

export async function updatePosProvider(
  key: string,
  input: PosProviderUpdateInput,
): Promise<PosProvider> {
  const payload: Record<string, unknown> = {};
  if (input.name !== undefined) payload.name = input.name.trim();
  if (input.description !== undefined) payload.description = input.description.trim();
  if (input.commissionRate !== undefined) payload.commissionRate = input.commissionRate;
  if (input.customerCommissionRate !== undefined) {
    payload.customerCommissionRate = input.customerCommissionRate;
  }
  if (input.valorDays !== undefined) payload.valorDays = input.valorDays;
  if (input.testMode !== undefined) payload.testMode = input.testMode;
  if (input.noInstallment !== undefined) payload.noInstallment = input.noInstallment;
  if (input.maxInstallment !== undefined) payload.maxInstallment = input.maxInstallment;
  const raw = await apiFetch<unknown>(`/admin/pos/${encodeURIComponent(key)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  return unwrapSingle(raw);
}

export async function activatePosProvider(key: string): Promise<PosProvider> {
  const raw = await apiFetch<unknown>(`/admin/pos/${encodeURIComponent(key)}/activate`, {
    method: "POST",
  });
  return unwrapSingle(raw);
}

export async function deactivatePosProvider(key: string): Promise<PosProvider> {
  const raw = await apiFetch<unknown>(`/admin/pos/${encodeURIComponent(key)}/deactivate`, {
    method: "POST",
  });
  return unwrapSingle(raw);
}

export async function deletePosProvider(key: string): Promise<void> {
  await apiFetch<unknown>(`/admin/pos/${encodeURIComponent(key)}`, {
    method: "DELETE",
  });
}

// ─── PayTR rapor araçları (yalnızca okuma) ───────────────────────────────────

function unwrapData(raw: unknown): unknown {
  if (raw && typeof raw === "object" && "data" in (raw as object)) {
    return (raw as { data?: unknown }).data ?? null;
  }
  return raw;
}

/** Durum Sorgu — merchant_oid ile PayTR işlem durumunu çeker. */
export async function paytrStatusQuery(merchantOid: string): Promise<unknown> {
  const raw = await apiFetch<unknown>("/admin/pos/paytr/status-query", {
    method: "POST",
    body: JSON.stringify({ merchantOid: merchantOid.trim() }),
  });
  return unwrapData(raw);
}

/**
 * TOSLA Durum Sorgu (inquiry) — merchantOid (=orderId) ile işlem durumunu
 * çeker. Salt-okuma mutabakat aracıdır; iade/iptal YOK (iade daima cariye).
 */
export async function toslaStatusQuery(merchantOid: string): Promise<unknown> {
  const raw = await apiFetch<unknown>("/admin/pos/tosla/status-query", {
    method: "POST",
    body: JSON.stringify({ merchantOid: merchantOid.trim() }),
  });
  return unwrapData(raw);
}

export interface PosTestPayment {
  provider: string;
  /** Müşterinin gördüğü ödeme ekranının iframe URL'i (PayTR/TOSLA). */
  iframeUrl: string;
  merchantOid: string;
  amount: number;
  testMode: boolean;
}

/**
 * TEST ÇEKİMİ — sağlayıcının (PayTR/TOSLA) müşteriye gösterdiği ödeme ekranının
 * AYNISINI açacak iframe URL'ini üretir. Gerçek sipariş/işlem yaratılmaz.
 */
export async function createPosTestPayment(
  key: string,
  amount: number,
): Promise<PosTestPayment> {
  const raw = await apiFetch<unknown>(
    `/admin/pos/${encodeURIComponent(key)}/test-payment`,
    { method: "POST", body: JSON.stringify({ amount }) },
  );
  return unwrapData(raw) as PosTestPayment;
}

/** Satış/İade işlem dökümü — "YYYY-MM-DD HH:mm:ss", en fazla 3 günlük aralık. */
export async function paytrTransactionReport(
  startDate: string,
  endDate: string,
): Promise<unknown> {
  const raw = await apiFetch<unknown>("/admin/pos/paytr/transaction-report", {
    method: "POST",
    body: JSON.stringify({ startDate, endDate }),
  });
  return unwrapData(raw);
}

/** Ödeme dökümü (valör takibi) — "YYYY-MM-DD", en fazla 31 günlük aralık. */
export async function paytrPaymentReport(
  startDate: string,
  endDate: string,
): Promise<unknown> {
  const raw = await apiFetch<unknown>("/admin/pos/paytr/payment-report", {
    method: "POST",
    body: JSON.stringify({ startDate, endDate }),
  });
  return unwrapData(raw);
}

/** "12345.67" → "12.345,67 ₺" */
export function formatPosAmount(value: string): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return "0,00 ₺";
  return `${num.toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ₺`;
}

/** "2.49" → "%2,49" — tanımsızsa "—" */
export function formatCommission(value: string | null): string {
  if (value === null || value === "") return "—";
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  return `%${num.toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** 1 → "1 gün" — tanımsızsa "—" */
export function formatValor(days: number | null): string {
  if (days === null) return "—";
  return `${days} gün`;
}
