import { API_BASE, TENANT_SLUG } from "@/lib/api";

/**
 * "Kendim İçin" (marketplace='self') siparişlerde sipariş toplamına eklenen
 * SABİT kargo bedeli (TL). Backend'in `pricing.selfCargoFee` ayarı ile aynı
 * varsayılan — yalnızca ÖNİZLEME içindir; kesin tutarı backend hesaplar.
 */
export const SELF_CARGO_FEE = 200;

/**
 * Yeni sipariş numarası formatı: `61` prefix + 6-8 haneli sequence
 * (örn. 6100001234). Eski / legacy formatlı kayıtlar için fallback davranışı
 * `formatOrderNo()` içinde uygulanır — regex tutmasa bile string yine de döner.
 */
export const HUMAN_ORDER_NO_REGEX = /^61\d{6,8}$/;

/**
 * Sipariş numarası gösterim yardımcısı.
 * - Yeni format ise normalize edilmiş değer döner.
 * - Boş ise verilen `fallback` döner (genelde id slice'ı).
 * - Eski format ise olduğu gibi gösterilir (backward compatible).
 */
export function formatOrderNo(
  humanOrderNo: string | null | undefined,
  fallback: string,
): string {
  const value = humanOrderNo?.trim();
  if (value && HUMAN_ORDER_NO_REGEX.test(value)) return value;
  if (value && value.length > 0) return value;
  return fallback;
}

export interface OrderAddress {
  line1: string;
  /** "Kendim İçin" (self) dışında zorunlu; self'te il adı gönderilir. */
  city?: string;
  /** İlçe — "Kendim İçin" (self) siparişte zorunlu (Basit Kargo client.town). */
  district?: string;
  postalCode?: string;
  country: string;
}

export interface OrderCustomer {
  name: string;
  email: string;
  phone: string;
  address: OrderAddress;
}

export interface OrderItemInput {
  productSlug: string;
  qty: number;
}

export interface OrderRequest {
  tenantSlug: string;
  items: OrderItemInput[];
  customer: OrderCustomer;
  /**
   * Ödeme yöntemi:
   *   - 'card'         → online kart akışı (varsayılan)
   *   - 'cari_balance' → müşterinin cari bakiyesinden anında düşüm
   *                      (yalnızca login'li müşteri + yeterli bakiye varsa).
   */
  paymentMethod?: "card" | "cari_balance";
  /** Kargo şirketi — "Kendim İçin" (self) dışında zorunlu. */
  cargoCompany?: "ARAS" | "SURAT" | "PTT" | "DHL" | "YURTICI";
  /** Kargo barkodu — alfanumerik, 4–64 karakter; self dışında zorunlu. */
  cargoBarcode?: string;
  /** Satış kanalı (zorunlu) — backend MARKETPLACE_VALUES ile aynı. */
  marketplace: "self" | "other";
  /** Tedarikçi PDF signed URL — supplier.requiresPdf=true ise zorunlu. */
  pdfUrl?: string;
  /** Tedarikçi PDF kalıcı object key — admin paneli URL'i bu key'den taze imzalar. */
  pdfKey?: string;
  /** Sipariş notu (opsiyonel, maks 200 karakter). */
  orderNote?: string;
  /**
   * Müşteri ismi — Bayi'nin KENDİ son müşterisinin adı (`customer.name`
   * teslimat/bayi adıyla karışmaz). "Kendim İçin" (self) dışında zorunlu.
   */
  endCustomerName?: string;
}

export interface InsufficientItem {
  slug: string;
  available: number;
}

export interface OrderSuccess {
  orderId: string;
  token: string;
  total: number;
  currency: string;
  status: string;
  /**
   * Kartlı ödemede her şey dahil toplam üzerinden hesaplanan kart komisyonu
   * (backend snapshot'ı). Cari ödemede null/yok.
   */
  cardCommissionAmount?: number | null;
  /** Karttan çekilecek nihai tutar (total + cardCommissionAmount). */
  chargedTotal?: number;
}

export type OrderResult =
  | { ok: true; data: OrderSuccess }
  | {
      ok: false;
      status: number;
      insufficient?: InsufficientItem[];
      message?: string;
      /**
       * Backend tarafından gönderilen tip kodu (örn. "MULTI_SUPPLIER_CART",
       * "CARRIER_CONFLICT"). UI bu koda bakıp kullanıcıyı sepete yönlendirir.
       */
      code?: string;
      /** MULTI_SUPPLIER_CART için: kaç pakete bölündüğü. */
      packageCount?: number;
    };

export async function createOrder(input: Omit<OrderRequest, "tenantSlug">): Promise<OrderResult> {
  try {
    const res = await fetch(`${API_BASE}/orders`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ tenantSlug: TENANT_SLUG, ...input }),
    });

    if (res.ok) {
      const data = (await res.json()) as OrderSuccess;
      return { ok: true, data };
    }

    if (res.status === 422) {
      const body = (await res.json().catch(() => null)) as
        | {
            insufficient?: InsufficientItem[];
            message?: string;
            code?: string;
            packageCount?: number;
          }
        | null;
      return {
        ok: false,
        status: 422,
        insufficient: body?.insufficient ?? [],
        message: body?.message,
        code: body?.code,
        packageCount: body?.packageCount,
      };
    }

    const body = await res.json().catch(() => null);
    return {
      ok: false,
      status: res.status,
      message:
        (body && typeof body === "object" && "message" in body
          ? String((body as { message?: unknown }).message ?? "")
          : "") || "Sipariş oluşturulamadı",
    };
  } catch {
    return { ok: false, status: 0, message: "Ağ hatası — lütfen tekrar deneyin" };
  }
}

