/**
 * Bayi-bayi iade sohbetlerinde karşı tarafın gerçek adı gösterilmez; yalnızca
 * baş harfleri görünür. "Ad Orta Soyad" → "A.O.S."
 *
 * Kurallar:
 *  - Boşluklara göre böl, her kelimenin ilk harfini al.
 *  - Türkçe yerel ayarla büyüt (i→İ, ı→I doğru eşlensin).
 *  - Noktayla birleştir ve sona da nokta ekle.
 *  - Boş / tek kelime durumlarını zarifçe ele al.
 */
export function maskNameToInitials(fullName: string): string {
  if (!fullName) return '';
  const words = fullName
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0);
  if (words.length === 0) return '';

  const initials = words
    .map((word) => {
      // İlk harfi al; surrogate pair riski yok (Türkçe harfler BMP içinde).
      const first = word.charAt(0);
      return first.toLocaleUpperCase('tr-TR');
    })
    .filter((ch) => ch.length > 0);

  if (initials.length === 0) return '';
  return `${initials.join('.')}.`;
}
