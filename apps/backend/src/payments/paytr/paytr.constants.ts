/**
 * PayTR servis uçları — paytr.md (resmî PayTR entegrasyon dökümanı) ile birebir.
 *
 *  - iFrame API 1. Adım : POST get-token → iframe_token
 *  - iFrame ödeme formu : https://www.paytr.com/odeme/guvenli/{token}
 *  - iFrame API 2. Adım : PayTR → Bildirim URL (bizim callback endpoint'imiz)
 *  - Durum Sorgu        : POST odeme/durum-sorgu (merchant_oid ile)
 *  - İşlem Dökümü       : POST rapor/islem-dokumu (en fazla 3 günlük aralık)
 *  - Ödeme Dökümü       : POST rapor/odeme-dokumu (en fazla 31 günlük aralık)
 */
export const PAYTR_URLS = {
  getToken: 'https://www.paytr.com/odeme/api/get-token',
  iframeBase: 'https://www.paytr.com/odeme/guvenli',
  statusQuery: 'https://www.paytr.com/odeme/durum-sorgu',
  transactionReport: 'https://www.paytr.com/rapor/islem-dokumu',
  paymentReport: 'https://www.paytr.com/rapor/odeme-dokumu/',
} as const;

/** SECRET_REGISTRY anahtarları (secrets.service.ts) */
export const PAYTR_SECRET_KEYS = {
  merchantId: 'paytr.merchantId',
  merchantKey: 'paytr.merchantKey',
  merchantSalt: 'paytr.merchantSalt',
} as const;

/** PosProvider.key — PayTR kaydı (migration seed'i ile birebir) */
export const PAYTR_PROVIDER_KEY = 'paytr';

/** İşlem dökümü servisi en fazla 3 günlük aralık kabul eder (doc §13). */
export const TRANSACTION_REPORT_MAX_DAYS = 3;
/** Ödeme dökümü servisi en fazla 31 günlük aralık kabul eder (doc §14). */
export const PAYMENT_REPORT_MAX_DAYS = 31;
