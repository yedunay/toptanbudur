export const APP_URLS = {
  storefront: process.env.NEXT_PUBLIC_STOREFRONT_URL || "http://localhost:3001",
  adminLogin:
    process.env.NEXT_PUBLIC_ADMIN_LOGIN_URL ||
    "http://localhost:3002/admin/login",
  admin: process.env.NEXT_PUBLIC_ADMIN_URL || "http://localhost:3002/admin",
} as const;

/**
 * Kurumsal / yasal sayfalar.
 *
 * Bu sayfalar eskiden ayrı bir "landing" uygulamasında (localhost:3000)
 * duruyordu; o uygulama kaldırıldı ve sayfalar storefront'un içine taşındı.
 * Artık HEPSİ iç route — tüketicilerde `<a href>` değil next/link `<Link>`
 * kullanılmalı.
 */
export const LANDING_URLS = {
  home: "/",
  about: "/hakkimizda",
  apply: "/basvuru",
  contact: "/iletisim",
  kvkk: "/kvkk",
  gizlilik: "/gizlilik",
  cerez: "/cerez",
  kullanimSartlari: "/kullanim-sartlari",
  mesafeliSatis: "/mesafeli-satis",
  iadeIptal: "/iade-iptal",
  teslimat: "/teslimat",
} as const;
