import { apiFetch } from "./auth";

export interface AppSettingDto {
  key: string;
  value: string;
  type: "number" | "decimal" | "boolean" | "string";
  category: string;
  label: string;
  description: string | null;
  minValue: number | null;
  maxValue: number | null;
  updatedAt: string;
  updatedBy: string | null;
}

export async function listSettings(category?: string): Promise<AppSettingDto[]> {
  const qs = category ? `?category=${encodeURIComponent(category)}` : "";
  const res = await apiFetch<{ success: boolean; data: AppSettingDto[] }>(
    `/admin/settings${qs}`,
  );
  return res.data;
}

export async function updateSetting(key: string, value: string): Promise<void> {
  await apiFetch(`/admin/settings/${encodeURIComponent(key)}`, {
    method: "PUT",
    body: JSON.stringify({ value }),
  });
}

export const CATEGORY_LABELS: Record<string, string> = {
  autoship: "Otomatik Kargoya Verme (Sevkiyat Saatleri)",
  pricing: "Fiyatlandırma",
  payment: "Ödeme",
  birfatura: "BirFatura (e-Fatura) Entegrasyonu",
  kategori: "Kategori Eşleme",
};

/** Grup başlığının altında gösterilen kısa açıklama (opsiyonel). */
export const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  autoship:
    "Siparişleri hangi gün/saatte otomatik ‘kargoya verildi’ye çekeceğimiz. Varsayılan olarak herkes tek saatte; ‘alternatif takvim’ tedarikçisi için hafta içi/Cumartesi ayrı saat. ‘Minimum Hazırlanıyor Süresi’ dolmadan (vars. 96 saat = 4 gün) hiçbir otomatik süreç siparişi kargoya verildiye ÇEKEMEZ — tedarikçi fiilen kargolasa bile.",
  birfatura: "Fatura kesim/tutma süreleri ve konsolidasyon ayarları.",
};

/**
 * Grupların gösterim sırası. Listede olmayan kategoriler bunların ardından
 * alfabetik gelir. En sık dokunulan/önemli gruplar üstte.
 */
export const CATEGORY_ORDER: string[] = [
  "autoship",
  "pricing",
  "payment",
  "birfatura",
];
