/**
 * Form.notes alanı içindeki teknik referans satırlarını yönetmek için ortak util'ler.
 *
 * Bayilik başvuru (Form type=APPLICATION) akışında backend, oluşturulan
 * DealerApplication kaydının id'sini `Form.notes` alanına şu formatta yazıyor:
 *
 *     dealerApplicationId=<uuid>
 *
 * Bu satır SADECE backend resolver'ı (dealer.service.ts → findLinkedFormId)
 * için var. Admin panelin "Admin Notu" / "Başvuru Notu" textarea'sında
 * görünmesi istenmiyor. Aynı zamanda admin not kaydederken kaybolmamalı —
 * aksi takdirde backend Form ↔ DealerApplication ilişkisini kuramaz.
 */

const DEALER_APPLICATION_ID_LINE_REGEX = /^dealerApplicationId=.+$/im;

/**
 * Form.notes değerinden teknik `dealerApplicationId=...` satırlarını ayıklar.
 * Müşterinin orijinal mesajı veya admin'in yazdığı dahili notlar olduğu gibi
 * korunur. Boş/null girdi için boş string döner.
 */
export function cleanNote(value?: string | null): string {
  if (!value) return "";
  return value
    .split("\n")
    .filter((line) => !/^dealerApplicationId=/i.test(line.trim()))
    .join("\n")
    .trim();
}

/**
 * Eğer `notes` içinde `dealerApplicationId=<id>` satırı varsa, satırı olduğu
 * gibi döner. Yoksa null döner. Birden fazla varsa ilkini döner — backend
 * zaten bir Form için tek referans yazıyor.
 */
export function extractDealerApplicationIdLine(notes?: string | null): string | null {
  if (!notes) return null;
  const match = notes.match(DEALER_APPLICATION_ID_LINE_REGEX);
  return match ? match[0].trim() : null;
}

/**
 * Admin'in düzenlediği temiz notu, orijinal notes'taki teknik referans satırı
 * ile birleştirir. Token satırı zaten temiz notun içindeyse tekrar eklenmez.
 */
export function mergeNoteWithDealerApplicationIdLine(
  cleanedNote: string,
  originalNotes?: string | null,
): string {
  const tokenLine = extractDealerApplicationIdLine(originalNotes);
  const trimmed = (cleanedNote ?? "").trim();
  if (!tokenLine) {
    return trimmed;
  }
  if (DEALER_APPLICATION_ID_LINE_REGEX.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.length === 0) {
    return tokenLine;
  }
  return `${trimmed}\n${tokenLine}`;
}
