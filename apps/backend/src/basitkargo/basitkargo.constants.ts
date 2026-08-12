/**
 * Basit Kargo entegrasyonu sabitleri.
 *
 * Hassas değerler (API token, webhook secret) .env'de; auto-mode toggle +
 * paket ölçüsü + handler stratejisi AppSetting'te (admin editable). Bu ayrım
 * proje kuralı (§5: tüm API key'ler .env'de) ile uyumludur.
 *
 * API dokümanı: basitkargo/api.md — Base URL https://basitkargo.com/api,
 * Bearer token auth.
 */

export const BASITKARGO_ENV_KEYS = {
  BASE_URL: 'BASITKARGO_BASE_URL',
  API_TOKEN: 'BASITKARGO_API_TOKEN',
  /// Webhook URL'ine `?k=<token>` olarak eklenir; timingSafeEqual ile doğrulanır.
  WEBHOOK_TOKEN: 'BASITKARGO_WEBHOOK_TOKEN',
} as const;

export const BASITKARGO_DEFAULTS = {
  BASE_URL: 'https://basitkargo.com/api',
  /// "Kendim İçin" siparişte müşteri kargo firması seçmez — en ucuzu Basit Kargo
  /// belirler. Tedarikçinin zorunlu kargosu varsa o kazanır (resolveHandlerCode).
  HANDLER_STRATEGY: 'ECONOMIC',
  /// Ürünlerde ölçü verisi olmadığından sipariş başına tek varsayılan paket
  /// (cm / kg). Admin "Değişkenler" ekranından ayarlanabilir.
  PACKAGE: { height: 30, width: 20, depth: 15, weight: 1 },
} as const;

export const BASITKARGO_SETTING_KEYS = {
  ENABLED: 'basitkargo.enabled',
  HANDLER_STRATEGY: 'basitkargo.handlerStrategy',
  PACKAGE_HEIGHT: 'basitkargo.package.height',
  PACKAGE_WIDTH: 'basitkargo.package.width',
  PACKAGE_DEPTH: 'basitkargo.package.depth',
  PACKAGE_WEIGHT: 'basitkargo.package.weight',
} as const;

export const BASITKARGO_ENDPOINTS = {
  CREATE_ORDER_BARCODE: '/v2/order/barcode',
  FILTER_ORDERS: '/v2/order/filter',
  GET_ORDER: (id: string) => `/v2/order/${encodeURIComponent(id)}`,
  CANCEL_BARCODE: (barcode: string) =>
    `/order/barcode/${encodeURIComponent(barcode)}`,
  LABEL_SVG: (id: string) => `/label/svg/${encodeURIComponent(id)}`,
  CITIES: '/country/TR/cities',
  TOWNS: (cityId: string) => `/city/${encodeURIComponent(cityId)}/towns`,
  // NOT: Basit Kargo dokümanındaki yol "neigborhoods" (yazım hatası) — birebir kullanılır.
  NEIGHBORHOODS: (cityName: string, townName: string) =>
    `/city/${encodeURIComponent(cityName)}/town/${encodeURIComponent(townName)}/neigborhoods`,
  BALANCE: '/firm/balance',
} as const;

/**
 * Bizim kargo kodu (Supplier.mandatoryCarriers, lowercase) → Basit Kargo
 * handlerCode. `dhl` Basit Kargo'da yok → eşleme yok, ECONOMIC'e düşer.
 */
export const OUR_CARRIER_TO_BASITKARGO: Record<string, string> = {
  aras: 'ARAS',
  surat: 'SURAT',
  ptt: 'PTT',
  yurtici: 'YURTICI',
  mng: 'MNG',
};

/**
 * Bu Basit Kargo durumları "paket yola çıktı/teslim" anlamına gelir → bizim
 * sipariş en az `shipped` işaretlenir. NEW/READY_TO_SHIP tetiklemez.
 */
export const BASITKARGO_SHIPPED_STATUSES = new Set<string>([
  'SHIPPED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'RETURNING',
  'RETURNED',
]);

/// Retry cron'unun toplayacağı ara-durumlar (henüz barkod dolmamış self sipariş).
export const BASITKARGO_PENDING_STATUSES = [
  'PENDING',
  'FAILED',
  'NEW',
  'CREATED',
  'READY_TO_SHIP',
] as const;
