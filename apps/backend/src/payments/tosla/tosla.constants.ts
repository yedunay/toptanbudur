/**
 * TOSLA İşim (AKÖDE) sanal POS servis uçları — tosla.md dökümanı ile birebir.
 *
 *  - Ödeme başlatma : POST {base}threeDPayment → ThreeDSessionId (3D session)
 *  - Ortak ödeme     : GET  {base}threeDSecure/{ThreeDSessionId} (iframe)
 *  - Callback        : TOSLA → bizim CallbackUrl'imize POST eder (per-request)
 *  - Sorgulama       : POST {base}inquiry (orderId ile)
 *  - İptal (void)    : POST {base}void   (gün sonu öncesi)
 *  - İade (refund)   : POST {base}refund (gün sonu sonrası, kısmi/tam)
 *
 * Base URL testMode ile seçilir (PosProvider.testMode):
 *  - test : prepentegrasyon.tosla.com
 *  - prod : entegrasyon.tosla.com
 *
 * İstek hash'i her çağrıda: base64(SHA512(apiPass + clientId + apiUser + rnd + timeSpan)).
 * Kart verisi bu sisteme HİÇ girmez — kart formu TOSLA ortak ödeme sayfasında açılır.
 */
export const TOSLA_URLS = {
  test: 'https://prepentegrasyon.tosla.com/api/Payment/',
  prod: 'https://entegrasyon.tosla.com/api/Payment/',
} as const;

/** testMode → doğru base URL. */
export function toslaBaseUrl(testMode: boolean): string {
  return testMode ? TOSLA_URLS.test : TOSLA_URLS.prod;
}

/** SECRET_REGISTRY anahtarları (secrets.service.ts) */
export const TOSLA_SECRET_KEYS = {
  clientId: 'tosla.clientId',
  apiUser: 'tosla.apiUser',
  apiPass: 'tosla.apiPass',
} as const;

/** PosProvider.key — TOSLA kaydı (seed migration ile birebir) */
export const TOSLA_PROVIDER_KEY = 'tosla';

/** TL para birimi kodu (ISO 4217 numeric). */
export const TOSLA_CURRENCY_TRY = 949;
