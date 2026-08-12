/**
 * Page permission keys — admin paneldeki erişim kontrolünün tek doğru kaynağı.
 *
 * Bu dosya backend tarafındaki `apps/backend/src/permissions/permission-keys.ts`
 * dosyasının birebir aynısıdır. İki tarafın da senkron kalması gerekir; yeni bir
 * sayfa eklenirken bu dosyaya VE backend'e aynı anda yeni key eklenmeli.
 *
 * Eşleştirme rehberi (frontend rota → key):
 *  - "/"                        → dashboard
 *  - "/products"                → products
 *  - "/suppliers" + alt rotalar → suppliers
 *  - "/orders" + alt rotalar    → orders
 *  - "/customers" + alt rotalar → customers
 *  - "/cari"                    → cari
 *  - "/banka-bilgileri"         → banka_bilgileri
 *  - "/pos"                     → pos
 *  - "/mesajlar"                → mesajlar
 *  - "/karlilik-analizi"        → karlilik_analizi
 *  - "/loglar" + alt rotalar    → loglar
 *  - "/ayarlar/degiskenler"     → ayarlar_degiskenler
 *  - "/ayarlar/kullanicilar"    → ayarlar_kullanicilar
 *  - "/ayarlar/hesap"           → ayarlar_hesap
 */

export const PAGE_KEYS = [
  "dashboard",
  "products",
  "suppliers",
  "orders",
  "customers",
  "comparisons",
  "cari",
  "banka_bilgileri",
  "pos",
  "makbuzlar",
  "muhasebe_cari_hareketler",
  "muhasebe_tedarikci_hesap",
  "muhasebe_bayi_hesap",
  "muhasebe_kar_dagilimi",
  "mesajlar",
  "popup",
  "karlilik_analizi",
  "loglar",
  "ayarlar_degiskenler",
  "ayarlar_kullanicilar",
  "ayarlar_hesap",
  "ayarlar_fatura",
  "ayarlar_raporlar",
  "bildirimler",
  "depo_stogu",
  // Yetenek anahtarları — sayfa değil, sayfa içi yetki (varsayılan kapalı).
  "yetki_maliyet_kar",
  "yetki_para_islemleri",
] as const;

export type PageKey = (typeof PAGE_KEYS)[number];

export const PAGE_LABELS: Readonly<Record<PageKey, string>> = {
  dashboard: "Panel (Anasayfa)",
  products: "Ürünler",
  suppliers: "Tedarikçiler",
  orders: "Siparişler",
  customers: "Müşteriler",
  comparisons: "Karşılaştırmalar",
  cari: "Cari",
  banka_bilgileri: "Banka Bilgileri",
  pos: "POS Yönetimi",
  makbuzlar: "Makbuzlar",
  muhasebe_cari_hareketler: "Muhasebe — Cari Hareketler",
  muhasebe_tedarikci_hesap: "Muhasebe — Tedarikçi Hesap",
  muhasebe_bayi_hesap: "Muhasebe — Bayi Hesap",
  muhasebe_kar_dagilimi: "Muhasebe — Aylık Kâr Dağılımı",
  mesajlar: "Mesajlar & İstekler",
  popup: "Pop-up / Duyurular",
  karlilik_analizi: "Karlılık Analizi",
  loglar: "Loglar",
  ayarlar_degiskenler: "Ayarlar — Değişkenler",
  ayarlar_kullanicilar: "Ayarlar — Kullanıcılar",
  ayarlar_hesap: "Ayarlar — Hesabım",
  ayarlar_fatura: "Ayarlar — Fatura",
  ayarlar_raporlar: "Ayarlar — Raporlar",
  bildirimler: "Bildirim Merkezi",
  depo_stogu: "Depo Stoğu",
  yetki_maliyet_kar: "⚙ Yetki — Maliyet & Kâr Görebilir",
  yetki_para_islemleri: "⚙ Yetki — Para İşlemi Yapabilir",
};

const PAGE_KEY_SET: ReadonlySet<string> = new Set(PAGE_KEYS);

export function isValidPageKey(value: string): value is PageKey {
  return PAGE_KEY_SET.has(value);
}
