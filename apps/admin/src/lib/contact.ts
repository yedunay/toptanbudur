/**
 * Tek merkez: tüm admin SPA'da görüntülenen / link verilen iletişim bilgisi.
 * Hardcoded numara/email yerine bu sabiti kullan.
 *
 * - phoneDisplay  → kullanıcıya gösterim (TR formatlı)
 * - phoneE164     → tel: link için E.164
 * - whatsappNumber→ wa.me/<rakamlar> için (başında + olmadan)
 * - email         → mailto: link
 */
export const CONTACT = {
  phoneDisplay: "+90 850 000 00 00",
  phoneE164: "+908500000000",
  whatsappNumber: "908500000000",
  email: "info@toptanbudur.com",
} as const;

export type ContactInfo = typeof CONTACT;

/** tel: link döndürür. Boş telefon için null. */
export function telLink(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d+]/g, "");
  if (!digits) return null;
  return `tel:${digits.startsWith("+") ? digits : `+${digits}`}`;
}

/** https://wa.me/<digits> link. Boş telefon için null. */
export function waLink(phone: string | null | undefined, text?: string): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (!digits) return null;
  const qs = text ? `?text=${encodeURIComponent(text)}` : "";
  return `https://wa.me/${digits}${qs}`;
}
