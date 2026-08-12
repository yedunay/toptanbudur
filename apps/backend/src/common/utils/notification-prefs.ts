import type { PrismaService } from '../../prisma/prisma.service';

/**
 * Müşterinin OPSİYONEL sipariş e-posta tercihlerini döner.
 *
 * - `confirm`: "Siparişiniz alındı" onay maili açık mı?
 * - `status` : "hazırlanıyor / sipariş durumu güncellendi" maili açık mı?
 *
 * customerId yoksa (misafir / admin tarafından elle açılan sipariş) tercih kaydı
 * olmadığı için DAİMA `true` döner — yani mevcut davranış korunur, mail kesilmez.
 *
 * ÖNEMLİ: Bu yalnızca OPSİYONEL mailler içindir. İptal/iade, destek, mesaj, şifre,
 * cari/ödeme, bayilik mailleri ZORUNLUDUR ve bu tercihlerden ETKİLENMEZ; o çağrı
 * noktalarında bu yardımcı KULLANILMAZ.
 */
export async function getOrderEmailPrefs(
  prisma: PrismaService,
  customerId: string | null | undefined,
): Promise<{ confirm: boolean; status: boolean }> {
  if (!customerId) return { confirm: true, status: true };
  const c = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { orderConfirmEmailEnabled: true, orderStatusEmailEnabled: true },
  });
  // Kayıt bulunamazsa da güvenli taraf: gönder.
  return {
    confirm: c?.orderConfirmEmailEnabled !== false,
    status: c?.orderStatusEmailEnabled !== false,
  };
}
