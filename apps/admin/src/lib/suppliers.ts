import { apiFetch } from "./auth";

export type AuthType = "none" | "basic" | "bearer";

/** Satış kanalları — backend MARKETPLACE_VALUES ile birebir aynı. */
export const MARKETPLACES = ["self", "other"] as const;

export type Marketplace = (typeof MARKETPLACES)[number];

export const MARKETPLACE_LABELS: Record<Marketplace, string> = {
  self: "Kendim İçin",
  other: "Diğer Satış Kanalı",
};

export const FEED_CURRENCIES = ["TRY", "USD", "EUR", "GBP"] as const;
export type FeedCurrency = (typeof FEED_CURRENCIES)[number];

export const FEED_CURRENCY_LABELS: Record<FeedCurrency, string> = {
  TRY: "TRY (₺)",
  USD: "USD ($)",
  EUR: "EUR (€)",
  GBP: "GBP (£)",
};

export const MANDATORY_CARRIERS = ["ARAS", "SURAT", "YURTICI"] as const;
export type MandatoryCarrier = (typeof MANDATORY_CARRIERS)[number];

export const MANDATORY_CARRIER_LABELS: Record<MandatoryCarrier, string> = {
  ARAS: "Aras Kargo",
  SURAT: "Sürat Kargo",
  YURTICI: "Yurtiçi Kargo",
};

// ─── Kademeli kâr (Fiyata Göre Kademeli Kâr) ─────────────────────────────────

export type ProfitRateType = "percent" | "amount";

/** Tek bir kâr baremi. Aralık [min, max): max null = ∞. Taban = alış maliyeti. */
export interface ProfitTier {
  min: number;
  max: number | null;
  rateType: ProfitRateType;
  rate: number;
  extraCosts: number[];
}

export type ProfitType = "fixed" | "tiered";

// ─── Supplier (entity) ──────────────────────────────────────────────────────

export interface Supplier {
  id: string;
  name: string;
  feedCount: number;
  marginPercent: number;
  /** Kâr tipi: "fixed" (marginPercent+extraCostTry) | "tiered" (profitTiers). */
  profitType: ProfitType;
  /** Kademeli kâr baremleri (profitType="tiered"). */
  profitTiers: ProfitTier[];
  stockThreshold: number;
  hideBelowThreshold: boolean;
  marketplaces: Marketplace[];
  isActive: boolean;
  includeInOwnFeed: boolean;
  productCount: number;
  lastSyncAt: string | null;
  createdAt?: string;
  updatedAt?: string;
  priceIncludesVat: boolean;
  extraCostTry: number | null;
  minPrice: number | null;
  /** KDV oranı (10/20) — KDV strip + cüzdan/kâr gross-up için tek rate. */
  purchaseVatRate: number;
  /** Alış indirimi (%) — XML fiyatına uygulanır (tek indirim alanı). */
  purchaseDiscountInclVatPct: number;
  /** Alış indirimi (TL) — XML fiyatına uygulanır. */
  purchaseDiscountTl: number;
  /** Alış ek maliyeti (TL) — birim başına maliyete eklenir. */
  purchaseExtraCostTl: number;
  /** @deprecated tek indirim purchaseDiscountInclVatPct'tir. */
  purchaseDiscountExclVatPct: number;
  mandatoryCarriers: MandatoryCarrier[];
  requiresPdf: boolean;
  pttavmEnabled: boolean;
  leadTimeDays: number | null;
  feeds?: SupplierFeed[];
}

// ─── SupplierFeed ────────────────────────────────────────────────────────────

