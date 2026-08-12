/**
 * Tek merkezden iletişim bilgileri.
 *
 * Tüm UI bileşenleri (Header, Footer, WhatsAppFloating, vs.) telefon /
 * e-posta gibi bilgileri buradan okur. Numara değişirse tek bir yer güncellenir.
 *
 * `process.env.NEXT_PUBLIC_*` değerleri verilirse onlar önceliklidir; aksi
 * halde aşağıdaki varsayılanlar kullanılır.
 */

const env = (key: string): string =>
  (typeof process !== "undefined" && process.env[key]) || "";

const RAW_WHATSAPP = env("NEXT_PUBLIC_WHATSAPP_NUMBER");

const RAW_PHONE_E164 = env("NEXT_PUBLIC_CONTACT_PHONE_E164");

const RAW_PHONE_DISPLAY = env("NEXT_PUBLIC_CONTACT_PHONE_DISPLAY");

const RAW_EMAIL = env("NEXT_PUBLIC_CONTACT_EMAIL") || "info@toptanbudur.com";

export const CONTACT = {
  /** İnsan-okunur telefon numarası (boşluklu). Tanımlı değilse boş string. */
  phoneDisplay: RAW_PHONE_DISPLAY,
  /** E.164 formatında telefon (tel: bağlantıları için). Tanımlı değilse boş. */
  phoneE164: RAW_PHONE_E164,
  /** WhatsApp için (sadece rakam, başında 0 yok). Tanımlı değilse boş. */
  whatsappNumber: RAW_WHATSAPP.replace(/[^\d]/g, ""),
  /** Müşteri iletişim e-postası */
  email: RAW_EMAIL,
} as const;

/** WhatsApp wa.me linki — mesaj parametresi opsiyonel. */
export function whatsappLink(message?: string): string {
  const base = `https://wa.me/${CONTACT.whatsappNumber}`;
  if (!message) return base;
  return `${base}?text=${encodeURIComponent(message)}`;
}

/**
 * Resmi şirket künyesi — vergi levhası ve MERSİS kayıtlarıyla birebir olmalı.
 * Footer ve yasal bilgilendirme alanlarında gösterilir (sanal POS zorunluluğu).
 *
 * ⚠️ Bu değerler UYDURULAMAZ. Ticaret unvanı / VKN / MERSİS / açık adres
 * müşteriden alınıp `NEXT_PUBLIC_COMPANY_*` env değişkenleriyle verilmelidir.
 * Değer verilmediği sürece footer künye satırı hiç render edilmez.
 */
export const COMPANY = {
  /** Vergi levhasındaki ticaret unvanı */
  legalName: env("NEXT_PUBLIC_COMPANY_LEGAL_NAME"),
  /** Tescilli marka / işletme adı */
  brand: "Toptan Budur",
  /** Açık adres */
  address: env("NEXT_PUBLIC_COMPANY_ADDRESS"),
  /** MERSİS numarası */
  mersis: env("NEXT_PUBLIC_COMPANY_MERSIS"),
  /** Vergi dairesi */
  taxOffice: env("NEXT_PUBLIC_COMPANY_TAX_OFFICE"),
  /** Vergi kimlik numarası (VKN) */
  taxNumber: env("NEXT_PUBLIC_COMPANY_TAX_NUMBER"),
  /** Web sitesi */
  website: "www.toptanbudur.com",
} as const;

/** Künye satırı için: yasal bilgiler env'den gelmediyse hiç gösterme. */
export const HAS_COMPANY_REGISTRY =
  COMPANY.legalName !== "" &&
  COMPANY.taxNumber !== "" &&
  COMPANY.mersis !== "";
