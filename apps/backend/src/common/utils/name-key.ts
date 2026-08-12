/**
 * Ürün isim eşleştirme anahtarı — dedup ve auto-route ORTAK kullanır.
 *
 * trim + içerideki tüm whitespace run'larını tek boşluğa indir. Başka HİÇBİR
 * dönüşüm yapılmaz — büyük/küçük harf, noktalama, Türkçe karakterler aynen
 * korunur. Tek harf farkı bile = farklı ürün.
 *
 * KRİTİK: dedup (müşteriye gösterilen kazanan ürün) ile auto-route (en ucuz
 * tedarikçi) BİREBİR aynı anahtarı kullanmak zorunda. Aksi halde dedup'ta aynı
 * sayılan iki ürün auto-route'ta ayrışır ve cross-supplier yönlendirme kaçar.
 * Bu yüzden tek implementasyon burada toplanır; Product.nameKey kolonu da bu
 * fonksiyonla doldurulur.
 */
export function computeNameKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}
