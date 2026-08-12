/**
 * Türkiye telefon numaralarını esnek biçimde kabul edip
 * E.164 (+90XXXXXXXXXX) formatına normalize eder.
 *
 * Kabul edilen biçimler (boşluk / parantez / tire / nokta / non-breaking space
 * gibi her türlü ayraç desteklenir):
 *   - +90 5XX XXX XX XX (cep)
 *   - 0090 5XX... / 90 5XX... / 0 5XX... / 5XX XXX XX XX
 *   - +90 2XX...XX / 0212 XXX... / 312 XXX... (sabit hat)
 *
 * Geçerli numarada ülke kodu çıkarıldıktan sonra kalan 10 hane 2-9 arası bir
 * rakamla başlamalıdır (TR alan kodları). 1 ile başlayan kısa hatlar veya
 * 0 ile başlayan çağrı önekleri reddedilir. Geçersiz girdi `null` döner.
 *
 * KÖK SEBEP: Daha önce sadece "5" ile başlayan cep numaraları kabul ediliyordu.
 * Bu yüzden form gönderiminde sabit hat girenler "Talebiniz iletilemedi" hatası
 * alıyordu. Şimdi cep VE sabit hat ikisi de kabul ediliyor.
 */
export function normalizeTrPhone(input: string | null | undefined): string | null {
  if (!input) return null;

  // Hem rakamları hem '+' karakterini koru, geri kalan her şeyi at.
  // Önce yaygın ayraçları (boşluk, tire, parantez, nokta, vb.) çıkar.
  const digits = String(input)
    .replace(/[^\d+]/g, '');

  let core: string;
  if (digits.startsWith('+90')) {
    core = digits.slice(3);
  } else if (digits.startsWith('0090')) {
    core = digits.slice(4);
  } else if (digits.startsWith('90') && digits.length === 12) {
    core = digits.slice(2);
  } else if (digits.startsWith('0') && digits.length === 11) {
    core = digits.slice(1);
  } else if (/^\d{10}$/.test(digits)) {
    core = digits;
  } else {
    return null;
  }

  // TR alan kodları 2-9 arası başlar. (5XX cep, 2XX-4XX/8XX/9XX sabit, 7XX kurumsal)
  // 0 veya 1 ile başlayan numaralar (kısa hat / önek) kabul edilmez.
  if (!/^[2-9]\d{9}$/.test(core)) return null;
  return `+90${core}`;
}

/**
 * `normalizeTrPhone` ile aynı kuralları kullanır, yalnızca geçerli/geçersiz
 * sonucunu döner. DTO validation için yardımcı.
 */
export function isValidTrPhone(input: string | null | undefined): boolean {
  return normalizeTrPhone(input) !== null;
}
