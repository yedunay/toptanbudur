import { apiFetch } from "./auth";

export interface Product {
  id: string;
  name: string;
  brand?: string | null;
  categoryName?: string | null;
  categorySlug?: string | null;
  /** Tedarikçiden geliş (maliyet) fiyatı — sadece admin görür */
  costPrice: number;
  /** Efektif (gösterilen) fiyat = manualPrice ?? feedPrice */
  price: number;
  /** Efektif (gösterilen) stok = manualStock ?? feedStock */
  stock: number;
  /** Admin'in pinlediği fiyat; null = feed yönetir */
  manualPrice?: number | null;
  /** Admin'in pinlediği stok; null = feed yönetir */
  manualStock?: number | null;
  /** Sync'in en son XML'den hesapladığı ham fiyat — feed moduna dönüş referansı */
  feedPrice?: number | null;
  /** Sync'in en son XML'den hesapladığı ham stok — feed moduna dönüş referansı */
  feedStock?: number | null;
  isActive: boolean;
  imageUrl?: string | null;
  /** Site stok kodu (TBDR-XXXXXX) ?? tedarikçi kodu — geriye dönük alan */
  sku?: string | null;
  /** Site dahili stok kodu (TBDR-XXXXXX) — müşteriye "Stok Kodu" olarak gösterilir */
  internalCode?: string | null;
  /** Tedarikçinin ham ürün/stok kodu — sadece admin görür, müşteriye asla gösterilmez */
  externalCode?: string | null;
  /** Orijinal (tedarikçiden gelen) barkod — sadece admin görür */
  barcode?: string | null;
  /** Müşteriye gösterilen public barkod (TBDR...) — backend dönerse kullanılır */
  publicBarcode?: string | null;
  /**
   * Tedarikçi referansı. Backend `supplier: { id, name }` veya düz `supplierName`
   * dönmüş olabilir; her iki şekli de tolere ediyoruz.
   */
  supplier?: { id: string; name: string } | null;
  supplierName?: string | null;
  supplierId?: string | null;
}

