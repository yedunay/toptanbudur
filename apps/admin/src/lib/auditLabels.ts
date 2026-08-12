/**
 * Human-friendly Turkish labels for audit log action enums.
 * Falls back to a title-cased version of the enum if not mapped.
 */

const STATIC_LABELS: Record<string, string> = {
  // Auth — admin
  LOGIN: "Yönetici girişi",
  LOGIN_SUCCESS: "Yönetici girişi başarılı",
  LOGIN_FAILED: "Hatalı yönetici giriş denemesi",
  LOGOUT: "Yönetici çıkışı",
  PASSWORD_CHANGE: "Şifre değiştirildi",
  PASSWORD_RESET: "Şifre sıfırlandı",

  // Auth — customer
  CUSTOMER_LOGIN: "Müşteri girişi",
  CUSTOMER_LOGIN_FAILED: "Hatalı müşteri giriş denemesi",
  CUSTOMER_LOGOUT: "Müşteri çıkışı",
  CUSTOMER_REGISTER: "Müşteri kaydı",
  CUSTOMER_PROFILE_UPDATE: "Müşteri profili güncellendi",
  CUSTOMER_PASSWORD_CHANGE: "Müşteri şifresi değiştirildi",
  CUSTOMER_ADDRESS_CREATE: "Müşteri adresi eklendi",
  CUSTOMER_ADDRESS_UPDATE: "Müşteri adresi güncellendi",
  CUSTOMER_ADDRESS_DELETE: "Müşteri adresi silindi",
  CUSTOMER_ADDRESS_SET_DEFAULT: "Varsayılan adres değiştirildi",

  // Users
  USER_CREATE: "Kullanıcı eklendi",
  USER_UPDATE: "Kullanıcı güncellendi",
  USER_DELETE: "Kullanıcı silindi",
  USER_ENABLE: "Kullanıcı aktifleştirildi",
  USER_DISABLE: "Kullanıcı pasifleştirildi",

  // Suppliers
  SUPPLIER_CREATE: "Tedarikçi eklendi",
  SUPPLIER_UPDATE: "Tedarikçi güncellendi",
  SUPPLIER_DELETE: "Tedarikçi silindi",
  SUPPLIER_SYNC: "Tedarikçi senkron edildi",
  SUPPLIER_SYNC_TRIGGER: "Tedarikçi senkronu başlatıldı",

  // Products
  PRODUCT_CREATE: "Ürün eklendi",
  PRODUCT_UPDATE: "Ürün güncellendi",
  PRODUCT_DELETE: "Ürün silindi",
  PRODUCT_BULK_UPDATE: "Toplu ürün güncellendi",
  PRODUCT_PRICE_UPDATE: "Ürün fiyatı güncellendi",
  PRODUCT_STOCK_UPDATE: "Ürün stoğu güncellendi",
  PRODUCT_ACTIVATE: "Ürün aktifleştirildi",
  PRODUCT_DEACTIVATE: "Ürün pasifleştirildi",

  // Orders
  ORDER_CREATE: "Sipariş oluşturuldu",
  ORDER_UPDATE: "Sipariş güncellendi",
  ORDER_DELETE: "Sipariş silindi",
  ORDER_STATUS_CHANGE: "Sipariş durumu değişti",
  ORDER_REFUND: "Sipariş iade edildi",

  // Customers
  CUSTOMER_CREATE: "Müşteri eklendi",
  CUSTOMER_UPDATE: "Müşteri güncellendi",
  CUSTOMER_DELETE: "Müşteri silindi",
  CUSTOMER_DISCOUNT_UPDATE: "Müşteri iskontosu güncellendi",

  // Forms / Mesajlar
  FORM_CREATE: "Form gönderildi",
  FORM_UPDATE: "Form güncellendi",
  FORM_DELETE: "Form silindi",
  FORM_HANDLED: "Form işlendi",
  PUBLIC_FORM_SUBMIT: "Ziyaretçi form gönderdi",
  ADMIN_FORM_UPDATE: "Admin formu güncelledi",
  ADMIN_FORM_DELETE: "Admin formu sildi",

  // Leads (geri arama talepleri)
  LEAD_CREATE: "Geri arama talebi alındı",

  // Support messages
  SUPPORT_MESSAGE_CREATE: "Destek talebi oluşturuldu",
  SUPPORT_MESSAGE_UPDATE: "Destek talebi güncellendi",
  SUPPORT_MESSAGE_DELETE: "Destek talebi silindi",
  SUPPORT_MESSAGE_REPLY: "Destek talebi yanıtlandı",
  ADMIN_SUPPORT_REPLY: "Admin destek talebini yanıtladı",
  ADMIN_SUPPORT_UPDATE: "Admin destek talebini güncelledi",
  ADMIN_SUPPORT_DELETE: "Admin destek talebini sildi",
  ADMIN_SUPPORT_ARCHIVE: "Admin destek talebini arşivledi",

  // Dealer applications
  DEALER_APPLY: "Bayilik başvurusu yapıldı",
  DEALER_APPLICATION_CREATE: "Bayilik başvurusu alındı",
  DEALER_APPLICATION_APPROVE: "Bayilik başvurusu onaylandı",
  DEALER_APPLICATION_REJECT: "Bayilik başvurusu reddedildi",
  DEALER_APPLICATION_UNDO: "Bayilik onayı geri alındı",
  DEALER_APPLICATION_PRE_REGISTER: "Bayilik ön kaydı yapıldı",

  // Sync
  SYNC_RUN: "Senkron çalıştırıldı",
  SYNC_FAILED: "Senkron hata aldı",

  // Audit
  AUDIT_RECIPIENTS_UPDATE: "Audit alıcıları güncellendi",
  AUDIT_DIGEST_TEST: "Audit deneme e-postası tetiklendi",
};

