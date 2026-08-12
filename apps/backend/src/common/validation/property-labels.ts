/**
 * Property name → Türkçe etiket sözlüğü.
 *
 * class-validator hata mesajlarında kullanılan alan adlarını
 * (örn. `email`, `firstName`, `customer.address.line1`) son kullanıcıya
 * gösterilecek Türkçe etiketlere dönüştürmek için kullanılır.
 *
 * Path tabanlı eşleşme yoktur: yalnızca son segment ("leaf" property name)
 * dikkate alınır. Örneğin `customer.address.line1` için `line1` aranır.
 *
 * Sözlükte yoksa orijinal property adı olduğu gibi gösterilir
 * (geliştirici açısından log'larda alan adı kaybolmasın diye).
 */
export const PROPERTY_LABELS_TR: Readonly<Record<string, string>> = {
  // Kimlik / iletişim
  email: 'e-posta',
  phone: 'telefon',
  password: 'şifre',
  newPassword: 'yeni şifre',
  oldPassword: 'mevcut şifre',
  currentPassword: 'mevcut şifre',
  passwordConfirm: 'şifre tekrarı',
  confirmPassword: 'şifre tekrarı',
  username: 'kullanıcı adı',
  name: 'ad soyad',
  firstName: 'ad',
  lastName: 'soyad',
  fullName: 'ad soyad',

  // Adres
  address: 'adres',
  line1: 'adres satırı 1',
  line2: 'adres satırı 2',
  city: 'şehir',
  district: 'ilçe',
  state: 'il',
  province: 'il',
  postalCode: 'posta kodu',
  zipCode: 'posta kodu',
  country: 'ülke',
  countryCode: 'ülke kodu',

  // Şirket / ticari bilgiler
  companyName: 'şirket adı',
  company: 'şirket',
  taxNumber: 'vergi numarası',
  vergiNo: 'vergi numarası',
  taxOffice: 'vergi dairesi',
  vergiDairesi: 'vergi dairesi',
  tckn: 'TC kimlik numarası',
  tcKimlikNo: 'TC kimlik numarası',

  // Finans
  iban: 'IBAN',
  bankName: 'banka adı',
  accountHolder: 'hesap sahibi',
  amount: 'tutar',
  totalAmount: 'toplam tutar',
  price: 'fiyat',
  currency: 'para birimi',
  paymentMethod: 'ödeme yöntemi',
  cardNumber: 'kart numarası',
  cvv: 'CVV',
  expiryDate: 'son kullanma tarihi',

  // Sipariş / ürün
  customer: 'müşteri',
  customerId: 'müşteri',
  items: 'ürünler',
  item: 'ürün',
  product: 'ürün',
  productSlug: 'ürün',
  productId: 'ürün',
  qty: 'adet',
  quantity: 'adet',
  stock: 'stok',
  sku: 'stok kodu',
  barcode: 'barkod',
  category: 'kategori',
  description: 'açıklama',
  title: 'başlık',
  slug: 'kısa ad',
  tenantSlug: 'kiracı kısa adı',
  tenantName: 'kiracı adı',

  // Form / mesaj
  subject: 'konu',
  message: 'mesaj',
  note: 'not',
  notes: 'notlar',
  comment: 'yorum',
  reason: 'sebep',

  // Sayfalama
  limit: 'limit',
  offset: 'offset',
  page: 'sayfa',
  pageSize: 'sayfa boyutu',
  take: 'limit',
  skip: 'offset',

  // Diğer
  url: 'URL',
  website: 'web sitesi',
  date: 'tarih',
  startDate: 'başlangıç tarihi',
  endDate: 'bitiş tarihi',
  birthDate: 'doğum tarihi',
  status: 'durum',
  role: 'rol',
  type: 'tür',
  id: 'kimlik',
  token: 'jeton',
  code: 'kod',
  otp: 'doğrulama kodu',
  acceptTerms: 'şartların kabulü',
  acceptKvkk: 'KVKK onayı',
  kvkkConsent: 'KVKK onayı',
};

/**
 * Verilen property path'i için Türkçe etiket döndürür.
 * Path örnekleri: `email`, `customer.address.line1`, `items.0.qty`.
 *
 * Sayısal segmentler (`items.0.qty` içindeki `0`) atlanır; son non-numeric
 * segment etiket olarak kullanılır.
 */
export function getTurkishLabel(path: string): string {
  if (!path) return path;
  const segments = path.split('.').filter((s) => s && !/^\d+$/.test(s));
  const leaf = segments[segments.length - 1] ?? path;
  return PROPERTY_LABELS_TR[leaf] ?? leaf;
}
