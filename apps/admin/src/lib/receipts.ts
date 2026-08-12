import { apiFetch } from "./auth";

/**
 * Admin "Makbuzlar" sayfası — kredi kartı tahsilat makbuzları.
 *
 * Makbuz YALNIZCA kartlı işlemlerde üretilir: sipariş makbuzu ('order') ve cari
 * yükleme makbuzu ('cari_topup'). Liste filtreli + sayfalı gelir; PDF her satır
 * için ayrı `/:id/pdf` endpoint'inden imzalı URL olarak istenir (admin paneli
 * Bearer JWT ile çalıştığından `<a href>` linki auth taşımaz → window.open).
 */

export type ReceiptKind = "order" | "cari_topup";

export interface AdminReceipt {
  id: string;
  humanReceiptNo: string;
  kind: ReceiptKind;
  amount: number;
  bayiAdi: string;
  bayiId: string;
  customerId: string;
  kartSahibi: string;
  aciklama: string;
  durum: string;
  posProviderKey: string | null;
  issuedAt: string;
  humanOrderNo: string | null;
  humanTopupNo: string | null;
  hasPdf: boolean;
}

export interface ReceiptDealerOption {
  customerId: string;
  bayiNo: string | null;
  bayiAdi: string;
}

export interface ReceiptListMeta {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ReceiptListResult {
  items: AdminReceipt[];
  meta: ReceiptListMeta;
}

export interface ReceiptListFilters {
  from?: string; // ISO tarih (gün başı)
  to?: string; // ISO tarih (gün sonu)
  customerId?: string;
  kind?: ReceiptKind;
  page?: number;
  pageSize?: number;
}

interface RawReceipt {
  id?: string | null;
  humanReceiptNo?: string | null;
  kind?: string | null;
  amount?: number | string | null;
  bayiAdi?: string | null;
  bayiId?: string | null;
  customerId?: string | null;
  kartSahibi?: string | null;
  aciklama?: string | null;
  durum?: string | null;
  posProviderKey?: string | null;
  issuedAt?: string | null;
  humanOrderNo?: string | null;
  humanTopupNo?: string | null;
  hasPdf?: boolean | null;
}

interface RawMeta {
  total?: number | null;
  page?: number | null;
  pageSize?: number | null;
  totalPages?: number | null;
}

interface RawListEnvelope {
  success?: boolean;
  data?: RawReceipt[] | null;
  meta?: RawMeta | null;
}

interface RawDealer {
  customerId?: string | null;
  bayiNo?: string | null;
  bayiAdi?: string | null;
}

interface RawDealersEnvelope {
  success?: boolean;
  data?: RawDealer[] | null;
}

interface RawPdfEnvelope {
  success?: boolean;
  data?: { url?: string | null } | null;
}

function mapReceipt(raw: RawReceipt): AdminReceipt {
  const amount =
    typeof raw.amount === "number" ? raw.amount : Number(raw.amount ?? 0);
  return {
    id: raw.id ?? "",
    humanReceiptNo: raw.humanReceiptNo ?? "",
    kind: raw.kind === "cari_topup" ? "cari_topup" : "order",
    amount: Number.isFinite(amount) ? amount : 0,
    bayiAdi: raw.bayiAdi ?? "",
    bayiId: raw.bayiId ?? "",
    customerId: raw.customerId ?? "",
    kartSahibi: raw.kartSahibi ?? "",
    aciklama: raw.aciklama ?? "",
    durum: raw.durum ?? "",
    posProviderKey: raw.posProviderKey ?? null,
    issuedAt: raw.issuedAt ?? "",
    humanOrderNo: raw.humanOrderNo ?? null,
    humanTopupNo: raw.humanTopupNo ?? null,
    hasPdf: raw.hasPdf ?? false,
  };
}

function buildQuery(filters: ReceiptListFilters): string {
  const params = new URLSearchParams();
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.customerId) params.set("customerId", filters.customerId);
  if (filters.kind) params.set("kind", filters.kind);
  if (filters.page) params.set("page", String(filters.page));
  if (filters.pageSize) params.set("pageSize", String(filters.pageSize));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export async function fetchReceipts(
  filters: ReceiptListFilters,
): Promise<ReceiptListResult> {
  const raw = await apiFetch<RawListEnvelope>(
    `/admin/receipts${buildQuery(filters)}`,
  );
  const items = Array.isArray(raw.data) ? raw.data.map(mapReceipt) : [];
  const pageSize = raw.meta?.pageSize ?? filters.pageSize ?? 50;
  const total = raw.meta?.total ?? items.length;
  return {
    items,
    meta: {
      total,
      page: raw.meta?.page ?? filters.page ?? 1,
      pageSize,
      totalPages:
        raw.meta?.totalPages ?? Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}

export async function fetchReceiptDealers(): Promise<ReceiptDealerOption[]> {
  const raw = await apiFetch<RawDealersEnvelope>("/admin/receipts/dealers");
  if (!Array.isArray(raw.data)) return [];
  return raw.data.map((d) => ({
    customerId: d.customerId ?? "",
    bayiNo: d.bayiNo ?? null,
    bayiAdi: d.bayiAdi ?? "",
  }));
}

/** Makbuzun imzalı PDF URL'ini (lazy üretim) döner. */
export async function fetchReceiptPdfUrl(id: string): Promise<string> {
  const raw = await apiFetch<RawPdfEnvelope>(
    `/admin/receipts/${encodeURIComponent(id)}/pdf`,
  );
  const url = raw.data?.url;
  if (!url) throw new Error("Makbuz PDF'i üretilemedi");
  return url;
}
