/**
 * Kargo takip deep-link haritası ve yardımcıları.
 *
 * Backend `Order.cargoCompany` ve `SupportMessage.carrier` alanlarındaki
 * Türkçe etiketleri burada normalize edip ilgili kargo firmasının takip
 * sayfasına yönlendiriyoruz. URL şablonları talep gereksinimlerine göredir.
 */

export const CARRIERS = [
  'Yurtiçi Kargo',
  'Aras Kargo',
  'Sürat Kargo',
  'MNG Kargo',
  'PTT Kargo',
  'UPS',
  'Hepsijet',
  'Trendyol Express',
  'Diğer',
] as const;

export type CarrierName = (typeof CARRIERS)[number];

const CARRIER_KEYS: Record<string, CarrierName> = {
  yurtici: 'Yurtiçi Kargo',
  yurtiçi: 'Yurtiçi Kargo',
  yurticikargo: 'Yurtiçi Kargo',
  yurtiçikargo: 'Yurtiçi Kargo',
  aras: 'Aras Kargo',
  araskargo: 'Aras Kargo',
  surat: 'Sürat Kargo',
  sürat: 'Sürat Kargo',
  suratkargo: 'Sürat Kargo',
  süratkargo: 'Sürat Kargo',
  mng: 'MNG Kargo',
  mngkargo: 'MNG Kargo',
  ptt: 'PTT Kargo',
  pttkargo: 'PTT Kargo',
  ups: 'UPS',
  hepsijet: 'Hepsijet',
  trendyolexpress: 'Trendyol Express',
  'trendyol express': 'Trendyol Express',
};

function normaliseCarrier(input: string | null | undefined): CarrierName | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  // Direct match against known label
  const exact = (CARRIERS as readonly string[]).find(
    (c) => c.toLowerCase() === trimmed.toLowerCase(),
  );
  if (exact) return exact as CarrierName;
  const key = trimmed.toLowerCase().replace(/\s+/g, '');
  return CARRIER_KEYS[key] ?? null;
}

/**
 * Verilen kargo firması ve kargo kodu için derin bağlantı üretir.
 * - Kod yoksa veya firma "Diğer" / tanınmıyorsa null döner.
 * - Kod URL-encode edilir.
 */
export function getCarrierTrackingUrl(
  carrier: string | null | undefined,
  code: string | null | undefined,
): string | null {
  if (!code) return null;
  const trimmedCode = code.trim();
  if (!trimmedCode) return null;
  const normalised = normaliseCarrier(carrier);
  if (!normalised || normalised === 'Diğer') return null;
  const encoded = encodeURIComponent(trimmedCode);
  switch (normalised) {
    case 'Yurtiçi Kargo':
      return `https://www.yurticikargo.com/tr/online-servisler/gonderi-sorgula?code=${encoded}`;
    case 'Aras Kargo':
      return `https://kargotakip.araskargo.com.tr/?code=${encoded}`;
    case 'Sürat Kargo':
      return `https://www.suratkargo.com.tr/KargoTakip/?kargotakipno=${encoded}`;
    case 'MNG Kargo':
      return `https://service.mngkargo.com.tr/iShipmentWeb/?ShipmentNumber=${encoded}`;
    case 'PTT Kargo':
      return `https://gonderitakip.ptt.gov.tr/Track/${encoded}`;
    case 'UPS':
      return `https://www.ups.com/track?tracknum=${encoded}`;
    case 'Hepsijet':
      return `https://www.hepsijet.com/gonderi-takibi?code=${encoded}`;
    case 'Trendyol Express':
      return `https://trendyolexpress.com/gonderi-takibi?code=${encoded}`;
    default:
      return null;
  }
}
