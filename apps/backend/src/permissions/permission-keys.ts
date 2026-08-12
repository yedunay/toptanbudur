/**
 * Page permission keys — admin paneldeki "sayfa" kavramının kanonik
 * temsili. Her key bir veya birden fazla route'u kapsayabilir (ör.
 * `orders` hem listeyi hem detay sayfasını kapsar). Bu liste hem
 * backend (RequirePage guard) hem frontend (sidebar + ProtectedRoute)
 * tarafından paylaşılan tek doğruluk kaynağıdır.
 *
 * Yeni bir sayfa eklendiğinde:
 *   1) Buraya yeni key ekle
 *   2) role-templates.ts içinde ADMIN listesine de ekle
 *   3) İlgili controller'a `@RequirePage('<yeni-key>')` koy
 *   4) apps/admin/src/lib/permission-keys.ts dosyasını eşle
 */
export const PAGE_KEYS = [
  'dashboard',
  'products',
  'suppliers',
  'orders',
  'customers',
  'comparisons',
  'cari',
  'banka_bilgileri',
  'pos',
  'makbuzlar',
  'muhasebe_cari_hareketler',
  'muhasebe_tedarikci_hesap',
  'muhasebe_bayi_hesap',
  'muhasebe_kar_dagilimi',
  'mesajlar',
  'popup',
  'karlilik_analizi',
  'loglar',
  'ayarlar_degiskenler',
  'ayarlar_kullanicilar',
  'ayarlar_hesap',
  'ayarlar_fatura',
  'ayarlar_raporlar',
  'bildirimler',
  'depo_stogu',
  // ─── YETENEK ANAHTARLARI (sayfa değil, sayfa İÇİ yetki) ──────────────────
  // Matriste ayrı satır olarak çıkar, varsayılanı KAPALI, patron açabilir.
  'yetki_maliyet_kar',
  'yetki_para_islemleri',
] as const;

export type PageKey = (typeof PAGE_KEYS)[number];

export const PAGE_KEY_SET: ReadonlySet<string> = new Set<string>(PAGE_KEYS);

/**
 * Display labels (Turkish) — UI'da, audit log'da ve hata mesajlarında
 * kullanılır.
 */
export const PAGE_LABELS: Readonly<Record<PageKey, string>> = {
  dashboard: 'Dashboard',
  products: 'Ürünler',
  suppliers: 'Tedarikçiler',
  orders: 'Siparişler',
  customers: 'Müşteriler',
  comparisons: 'Karşılaştırmalar',
  cari: 'Cari',
  banka_bilgileri: 'Banka Bilgileri',
  pos: 'POS Yönetimi',
  makbuzlar: 'Makbuzlar',
  muhasebe_cari_hareketler: 'Muhasebe — Cari Hareketler',
  muhasebe_tedarikci_hesap: 'Muhasebe — Tedarikçi Hesap',
  muhasebe_bayi_hesap: 'Muhasebe — Bayi Hesap',
  muhasebe_kar_dagilimi: 'Muhasebe — Aylık Kâr Dağılımı',
  mesajlar: 'Mesajlar',
  popup: 'Pop-up / Duyurular',
  karlilik_analizi: 'Kârlılık Analizi',
  loglar: 'Loglar',
  ayarlar_degiskenler: 'Ayarlar — Değişkenler',
  ayarlar_kullanicilar: 'Ayarlar — Kullanıcılar',
  ayarlar_hesap: 'Ayarlar — Hesap',
  ayarlar_fatura: 'Ayarlar — Fatura',
  ayarlar_raporlar: 'Ayarlar — Raporlar',
  bildirimler: 'Bildirim Merkezi',
  depo_stogu: 'Depo Stoğu',
  yetki_maliyet_kar: '⚙ Yetki — Maliyet & Kâr Görebilir',
  yetki_para_islemleri: '⚙ Yetki — Para İşlemi Yapabilir',
};

export function isValidPageKey(key: string): key is PageKey {
  return PAGE_KEY_SET.has(key);
}