export interface ProductsMeta {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ProductsResponse {
  data: Product[];
  meta: ProductsMeta;
}

export interface ProductFilters {
  page: number;
  pageSize: number;
  q?: string;
  categorySlug?: string;
  brand?: string;
  inStock?: boolean;
  supplierId?: string;
}

export interface ProductPatch {
  name?: string;
  /** Sayı = manuel override; null = feed moduna dön (manuel override'ı temizle) */
  price?: number | null;
  /** Sayı = manuel override; null = feed moduna dön (manuel override'ı temizle) */
  stock?: number | null;
  isActive?: boolean;
}

export interface BulkPatch {
  /** Sayı = manuel override; null = feed moduna dön */
  price?: number | null;
  /** Sayı = manuel override; null = feed moduna dön */
  stock?: number | null;
  isActive?: boolean;
}

export interface BulkUpdateResponse {
  updated: number;
}

function buildQuery(filters: ProductFilters): string {
  const params = new URLSearchParams();
  params.set("page", String(filters.page));
  params.set("pageSize", String(filters.pageSize));
  if (filters.q && filters.q.trim().length > 0) params.set("q", filters.q.trim());
  if (filters.categorySlug) params.set("categorySlug", filters.categorySlug);
  if (filters.brand) params.set("brand", filters.brand);
  if (filters.inStock) params.set("inStock", "true");
  if (filters.supplierId) params.set("supplierId", filters.supplierId);
  return params.toString();
}

interface RawProduct extends Omit<Product, "supplier"> {
  supplier?: { id?: string; name?: string } | null;
  supplierName?: string | null;
  supplierId?: string | null;
}

function normalizeProduct(p: RawProduct): Product {
  const supplier =
    p.supplier && p.supplier.id && p.supplier.name
      ? { id: p.supplier.id, name: p.supplier.name }
      : null;
  return {
    ...p,
    supplier,
    supplierName: p.supplierName ?? supplier?.name ?? null,
    supplierId: p.supplierId ?? supplier?.id ?? null,
    publicBarcode: p.publicBarcode ?? null,
  };
}

export async function fetchProducts(filters: ProductFilters): Promise<ProductsResponse> {
  const raw = await apiFetch<{ data: RawProduct[]; meta: ProductsMeta }>(
    `/admin/products?${buildQuery(filters)}`,
  );
  return {
    data: (raw.data ?? []).map(normalizeProduct),
    meta: raw.meta,
  };
}

export async function patchProduct(id: string, patch: ProductPatch): Promise<Product> {
  return apiFetch<Product>(`/admin/products/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function bulkUpdateProducts(
  ids: string[],
  patch: BulkPatch,
): Promise<BulkUpdateResponse> {
  return apiFetch<BulkUpdateResponse>(`/admin/products/bulk-update`, {
    method: "POST",
    body: JSON.stringify({ ids, patch }),
  });
}

export interface BulkDeleteResponse {
  deleted: number;
}

export async function bulkDeleteProducts(ids: string[]): Promise<BulkDeleteResponse> {
  return apiFetch<BulkDeleteResponse>(`/admin/products/bulk-delete`, {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
}

// Manuel ürün yükleme: backend POST /admin/products/manual endpoint'i çoklu
// görsel + form verilerini kabul eder. UI 10 görsel × 5MB limitini kullanıcıya
// göstermeli; backend de aynı limitle Multer üzerinden korur.
export const MANUAL_MAX_IMAGES = 10;
export const MANUAL_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MANUAL_DEFAULT_TAX_RATE = 10;

export interface CreateManualProductInput {
  name: string;
  description?: string | null;
  categoryId?: string | null;
  price: number;
  costPrice?: number | null;
  stock: number;
  taxRate?: number | null;
  brand?: string | null;
  model?: string | null;
  isActive?: boolean;
  images: File[];
}

export interface CreatedManualProduct {
  id: string;
  slug: string;
  name: string;
  internalCode: string;
  publicBarcode: string;
  externalCode: string;
  imageCount: number;
}

export async function createManualProduct(
  input: CreateManualProductInput,
): Promise<CreatedManualProduct> {
  if (input.images.length === 0) {
    throw new Error("En az 1 ürün görseli yüklemelisiniz.");
  }
  if (input.images.length > MANUAL_MAX_IMAGES) {
    throw new Error(`En fazla ${MANUAL_MAX_IMAGES} görsel yükleyebilirsiniz.`);
  }
  for (const file of input.images) {
    if (file.size > MANUAL_MAX_IMAGE_BYTES) {
      throw new Error(
        `"${file.name}" 5MB sınırını aşıyor. Lütfen daha küçük bir dosya seçin.`,
      );
    }
  }

  const form = new FormData();
  form.append("name", input.name);
  if (input.description) form.append("description", input.description);
  if (input.categoryId) form.append("categoryId", input.categoryId);
  form.append("price", String(input.price));
  if (input.costPrice != null && Number.isFinite(input.costPrice)) {
    form.append("costPrice", String(input.costPrice));
  }
  form.append("stock", String(input.stock));
  form.append(
    "taxRate",
    String(input.taxRate ?? MANUAL_DEFAULT_TAX_RATE),
  );
  if (input.brand) form.append("brand", input.brand);
  if (input.model) form.append("model", input.model);
  if (input.isActive != null) form.append("isActive", String(input.isActive));
  for (const file of input.images) {
    form.append("images", file, file.name);
  }

  return apiFetch<CreatedManualProduct>(`/admin/products/manual`, {
    method: "POST",
    body: form,
  });
}

export function formatTRY(value: number): string {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Sistem genelinde uygulanan KDV oranı (%). Backend tarafında satış için
 * `DEFAULT_KDV_RATE = 20`, tedarikçi varsayılan `purchaseVatRate = 20` ile aynıdır.
 * `costPrice` ve `price` DB'de KDV HARİÇ (net) tutulur; KDV checkout'ta eklenir.
 */
export const KDV_RATE = 20;

/** KDV hariç (net) tutardan KDV dahil (brüt) tutarı türetir. */
export function withKdv(net: number): number {
  return net * (1 + KDV_RATE / 100);
}

/**
 * Net (KDV hariç) kar marjı — satış ve geliş fiyatının doğrudan farkı.
 * Her iki değer de net olduğundan sonuç KDV'den bağımsızdır ("direkt ara farkı").
 * `pct`: maliyet üzerinden kar oranı (%); maliyet yoksa null.
 */
export function netMargin(
  price: number,
  costPrice: number,
): { diff: number; pct: number | null } {
  const diff = price - costPrice;
  const pct = costPrice > 0 ? (diff / costPrice) * 100 : null;
  return { diff, pct };
}
