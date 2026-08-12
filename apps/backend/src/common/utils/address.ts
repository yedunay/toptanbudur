/**
 * Yapısal adres alanlarından (CustomerAddress) tek satırlık, insan-okur bir
 * "companyAddress" stringi üretir. Bu, müşterinin adres defterindeki adresi
 * legacy `Customer.companyAddress` (düz metin "Firma Adresi") alanına yansıtmak
 * için kullanılır — hem one-off backfill scriptinde hem de going-forward
 * senkronda (varsayılan adres yazıldığında) AYNI fonksiyon kullanılır ki
 * üretilen format her yerde tutarlı olsun.
 *
 * Boş parçalar atlanır. Sonuç tamamen boşsa `null` döner — çağıran taraf bu
 * durumda asla boş string yazmamalı (companyAddress'i boş bırak).
 *
 * Örnek girdi: { line1: "Fındıklı Mah. Evren Cad. No:123 D:8 K:5",
 *                district: "Maltepe", city: "İstanbul", postalCode: "34854" }
 * Örnek çıktı: "Fındıklı Mah. Evren Cad. No:123 D:8 K:5, Maltepe/İstanbul, 34854"
 */
export interface AddressParts {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  district?: string | null;
  postalCode?: string | null;
}

export function formatCompanyAddress(a: AddressParts | null | undefined): string | null {
  if (!a) return null;
  const districtCity = [a.district, a.city]
    .map((p) => p?.trim())
    .filter((p): p is string => !!p && p.length > 0)
    .join('/');
  const parts = [a.line1, a.line2, districtCity, a.postalCode]
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter((p) => p.length > 0);
  const result = parts.join(', ');
  return result.length > 0 ? result : null;
}