const VERB_TR: Record<string, string> = {
  CREATE: "eklendi",
  CREATED: "eklendi",
  ADD: "eklendi",
  UPDATE: "güncellendi",
  UPDATED: "güncellendi",
  EDIT: "güncellendi",
  DELETE: "silindi",
  DELETED: "silindi",
  REMOVE: "silindi",
  ENABLE: "aktifleştirildi",
  ACTIVATE: "aktifleştirildi",
  DISABLE: "pasifleştirildi",
  DEACTIVATE: "pasifleştirildi",
  APPROVE: "onaylandı",
  REJECT: "reddedildi",
  SYNC: "senkron edildi",
  RUN: "çalıştırıldı",
  TRIGGER: "tetiklendi",
  FAILED: "hata aldı",
  SUCCESS: "başarılı",
  HANDLED: "işlendi",
  REPLY: "yanıtlandı",
  REPLIED: "yanıtlandı",
};

const NOUN_TR: Record<string, string> = {
  USER: "Kullanıcı",
  SUPPLIER: "Tedarikçi",
  PRODUCT: "Ürün",
  ORDER: "Sipariş",
  CUSTOMER: "Müşteri",
  FORM: "Form",
  SUPPORT: "Destek",
  MESSAGE: "Mesaj",
  DEALER: "Bayi",
  APPLICATION: "Başvuru",
  CATEGORY: "Kategori",
  AUDIT: "Audit",
  ROLE: "Rol",
  TENANT: "Tenant",
  TOKEN: "Token",
  SYNC: "Senkron",
};

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/[\s_]+/)
    .map((part) => (part.length === 0 ? "" : part[0].toUpperCase() + part.slice(1)))
    .join(" ");
}

/**
 * Returns a Turkish, human-readable label for an audit log action enum.
 * If the action isn't in the static map we attempt a heuristic fallback
 * by translating recognised noun + verb segments; otherwise we return a
 * title-cased version of the enum so it remains readable.
 */
export function actionLabel(action: string | null | undefined): string {
  if (!action) return "—";
  const upper = action.toUpperCase();
  const direct = STATIC_LABELS[upper];
  if (direct) return direct;

  // HTTP-style actions like "POST /admin/x"
  if (/^\s*(GET|POST|PUT|PATCH|DELETE)\s/.test(upper)) {
    return titleCase(action);
  }

  const parts = upper.split("_").filter(Boolean);
  if (parts.length >= 2) {
    const noun = parts.slice(0, -1).map((p) => NOUN_TR[p] ?? p).join(" ");
    const verb = VERB_TR[parts[parts.length - 1]];
    if (verb && noun) {
      return `${noun} ${verb}`;
    }
  }
  return titleCase(action);
}

/**
 * Friendly format for an actor: "Display Name (email)".
 */
export function formatActor(
  name?: string | null,
  email?: string | null,
  id?: string | null,
): string {
  const cleanName = name?.trim();
  const cleanEmail = email?.trim();
  if (cleanName && cleanEmail) {
    const handle = cleanEmail.split("@")[0];
    return `${cleanName} (${handle})`;
  }
  if (cleanName) return cleanName;
  if (cleanEmail) return cleanEmail;
  if (id) return id;
  return "—";
}
