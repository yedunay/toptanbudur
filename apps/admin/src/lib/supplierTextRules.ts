import { apiFetch } from "./auth";

/**
 * SupplierTextRule — tedarikçi bazlı metin kuralı (sil/değiştir). `search` ürün
 * adı/açıklamasında aranan LİTERAL düz metindir (regex DEĞİL). `replacement`
 * boşsa SİL, doluysa DEĞİŞTİR. Kurallar hem mağaza gösteriminde hem giden XML
 * feed'inde uygulanır.
 */
export interface SupplierTextRule {
  /** Aranan literal metin */
  search: string;
  /** Yerine konacak metin; boş ise eşleşen metin silinir */
  replacement: string;
  /** Kural ürün adına uygulansın mı */
  applyToName: boolean;
  /** Kural ürün açıklamasına uygulansın mı */
  applyToDescription: boolean;
  /** Büyük/küçük harf duyarsız eşleştirme */
  caseInsensitive: boolean;
  /** Sadece tam kelime eşleşmesi (\b ... \b) */
  wholeWord: boolean;
  /** Kural aktif mi */
  enabled: boolean;
}

interface BackendTextRuleRow {
  id?: string;
  search?: string;
  replacement?: string | null;
  applyToName?: boolean;
  applyToDescription?: boolean;
  caseInsensitive?: boolean;
  wholeWord?: boolean;
  enabled?: boolean;
  sortOrder?: number;
  updatedAt?: string;
}

interface BackendListEnvelope {
  success?: boolean;
  data?: BackendTextRuleRow[];
}

function mapRow(row: BackendTextRuleRow): SupplierTextRule {
  return {
    search: row.search ?? "",
    replacement: typeof row.replacement === "string" ? row.replacement : "",
    applyToName: row.applyToName ?? true,
    applyToDescription: row.applyToDescription ?? true,
    caseInsensitive: row.caseInsensitive ?? true,
    wholeWord: row.wholeWord ?? false,
    enabled: row.enabled ?? true,
  };
}

export async function fetchSupplierTextRules(
  supplierId: string,
): Promise<SupplierTextRule[]> {
  const raw = await apiFetch<BackendListEnvelope | BackendTextRuleRow[]>(
    `/admin/suppliers/${supplierId}/text-rules`,
  );
  if (Array.isArray(raw)) return raw.map(mapRow);
  return (raw.data ?? []).map(mapRow);
}

export async function saveSupplierTextRules(
  supplierId: string,
  rules: SupplierTextRule[],
): Promise<SupplierTextRule[]> {
  const payload = {
    rules: rules
      // Boş arama metinli kuralları gönderme — backend MinLength(1) reddeder.
      .filter((r) => r.search.trim().length > 0)
      .map((r) => ({
        search: r.search.trim(),
        replacement: r.replacement,
        applyToName: r.applyToName,
        applyToDescription: r.applyToDescription,
        caseInsensitive: r.caseInsensitive,
        wholeWord: r.wholeWord,
        enabled: r.enabled,
      })),
  };
  const raw = await apiFetch<BackendListEnvelope | BackendTextRuleRow[]>(
    `/admin/suppliers/${supplierId}/text-rules`,
    { method: "PUT", body: JSON.stringify(payload) },
  );
  if (Array.isArray(raw)) return raw.map(mapRow);
  return (raw.data ?? []).map(mapRow);
}
