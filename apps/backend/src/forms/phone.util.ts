/**
 * @deprecated — module-local phone helper. Yerine
 *   `src/common/utils/phone.ts` -> `normalizeTrPhone` kullanın.
 *
 * Geriye dönük uyumluluk için eski isim korunup yeni implementasyona delege
 * ediliyor. Yeni doğrulama "5 ile başlayan 10 hane" zorunluluğu getirir;
 * sadece rakam saymak yetmez.
 */
export { normalizeTrPhone as normalizePhoneTr } from '../common/utils/phone';
