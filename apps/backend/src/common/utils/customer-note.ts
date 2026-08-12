/**
 * Müşteri sipariş notunu (Order.notes) tedarikçi API'lerinin "not/açıklama"
 * alanına yazmak için temizler. Pazaryerinden gelen not çok satırlı ve uzun
 * olabildiği için: tüm boşluk dizileri (satır sonu dâhil) tek boşluğa iner,
 * baş/son kırpılır ve en fazla 400 karaktere sınırlanır (tedarikçi not alanı
 * taşmasın / API reddetmesin). Not yoksa boş string döner — çağıran taraf
 * boşsa nota HİÇ eklemez.
 */
export function sanitizeCustomerNote(notes: string | null | undefined): string {
  return (notes ?? '').replace(/\s+/g, ' ').trim().slice(0, 400);
}