export interface SupplierFeed {
  id: string;
  name: string;
  feedUrl: string;
  authType: AuthType;
  refreshIntervalHours: number;
  feedCurrency: FeedCurrency;
  exchangeRate: number | null;
  exchangeRateMargin: number;
  active: boolean;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface SupplierFeedInput {
  name?: string;
  feedUrl: string;
  authType: AuthType;
  credentials?: string;
  refreshIntervalHours: number;
  feedCurrency: FeedCurrency;
  /** null → TCMB auto */
  exchangeRate: number | null;
  exchangeRateMargin: number;
  active: boolean;
}

// ─── SupplierInput ───────────────────────────────────────────────────────────

export interface SupplierInput {
  name: string;
  marginPercent: number;
  profitType?: ProfitType;
  profitTiers?: ProfitTier[];
  stockThreshold: number;
  hideBelowThreshold: boolean;
  marketplaces: Marketplace[];
  isActive: boolean;
  includeInOwnFeed: boolean;
  priceIncludesVat: boolean;
  extraCostTry: number;
  minPrice: number;
  purchaseVatRate: number;
  purchaseDiscountInclVatPct: number;
  purchaseDiscountTl: number;
  purchaseExtraCostTl: number;
  /** @deprecated */
  purchaseDiscountExclVatPct?: number;
  mandatoryCarriers: MandatoryCarrier[];
  requiresPdf: boolean;
  pttavmEnabled: boolean;
  leadTimeDays: number | null;
  /** Only used when creating a new supplier. */
  initialFeed?: SupplierFeedInput;
}

export interface SupplierFilters {
  page?: number;
  pageSize?: number;
  q?: string;
  isActive?: boolean | undefined;
  marketplace?: Marketplace;
}

export interface SuppliersResponse {
  data: Supplier[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

// ─── Query builder ───────────────────────────────────────────────────────────

function buildQuery(filters: SupplierFilters): string {
  const params = new URLSearchParams();
  if (filters.page) params.set("page", String(filters.page));
  if (filters.pageSize) params.set("pageSize", String(filters.pageSize));
  if (filters.q && filters.q.trim().length > 0) params.set("q", filters.q.trim());
  if (typeof filters.isActive === "boolean") {
    params.set("isActive", filters.isActive ? "true" : "false");
  }
  if (filters.marketplace) params.set("marketplace", filters.marketplace);
  return params.toString();
}

// ─── Backend shapes ──────────────────────────────────────────────────────────

interface BackendFeed {
  id: string;
  name?: string | null;
  feedUrl: string;
  authType?: string | null;
  refreshIntervalHours?: number | null;
  feedCurrency?: string | null;
  exchangeRate?: number | string | null;
  exchangeRateMargin?: number | string | null;
  active?: boolean | null;
  lastSyncedAt?: string | null;
  lastSyncError?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

interface BackendSupplier {
  id: string;
  name: string;
  active: boolean;
  profitMargin: number | string;
  profitType?: string | null;
  profitTiers?: unknown;
  stockThreshold: number;
  marketplaces: Marketplace[];
  productCount?: number;
  feedCount?: number;
  lastSyncAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  includeInOwnFeed?: boolean | null;
  priceIncludesVat?: boolean | null;
  extraCostTry?: number | string | null;
  minPrice?: number | string | null;
  purchaseVatRate?: number | string | null;
  purchaseDiscountInclVatPct?: number | string | null;
  purchaseDiscountTl?: number | string | null;
  purchaseExtraCostTl?: number | string | null;
  purchaseDiscountExclVatPct?: number | string | null;
  mandatoryCarriers?: string[] | null;
  requiresPdf?: boolean | null;
  pttavmEnabled?: boolean | null;
  leadTimeDays?: number | string | null;
  feeds?: BackendFeed[];
}

interface BackendListEnvelope {
  success?: boolean;
  data: BackendSupplier[];
  meta?: { total: number; page: number; limit?: number; pageSize?: number; totalPages: number };
}

interface BackendItemEnvelope {
  success?: boolean;
  data: BackendSupplier;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toNumberOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const toNum = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Backend'den gelen ham kademeli kâr baremlerini güvenli ProfitTier[]'e çevirir. */
export function normalizeTiers(raw: unknown): ProfitTier[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((el): el is Record<string, unknown> => !!el && typeof el === "object")
    .map((e) => ({
      min: toNum(e.min),
      max: e.max == null ? null : toNum(e.max),
      rateType: e.rateType === "amount" ? "amount" : ("percent" as ProfitRateType),
      rate: toNum(e.rate),
      extraCosts: Array.isArray(e.extraCosts) ? e.extraCosts.map(toNum) : [],
    }))
    .sort((a, b) => a.min - b.min);
}

/** Yüzde indirim alanı için 0-100 arası güvenli değer (NaN/negatif → 0). */
function clampPct(value: number | null | undefined): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n > 100 ? 100 : n;
}

function parseFeedCurrency(raw: string | null | undefined): FeedCurrency {
  const upper = (raw ?? "TRY").toString().toUpperCase();
  return (FEED_CURRENCIES as readonly string[]).includes(upper)
    ? (upper as FeedCurrency)
    : "TRY";
}

function parseAuthType(raw: string | null | undefined): AuthType {
  const lower = (raw ?? "none").toString().toLowerCase();
  return (["none", "basic", "bearer"] as const).includes(lower as AuthType)
    ? (lower as AuthType)
    : "none";
}

function mapFeed(b: BackendFeed): SupplierFeed {
  return {
    id: b.id,
    name: b.name ?? "",
    feedUrl: b.feedUrl ?? "",
    authType: parseAuthType(b.authType),
    refreshIntervalHours: b.refreshIntervalHours ?? 6,
    feedCurrency: parseFeedCurrency(b.feedCurrency),
    exchangeRate: toNumberOrNull(b.exchangeRate),
    exchangeRateMargin: toNumberOrNull(b.exchangeRateMargin) ?? 0,
    active: Boolean(b.active ?? true),
    lastSyncedAt: b.lastSyncedAt ?? null,
    lastSyncError: b.lastSyncError ?? null,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

function mapSupplier(b: BackendSupplier): Supplier {
  const profitMarginNum = toNumberOrNull(b.profitMargin) ?? 0;
  const stockThreshold = b.stockThreshold ?? 0;
  return {
    id: b.id,
    name: b.name ?? "",
    feedCount: b.feedCount ?? (b.feeds?.length ?? 0),
    marginPercent: profitMarginNum,
    profitType: b.profitType === "tiered" ? "tiered" : "fixed",
    profitTiers: normalizeTiers(b.profitTiers),
    stockThreshold,
    hideBelowThreshold: stockThreshold > 0,
    marketplaces: b.marketplaces ?? [],
    isActive: b.active ?? false,
    includeInOwnFeed:
      b.includeInOwnFeed === undefined || b.includeInOwnFeed === null
        ? true
        : Boolean(b.includeInOwnFeed),
    productCount: b.productCount ?? 0,
    lastSyncAt: b.lastSyncAt ?? null,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
    priceIncludesVat: Boolean(b.priceIncludesVat ?? false),
    extraCostTry: toNumberOrNull(b.extraCostTry),
    minPrice: toNumberOrNull(b.minPrice),
    purchaseVatRate: toNumberOrNull(b.purchaseVatRate) ?? 20,
    purchaseDiscountInclVatPct: toNumberOrNull(b.purchaseDiscountInclVatPct) ?? 0,
    purchaseDiscountTl: toNumberOrNull(b.purchaseDiscountTl) ?? 0,
    purchaseExtraCostTl: toNumberOrNull(b.purchaseExtraCostTl) ?? 0,
    purchaseDiscountExclVatPct: toNumberOrNull(b.purchaseDiscountExclVatPct) ?? 0,
    mandatoryCarriers: (() => {
      const raw = Array.isArray(b.mandatoryCarriers) ? b.mandatoryCarriers : [];
      const allowed = MANDATORY_CARRIERS as readonly string[];
      const seen = new Set<string>();
      const out: MandatoryCarrier[] = [];
      for (const v of raw) {
        const key = v?.toString().toUpperCase().trim();
        if (key && allowed.includes(key) && !seen.has(key)) {
          seen.add(key);
          out.push(key as MandatoryCarrier);
        }
      }
      return out;
    })(),
    requiresPdf: Boolean(b.requiresPdf ?? false),
    pttavmEnabled: Boolean(b.pttavmEnabled ?? false),
    leadTimeDays: toNumberOrNull(b.leadTimeDays),
    feeds: b.feeds ? b.feeds.map(mapFeed) : undefined,
  };
}

function toBackendSupplierInput(input: SupplierInput) {
  const profitMargin = Number(input.marginPercent);
  return {
    name: input.name,
    profitMargin: Number.isFinite(profitMargin) ? profitMargin : 0,
    profitType: input.profitType === "tiered" ? "tiered" : "fixed",
    ...(input.profitTiers !== undefined
      ? { profitTiers: input.profitTiers }
      : {}),
    stockThreshold: input.hideBelowThreshold ? input.stockThreshold : 0,
    marketplaces: input.marketplaces,
    active: input.isActive,
    includeInOwnFeed: input.includeInOwnFeed,
    priceIncludesVat: input.priceIncludesVat,
    extraCostTry: Number.isFinite(input.extraCostTry) && input.extraCostTry >= 0
      ? input.extraCostTry
      : 0,
    minPrice: Number.isFinite(input.minPrice ?? 1) && (input.minPrice ?? 1) >= 0
      ? (input.minPrice ?? 1)
      : 1,
    purchaseVatRate:
      Number.isFinite(Number(input.purchaseVatRate)) &&
      Number(input.purchaseVatRate) > 0
        ? Math.trunc(Number(input.purchaseVatRate))
        : 20,
    purchaseDiscountInclVatPct: clampPct(input.purchaseDiscountInclVatPct),
    purchaseDiscountTl:
      Number.isFinite(Number(input.purchaseDiscountTl)) &&
      Number(input.purchaseDiscountTl) >= 0
        ? Number(input.purchaseDiscountTl)
        : 0,
    purchaseExtraCostTl:
      Number.isFinite(Number(input.purchaseExtraCostTl)) &&
      Number(input.purchaseExtraCostTl) >= 0
        ? Number(input.purchaseExtraCostTl)
        : 0,
    mandatoryCarriers: Array.isArray(input.mandatoryCarriers) ? input.mandatoryCarriers : [],
    requiresPdf: Boolean(input.requiresPdf),
    pttavmEnabled: Boolean(input.pttavmEnabled),
    leadTimeDays: input.leadTimeDays,
    ...(input.initialFeed ? { initialFeed: toBackendFeedInput(input.initialFeed) } : {}),
  };
}

function toBackendFeedInput(feed: SupplierFeedInput) {
  const isTry = feed.feedCurrency === "TRY";
  const body: Record<string, unknown> = {
    feedUrl: feed.feedUrl.trim(),
    refreshIntervalHours: feed.refreshIntervalHours,
    feedCurrency: feed.feedCurrency,
    exchangeRate: isTry ? null : (feed.exchangeRate !== null && Number.isFinite(feed.exchangeRate) ? feed.exchangeRate : null),
    exchangeRateMargin: isTry ? 0 : (Number.isFinite(feed.exchangeRateMargin) ? feed.exchangeRateMargin : 0),
    active: feed.active,
  };
  if (feed.name && feed.name.trim().length > 0) {
    body.name = feed.name.trim();
  }
  if (feed.authType !== "none" && feed.credentials) {
    body.auth = { type: feed.authType, credentials: feed.credentials };
  } else {
    body.auth = { type: "none" };
  }
  return body;
}

// ─── Supplier CRUD ───────────────────────────────────────────────────────────

export async function fetchSuppliers(
  filters: SupplierFilters = {},
): Promise<SuppliersResponse> {
  const qs = buildQuery(filters);
  const raw = await apiFetch<BackendListEnvelope | BackendSupplier[]>(
    `/admin/suppliers${qs ? `?${qs}` : ""}`,
  );
  if (Array.isArray(raw)) {
    return {
      data: raw.map(mapSupplier),
      meta: { total: raw.length, page: 1, pageSize: raw.length, totalPages: 1 },
    };
  }
  const meta = raw.meta;
  return {
    data: raw.data.map(mapSupplier),
    meta: {
      total: meta?.total ?? raw.data.length,
      page: meta?.page ?? 1,
      pageSize: meta?.pageSize ?? meta?.limit ?? raw.data.length,
      totalPages: meta?.totalPages ?? 1,
    },
  };
}

export async function fetchSupplier(id: string): Promise<Supplier> {
  const raw = await apiFetch<BackendItemEnvelope | BackendSupplier>(
    `/admin/suppliers/${id}`,
  );
  return mapSupplier("data" in raw ? raw.data : raw);
}

export async function createSupplier(input: SupplierInput): Promise<Supplier> {
  const raw = await apiFetch<BackendItemEnvelope | BackendSupplier>(`/admin/suppliers`, {
    method: "POST",
    body: JSON.stringify(toBackendSupplierInput(input)),
  });
  return mapSupplier("data" in raw ? raw.data : raw);
}

export async function updateSupplier(
  id: string,
  input: Omit<SupplierInput, "initialFeed">,
): Promise<Supplier> {
  const raw = await apiFetch<BackendItemEnvelope | BackendSupplier>(`/admin/suppliers/${id}`, {
    method: "PATCH",
    body: JSON.stringify(toBackendSupplierInput({ ...input, initialFeed: undefined })),
  });
  return mapSupplier("data" in raw ? raw.data : raw);
}

export async function deleteSupplier(id: string): Promise<void> {
  await apiFetch<void>(`/admin/suppliers/${id}`, { method: "DELETE" });
}

export async function syncSupplier(id: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/admin/suppliers/${id}/sync`, {
    method: "POST",
  });
}

export async function syncSupplierCategories(
  id: string,
): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/admin/suppliers/${id}/sync-categories`, {
    method: "POST",
  });
}

// ─── Feed CRUD ───────────────────────────────────────────────────────────────

export async function fetchSupplierFeeds(supplierId: string): Promise<SupplierFeed[]> {
  const raw = await apiFetch<{ data: BackendFeed[] } | BackendFeed[]>(
    `/admin/suppliers/${supplierId}/feeds`,
  );
  const list = Array.isArray(raw) ? raw : Array.isArray(raw.data) ? raw.data : [];
  return list.map(mapFeed);
}

export async function createSupplierFeed(
  supplierId: string,
  input: SupplierFeedInput,
): Promise<SupplierFeed> {
  const raw = await apiFetch<{ data: BackendFeed } | BackendFeed>(
    `/admin/suppliers/${supplierId}/feeds`,
    {
      method: "POST",
      body: JSON.stringify(toBackendFeedInput(input)),
    },
  );
  return mapFeed("data" in raw ? raw.data : raw);
}

export async function updateSupplierFeed(
  supplierId: string,
  feedId: string,
  input: Partial<SupplierFeedInput>,
): Promise<SupplierFeed> {
  const body: Record<string, unknown> = {};
  if (input.name !== undefined) body.name = input.name?.trim() ?? undefined;
  if (input.feedUrl !== undefined) body.feedUrl = input.feedUrl.trim();
  if (input.refreshIntervalHours !== undefined) body.refreshIntervalHours = input.refreshIntervalHours;
  if (input.feedCurrency !== undefined) {
    const isTry = input.feedCurrency === "TRY";
    body.feedCurrency = input.feedCurrency;
    if (input.exchangeRate !== undefined) {
      body.exchangeRate = isTry ? null : (input.exchangeRate !== null && Number.isFinite(input.exchangeRate) ? input.exchangeRate : null);
    }
    if (input.exchangeRateMargin !== undefined) {
      body.exchangeRateMargin = isTry ? 0 : (Number.isFinite(input.exchangeRateMargin) ? input.exchangeRateMargin : 0);
    }
  } else {
    if (input.exchangeRate !== undefined) body.exchangeRate = input.exchangeRate;
    if (input.exchangeRateMargin !== undefined) body.exchangeRateMargin = input.exchangeRateMargin;
  }
  if (input.active !== undefined) body.active = input.active;
  if (input.authType !== undefined) {
    if (input.authType !== "none" && input.credentials) {
      body.auth = { type: input.authType, credentials: input.credentials };
    } else {
      body.auth = { type: "none" };
    }
  }

  const raw = await apiFetch<{ data: BackendFeed } | BackendFeed>(
    `/admin/suppliers/${supplierId}/feeds/${feedId}`,
    {
      method: "PATCH",
      body: JSON.stringify(body),
    },
  );
  return mapFeed("data" in raw ? raw.data : raw);
}

export async function deleteSupplierFeed(
  supplierId: string,
  feedId: string,
): Promise<void> {
  await apiFetch<void>(`/admin/suppliers/${supplierId}/feeds/${feedId}`, {
    method: "DELETE",
  });
}

export async function syncSupplierFeed(
  supplierId: string,
  feedId: string,
): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(
    `/admin/suppliers/${supplierId}/feeds/${feedId}/sync`,
    { method: "POST" },
  );
}

export interface FeedCurrencyDetection {
  /** XML'de ürün-bazlı para birimi etiketi bulundu mu? */
  hasPerProductCurrency: boolean;
  /** Para birimi → ürün adedi (örn. { USD: 4912, TRY: 88 }). */
  currencies: Record<string, number>;
  /** TRY dışı para birimleri (kur sorulması gerekenler). */
  foreignCurrencies: string[];
  /** Toplam para birimi etiketi sayısı. */
  total: number;
  /** Feed indirilemediyse hata mesajı. */
  error?: string;
}

export async function detectFeedCurrencies(
  supplierId: string,
  feedId: string,
): Promise<FeedCurrencyDetection> {
  const res = await apiFetch<{ data: FeedCurrencyDetection }>(
    `/admin/suppliers/${supplierId}/feeds/${feedId}/detect-currencies`,
  );
  return res.data;
}

// ─── Categories ──────────────────────────────────────────────────────────────

export interface SupplierCategory {
  id: string;
  code: string;
  name: string;
  externalId?: string | null;
  isActive: boolean;
  productCount?: number;
  /** Kategori bazlı kâr marjı override'ı (%). null = tedarikçi global ayarı. */
  marginPercentOverride: number | null;
  /** Kategori bazlı ek kâr override'ı (TL). null = tedarikçi global ayarı. */
  extraCostTryOverride: number | null;
  /** Kategori kâr tipi override'ı. null = tedarikçiden miras. */
  profitTypeOverride: ProfitType | null;
  /** Kategori kademeli kâr baremleri (profitTypeOverride="tiered"). */
  profitTiers: ProfitTier[];
}

interface BackendSupplierCategory {
  id: string;
  code?: string | null;
  name?: string | null;
  externalId?: string | null;
  isActive?: boolean | null;
  active?: boolean | null;
  productCount?: number | null;
  marginPercentOverride?: number | null;
  extraCostTryOverride?: number | null;
  profitTypeOverride?: string | null;
  profitTiers?: unknown;
}

function mapSupplierCategory(c: BackendSupplierCategory): SupplierCategory {
  return {
    id: c.id,
    code: c.code ?? c.id,
    name: c.name ?? "",
    externalId: c.externalId ?? null,
    isActive: Boolean(c.isActive ?? c.active ?? true),
    productCount:
      typeof c.productCount === "number" ? c.productCount : undefined,
    marginPercentOverride:
      typeof c.marginPercentOverride === "number"
        ? c.marginPercentOverride
        : null,
    extraCostTryOverride:
      typeof c.extraCostTryOverride === "number"
        ? c.extraCostTryOverride
        : null,
    profitTypeOverride:
      c.profitTypeOverride === "tiered"
        ? "tiered"
        : c.profitTypeOverride === "fixed"
          ? "fixed"
          : null,
    profitTiers: normalizeTiers(c.profitTiers),
  };
}

export async function fetchSupplierCategories(
  id: string,
): Promise<SupplierCategory[]> {
  const raw = await apiFetch<
    | { data: BackendSupplierCategory[] }
    | BackendSupplierCategory[]
  >(`/admin/suppliers/${id}/categories`);
  const list = Array.isArray(raw) ? raw : Array.isArray(raw.data) ? raw.data : [];
  return list.map(mapSupplierCategory);
}

// V3 — DOĞRU (canonical) kategori görünümü (salt-okunur).
export interface CanonicalCategory {
  path: string;
  productCount: number;
}
export interface CanonicalCategoryProduct {
  id: string;
  name: string;
  brand: string | null;
  price: number | string;
  stock: number;
  internalCode: string | null;
}

export async function fetchSupplierCanonicalCategories(
  id: string,
): Promise<{ categories: CanonicalCategory[]; unmapped: number }> {
  type Body = { categories: CanonicalCategory[]; unmapped: number };
  const raw = await apiFetch<{ data: Body } | Body>(
    `/admin/suppliers/${id}/canonical-categories`,
  );
  const body =
    raw && "data" in (raw as object)
      ? (raw as { data: Body }).data
      : (raw as Body);
  return {
    categories: Array.isArray(body?.categories) ? body.categories : [],
    unmapped: body?.unmapped ?? 0,
  };
}

export async function fetchSupplierCanonicalCategoryProducts(
  id: string,
  path: string,
): Promise<CanonicalCategoryProduct[]> {
  const raw = await apiFetch<
    { data: CanonicalCategoryProduct[] } | CanonicalCategoryProduct[]
  >(
    `/admin/suppliers/${id}/canonical-categories/products?path=${encodeURIComponent(
      path,
    )}`,
  );
  if (Array.isArray(raw)) return raw;
  return Array.isArray((raw as { data: CanonicalCategoryProduct[] }).data)
    ? (raw as { data: CanonicalCategoryProduct[] }).data
    : [];
}

export async function updateSupplierCategoryActive(
  id: string,
  categoryCode: string,
  isActive: boolean,
): Promise<SupplierCategory> {
  const raw = await apiFetch<
    | { data: BackendSupplierCategory }
    | BackendSupplierCategory
  >(`/admin/suppliers/${id}/categories/${encodeURIComponent(categoryCode)}`, {
    method: "PATCH",
    body: JSON.stringify({ isActive }),
  });
  const data = "data" in (raw as object) ? (raw as { data: BackendSupplierCategory }).data : (raw as BackendSupplierCategory);
  return mapSupplierCategory(data);
}

export interface SupplierCategoryPricingResult {
  code: string;
  marginPercentOverride: number | null;
  extraCostTryOverride: number | null;
  profitTypeOverride?: ProfitType | null;
  profitTiers?: ProfitTier[];
  repriced: number;
}

/**
 * Kategori bazlı fiyatlandırma override'ı.
 *
 * Her alan bağımsız: `undefined` bırakılan alan değiştirilmez, `null`
 * gönderilen alan globale döndürülür, sayı gönderilen alan override edilir.
 * Backend kaydı uyguladıktan sonra ilgili ürünleri yeniden fiyatlandırır.
 */
export async function updateSupplierCategoryPricing(
  id: string,
  categoryCode: string,
  patch: {
    marginPercentOverride?: number | null;
    extraCostTryOverride?: number | null;
    profitTypeOverride?: ProfitType | null;
    profitTiers?: ProfitTier[] | null;
  },
): Promise<SupplierCategoryPricingResult> {
  const body: Record<string, unknown> = {};
  if (patch.marginPercentOverride !== undefined) {
    body.marginPercentOverride = patch.marginPercentOverride;
  }
  if (patch.extraCostTryOverride !== undefined) {
    body.extraCostTryOverride = patch.extraCostTryOverride;
  }
  if (patch.profitTypeOverride !== undefined) {
    body.profitTypeOverride = patch.profitTypeOverride;
  }
  if (patch.profitTiers !== undefined) {
    body.profitTiers = patch.profitTiers;
  }
  const raw = await apiFetch<
    | { data: SupplierCategoryPricingResult }
    | SupplierCategoryPricingResult
  >(
    `/admin/suppliers/${id}/categories/${encodeURIComponent(categoryCode)}/pricing`,
    {
      method: "PATCH",
      body: JSON.stringify(body),
    },
  );
  return "data" in (raw as object)
    ? (raw as { data: SupplierCategoryPricingResult }).data
    : (raw as SupplierCategoryPricingResult);
}

// ─── Products ────────────────────────────────────────────────────────────────

export interface SupplierProductsFilters {
  page?: number;
  pageSize?: number;
  q?: string;
  /** Tam kategori yolu (Category.path) — yalnızca bu kategorideki ürünleri getirir. */
  categoryPath?: string;
  /** Ham XML markası (Product.sourceBrand) — yalnızca bu markadaki ürünleri getirir. */
  sourceBrand?: string;
}

export interface SupplierProductsResponse {
  data: Array<{
    id: string;
    name: string;
    sku?: string | null;
    brand?: string | null;
    costPrice: number;
    price: number;
    stock: number;
    imageUrl?: string | null;
  }>;
  meta: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

export async function fetchSupplierProducts(
  id: string,
  filters: SupplierProductsFilters = {},
): Promise<SupplierProductsResponse> {
  const params = new URLSearchParams();
  if (filters.page) params.set("page", String(filters.page));
  if (filters.pageSize) params.set("pageSize", String(filters.pageSize));
  if (filters.q && filters.q.trim().length > 0) params.set("q", filters.q.trim());
  if (filters.categoryPath && filters.categoryPath.trim().length > 0) {
    params.set("categoryPath", filters.categoryPath.trim());
  }
  if (filters.sourceBrand && filters.sourceBrand.trim().length > 0) {
    params.set("sourceBrand", filters.sourceBrand.trim());
  }
  const qs = params.toString();
  return apiFetch<SupplierProductsResponse>(
    `/admin/suppliers/${id}/products${qs ? `?${qs}` : ""}`,
  );
}

// ─── Utilities ───────────────────────────────────────────────────────────────

export function formatRelativeTime(value: string | null | undefined): string {
  if (!value) return "Hiç";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const diff = Date.now() - date.getTime();
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diff < min) return "az önce";
  if (diff < hour) return `${Math.floor(diff / min)} dk önce`;
  if (diff < day) return `${Math.floor(diff / hour)} sa önce`;
  if (diff < 7 * day) return `${Math.floor(diff / day)} gün önce`;
  return date.toLocaleDateString("tr-TR");
}