export interface OrderItemView {
  slug: string;
  name: string;
  qty: number;
  price: number;
  currency?: string;
  image?: string | null;
}

export interface OrderDetail {
  order: {
    id: string;
    /** İnsan-okur sipariş no (61...). UUID (`id`) müşteriye gösterilmez. */
    humanOrderNo?: string | null;
    total: number;
    subtotal?: number | null;
    kdvAmount?: number | null;
    kdvRate?: number | null;
    /** Paketleme ücreti (KDV-hariç) — snapshot. */
    packagingCost?: number | null;
    /** Sipariş anındaki birim başı paketleme ücreti. */
    packagingUnitFee?: number | null;
    currency: string;
    status: string;
    createdAt?: string;
    /** Ödeme türü — 'card' | 'cari_balance' (snapshot). */
    paymentType?: string | null;
    /** Kart komisyon oranı (%) — Decimal string olarak serileşir. */
    cardCommissionRate?: string | number | null;
    /** Kart komisyon tutarı — yalnızca kartlı ödemede dolu. */
    cardCommissionAmount?: number | null;
    /** Cari ödeme öncesi bakiye (yalnızca cari_balance ödemede dolu). */
    cariPreviousBalance?: number | null;
    /** Cari ödeme sonrası kalan bakiye. */
    cariNewBalance?: number | null;
    /** Cariden düşülen tutar (= sipariş tutarı). */
    cariDeducted?: number | null;
    /** Satış kanalı (self/other) — onay ekranı rozeti için. */
    marketplace?: string | null;
    /** Kargo firması kodu (ARAS/SURAT/PTT/DHL/YURTICI) — bayi onayı için. */
    cargoCompany?: string | null;
    /** Bayinin girdiği kargo barkodu — bayi "doğru girdim mi?" kontrolü için. */
    cargoBarcode?: string | null;
    /** Kargo takip numarası (varsa). */
    trackingNumber?: string | null;
    /** Müşteri ismi — Bayi'nin kendi son müşterisi (teslimat adıyla karışmaz). */
    endCustomerName?: string | null;
    customer?: OrderCustomer;
  };
  items: OrderItemView[];
}

export interface CargoBarcodeMatch {
  id: string;
  humanOrderNo: string | null;
  status: string;
  marketplace: string | null;
  cargoCompany: string | null;
  cargoBarcode: string | null;
  trackingNumber: string | null;
  endCustomerName: string | null;
  createdAt: string;
}

export interface CargoBarcodeDuplicate {
  matches: CargoBarcodeMatch[];
}

/**
 * Müşterinin kendi geçmiş siparişlerinde aynı kargo barkodu daha önce
 * kullanılmış mı diye sessizce kontrol eder. UI akışı bu çağrıya GÖRE
 * değişmez — buton metni / disabled durumu hep aynı kalır. Sadece eşleşme
 * varsa popup açılır.
 *
 * Hata / oturum yoksa boş dizi döner — duplicate check fail-open çalışır,
 * yani ödeme akışını ASLA engellemez.
 */
export async function checkCargoBarcodeDuplicate(
  barcode: string,
): Promise<CargoBarcodeDuplicate> {
  const value = barcode.trim();
  if (value.length < 3) return { matches: [] };
  try {
    const res = await fetch(
      `${API_BASE}/me/orders/check-cargo-barcode?barcode=${encodeURIComponent(value)}`,
      {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json" },
        cache: "no-store",
      },
    );
    if (!res.ok) return { matches: [] };
    const data = (await res.json()) as CargoBarcodeDuplicate | null;
    if (!data || !Array.isArray(data.matches)) return { matches: [] };
    return data;
  } catch {
    return { matches: [] };
  }
}

/**
 * Checkout PDF ön-kontrolü. Sepet slug+adetlerini backend'e verir; PDF'in
 * VİTRİN değil GERÇEK (daha ucuz override) alım tedarikçisine göre gerekip
 * gerekmediğini döner (bkz. #61003950). Salt bilgi amaçlı — asıl zorunluluğu
 * backend `create()` yine dayatır. Hata/oturumsuz → `false` (eski davranış).
 */
export async function fetchCheckoutPolicy(
  items: Array<{ slug: string; qty: number }>,
  marketplace?: string,
): Promise<{ requiresPdf: boolean }> {
  const clean = items.filter((i) => i.slug && i.qty > 0);
  if (clean.length === 0) return { requiresPdf: false };
  try {
    const res = await fetch(`${API_BASE}/orders/checkout-policy`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      cache: "no-store",
      body: JSON.stringify({ tenantSlug: TENANT_SLUG, marketplace, items: clean }),
    });
    if (!res.ok) return { requiresPdf: false };
    const data = (await res.json()) as { requiresPdf?: boolean } | null;
    return { requiresPdf: data?.requiresPdf === true };
  } catch {
    return { requiresPdf: false };
  }
}

export async function fetchOrder(
  orderId: string,
  token: string,
): Promise<OrderDetail | null> {
  try {
    const res = await fetch(
      `${API_BASE}/orders/${encodeURIComponent(orderId)}?t=${encodeURIComponent(token)}`,
      {
        headers: { Accept: "application/json" },
        cache: "no-store",
      },
    );
    if (!res.ok) return null;
    return (await res.json()) as OrderDetail;
  } catch {
    return null;
  }
}
