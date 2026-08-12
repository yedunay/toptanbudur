import { apiFetch } from "./auth";

export interface SupplierBrandMapping {
  /** Tedarikçi XML'inden gelen orijinal marka adı (sadece okunur) */
  sourceBrandName: string;
  /** Bizim sistemimizde gösterilecek hedef marka adı.
   *  Boş/null ise kaynak marka olduğu gibi kullanılır. */
  targetBrandName: string | null;
  /** Bu markayı sitede tamamen gizle */
  hidden: boolean;
  /** Bu kaynak markaya bağlı ürün sayısı (varsa görüntüleme için) */
  productCount?: number;
}

interface BackendBrandRow {
  sourceBrandName?: string;
  source?: string;
  brand?: string;
  targetBrandName?: string | null;
  target?: string | null;
  mappedTo?: string | null;
  hidden?: boolean;
  productCount?: number;
  count?: number;
}

interface BackendListEnvelope {
  data?: BackendBrandRow[];
  brands?: BackendBrandRow[];
}

function mapRow(row: BackendBrandRow): SupplierBrandMapping {
  const source = row.sourceBrandName ?? row.source ?? row.brand ?? "";
  const target = row.targetBrandName ?? row.target ?? row.mappedTo ?? null;
  return {
    sourceBrandName: source,
    targetBrandName:
      typeof target === "string" && target.trim().length > 0 ? target : null,
    hidden: Boolean(row.hidden),
    productCount: row.productCount ?? row.count ?? undefined,
  };
}

export async function fetchSupplierBrands(
  supplierId: string,
): Promise<SupplierBrandMapping[]> {
  const raw = await apiFetch<
    BackendListEnvelope | BackendBrandRow[] | { success?: boolean; data?: BackendBrandRow[] }
  >(`/admin/suppliers/${supplierId}/brands`);

  if (Array.isArray(raw)) return raw.map(mapRow);
  const list = (raw as BackendListEnvelope).data ?? (raw as BackendListEnvelope).brands ?? [];
  return list.map(mapRow);
}

export interface BulkSaveBrandsInput {
  mappings: SupplierBrandMapping[];
}

export interface SaveSupplierBrandsResult {
  /** Kaydedilen marka eşleştirmesi sayısı */
  updated: number;
  /** Gizli markalar nedeniyle anında pasifleştirilen ürün sayısı */
  hidden: number;
}

export async function saveSupplierBrands(
  supplierId: string,
  mappings: SupplierBrandMapping[],
): Promise<SaveSupplierBrandsResult> {
  const payload = {
    mappings: mappings.map((m) => ({
      sourceBrandName: m.sourceBrandName,
      targetBrandName:
        m.targetBrandName && m.targetBrandName.trim().length > 0
          ? m.targetBrandName.trim()
          : null,
      hidden: Boolean(m.hidden),
    })),
  };
  const res = await apiFetch<{
    data?: unknown[];
    meta?: { updated?: number; hidden?: number };
  }>(`/admin/suppliers/${supplierId}/brands`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  return {
    updated: res?.meta?.updated ?? res?.data?.length ?? mappings.length,
    hidden: res?.meta?.hidden ?? 0,
  };
}
