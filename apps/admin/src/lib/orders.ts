import { apiFetch } from "./auth";

/**
 * Yeni sipariş numarası formatı: `61` prefix + 6-8 haneli sequence
 * (örn. 6100001234). Eski (legacy) formatlı siparişler için bu regex
 * eşleşmez ve UI fallback gösterir; bu yüzden caller tarafı her zaman
 * `formatOrderNo()` veya doğrudan değeri kullanmalıdır.
 */
export const HUMAN_ORDER_NO_REGEX = /^61\d{6,8}$/;

/**
 * Sipariş numarasını doğrular ve gösterilebilir bir string döndürür.
 * - Yeni format `61xxxxxxxx` ise `#`-li string,
 * - Eski format / boş ise verilen `fallback` (genelde id slice'ı) döner.
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

// NOT: 'awaiting_payment' BİLİNÇLİ olarak burada yok — kartlı ödemenin iç
// ara durumudur; backend admin listesi bu siparişleri hiç döndürmez
// (ödeme alınmadan sipariş "girilmiş" sayılmaz).
export const ORDER_STATUSES = [
  "paid",
  "preparing",
  "shipped",
  "cancelled",
  "refunded",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  paid: "Ödendi",
  preparing: "Hazırlanıyor",
  shipped: "Kargoya Verildi",
  cancelled: "İptal",
  refunded: "İade",
};

/** Sipariş hangi satış kanalından geldi (zorunlu). Backend MARKETPLACE_VALUES
 *  ile birebir aynı — üçüncü taraf pazaryeri markası yok. */
export const ORDER_MARKETPLACES = [
  "other",
  // "Kendim İçin" — bayinin kendisi için verdiği sipariş. Satış kanalı DÜZENLEME
  // dropdown'ında GÖSTERİLMEZ (admin elle 'self' seçmez, backend de kabul etmez);
  // yalnızca görüntüleme (badge/etiket) ve self-mantığı için tanınan değer.
  "self",
] as const;

export type OrderMarketplace = (typeof ORDER_MARKETPLACES)[number];

export const ORDER_MARKETPLACE_LABELS: Record<OrderMarketplace, string> = {
  other: "Diğer Satış Kanalı",
  self: "Kendim İçin",
};

/** Kargo firmaları — Aras, Sürat ve Yurtiçi (Govi Market = Yurtiçi). */
export const CARGO_COMPANIES = ["ARAS", "SURAT", "YURTICI"] as const;

export type CargoCompany = (typeof CARGO_COMPANIES)[number];

export const CARGO_COMPANY_LABELS: Record<CargoCompany, string> = {
  ARAS: "Aras Kargo",
  SURAT: "Sürat Kargo",
  YURTICI: "Yurtiçi Kargo",
};

export interface OrderListItem {
  id: string;
  orderNumber: string;
  /** Pazaryeri tarafındaki / siparişin "insan tarafından okunabilir" numarası. */
  humanOrderNo?: string | null;
  /** Bayi (Customer) kimliği — liste satırında bayi adına tıklayınca
   *  /customers/{customerId} detay sayfasına gitmek için. */
  customerId?: string | null;
  customerName: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  /** Bayi kodu (BAYI-XXXXXX) — tedarikçiye giden export'ta bayi adı yerine kullanılır. */
  bayiNo?: string | null;
  /** Bayinin MANUEL etiketleri (YALNIZ ADMIN). */
  customerTags?: import("./customer-tags").CustomerTag[];
  /** Bayinin OTOMATİK etiketleri (🏆 ayın en çok satanı vb.). */
  customerAutoTags?: import("./customer-tags").AutoTag[];
  /**
   * Müşteri ismi — Bayi'nin KENDİ son müşterisi (her sipariş için farklı).
   * `customerName` teslimat/bayi adıyla karışmaz.
   */
  endCustomerName?: string | null;
  createdAt: string;
  total: number;
  status: OrderStatus;
  trackingNumber?: string | null;
  /**
   * Sipariş notu (müşterinin sipariş verirken yazdığı not). Liste satırında
   * rozet + önizleme çizilir — admin'in detaya girmeden görmesi zorunlu.
   */
  notes?: string | null;
  /**
   * Auto-route yönlendirme notu (ADMIN-ONLY): siparişin hangi kurala göre
   * (kılıf/kırılmaz cam/hafta sonu/fiyat eşiği) hangi tedarikçiye çekildiği.
   * Müşteriye ASLA gösterilmez; yalnız admin liste/detayda.
   */
  dispatchRoutingNote?: string | null;
  marketplace?: OrderMarketplace | null;
  cargoCompany?: CargoCompany | string | null;
  cargoBarcode?: string | null;
  /**
   * Sipariş bazında tedarikçide oluşan sipariş numarası (tek alan, tüm
   * kalemleri kapsar). Eski per-item `supplierOrderNo` artık deprecate.
   */
  supplierOrderNo?: string | null;
  /**
   * Siparişin (R2/MinIO'da) indirilebilir bir PDF'i var mı? Liste tablosunda
   * "PDF" kolonunda ikonu aktif/pasif çizmek için. Taze imzalı URL tıklamada
   * `fetchOrder(id)` ile alınır (liste sorgusu her satır için imza üretmez).
   */
  hasPdf?: boolean;
  /**
   * Sipariş satırlarındaki tedarikçi adları (deduplike).
   * Backend henüz desteklemiyorsa boş dizi döner; UI "—" gösterir.
   */
  supplierNames?: string[];
  /**
   * Sipariş satırlarının özet listesi — admin liste tablosunda
   * thumbnail + ad göstermek için. Backend henüz desteklemiyorsa boş dizi.
   */
  products?: OrderListItemProduct[];
  /**
   * Sipariş içindeki herhangi bir kalem için aynı ürünü daha ucuza sunan
   * alternatif tedarikçi varsa, en büyük tasarruflu kalemin özeti. Yoksa null.
   */
  cheaperSupplierHint?: OrderCheaperSupplierHint | null;
  /**
   * En az bir kalem henüz elle satın alınmamışsa true → "Manuel alım bekliyor".
   */
  manualPurchasePending?: boolean;
}

export interface OrderListItemProduct {
  /** OrderItem.id — inline tedarikçi/sip no güncellemesi için zorunlu. */
  itemId: string;
  /** Product.id — yoksa eligible suppliers fetch edilemez. */
  productId: string | null;
  name: string;
  qty: number;
  imageUrl: string | null;
  /** Tedarikçinin bayiye verdiği sipariş numarası — yoksa null. */
  supplierOrderNo: string | null;
  /** Effective supplier id (override > product.supplierId). */
  supplierId: string | null;
  /** Effective supplier display name. */
  supplierName: string | null;
  /** Effective tedarikçi botsuz + henüz satın alınmamışsa true. */
  manualPurchasePending?: boolean;
}

export interface OrderCheaperSupplierHint {
  productName: string;
  currentSupplierName: string | null;
  cheaperSupplierName: string;
  currentUnitPrice: number;
  cheaperUnitPrice: number;
  /** Sipariş kalemi adetine çarpılmış toplam tasarruf (TRY). */
  saving: number;
  /** Birim fiyat üzerinden yüzde tasarruf (0-100). */
  savingPercent: number;
}

export interface OrderItemSupplier {
  id: string;
  name: string;
  /**
   * Tedarikçinin zorunlu/desteklenen kargo firmaları (boş dizi → kısıtlama
   * yok; serbest seçim). Birden fazla seçildiyse sipariş aşamasında
   * sepetteki tüm tedarikçilerin kesişimi kullanılır.
   */
  mandatoryCarriers?: string[];
  /** Sipariş PDF zorunluluğu — eczane/ilaç tedarikçisi için tipik olarak true. */
  requiresPdf?: boolean | null;
  /** Ortalama tedarik süresi (gün). */
  leadTimeDays?: number | null;
}

export interface OrderItem {
  id: string;
  productId?: string | null;
  /** Storefront katalog slug'ı (ürün adı linkinde kullanılır). */
  productSlug?: string | null;
  productName: string;
  sku?: string | null;
  imageUrl?: string | null;
  quantity: number;
  unitPrice: number;
  total: number;
  /**
   * Sipariş anındaki tedarikçi stok kodu snapshot'ı (ham externalCode).
   * YALNIZCA admin panelinde gösterilir — müşteriye asla gösterilmez.
   */
  supplierSku?: string | null;
  /**
   * Sipariş anındaki tedarikçi barkodu snapshot'ı.
   * YALNIZCA admin panelinde gösterilir — müşteriye asla gösterilmez.
   */
  supplierBarcode?: string | null;
  supplier?: OrderItemSupplier | null;
  /**
   * Bayinin gerçekte alım yaptığı tedarikçi (override). Null ise orijinal
   * `supplier` geçerli; doluysa ciro/cari analizleri bu tedarikçi üzerinden
   * hesaplanır.
   */
  supplierIdOverride?: string | null;
  /** Tedarikçinin bayiye verdiği sipariş numarası (varsa). */
  supplierOrderNo?: string | null;
  /**
   * "Daha ucuz tedarikçi" MANUEL işareti (Yeni Tedarikçi Analizi → "Geçiş Yap").
   * Sadece admin hatırlatması; hiçbir otomasyon yok.
   */
  cheaperHint?: {
    supplierName: string;
    theirCost: number;
    ourCost: number;
    savingPerUnit: number;
    productUrl: string | null;
  } | null;
}

export interface OrderAddress {
  fullName?: string | null;
  phone?: string | null;
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  district?: string | null;
  postalCode?: string | null;
  country?: string | null;
}

export interface OrderTimelineEntry {
  status: OrderStatus;
  at: string;
  note?: string | null;
}

export interface OrderLinkedTicket {
  id: string;
  status: string;
  kind?: string | null;
  category?: string | null;
  subject?: string | null;
  createdAt: string;
}

export interface OrderDetail extends OrderListItem {
  items: OrderItem[];
  shippingAddress?: OrderAddress | null;
  billingAddress?: OrderAddress | null;
  timeline?: OrderTimelineEntry[];
  notes?: string | null;
  subtotal?: number;
  shippingFee?: number;
  /**
   * Paketleme ücreti (KDV-hariç). Siparişe snapshot olarak yazılır;
   * sonraki ücret değişiklikleri eski siparişleri etkilemez.
   */
  packagingCost?: number | null;
  /** Sipariş anındaki birim başı paketleme ücreti snapshot'ı. */
  packagingUnitFee?: number | null;
  /** "Kendim İçin" (self) sabit kargo bedeli — total'a dahildir; diğerinde null. */
  cargoCost?: number | null;
  /**
   * Tedarikçi imzalı sipariş PDF'inin (MinIO/R2) public URL'i.
   * Supplier.requiresPdf=true olan ürünler içeren siparişlerde dolu olur.
   */
  pdfUrl?: string | null;
  /** Bayinin (B2B müşteri) DB kimliği — admin /customers/:id linki için. */
  customerId?: string | null;
  /** Bu siparişe bağlı destek talepleri (kind='order'). */
  supportMessages?: OrderLinkedTicket[];
  /**
   * Konsolide fatura durumu (birfatura.md §11) — sadece admin görür.
   * `invoicedAt` doluysa BirFatura faturayı bu siparişe bağladı (yeşil rozet).
   * `invoiceBatch` doluysa sipariş bir aylık kesime donduruldu; `invoicedAt`
   * boşken "faturaya alındı, bekliyor" durumudur.
   */
  invoicedAt?: string | null;
  invoiceBatchId?: string | null;
  invoiceBatch?: OrderInvoiceBatch | null;
  /**
   * Ödeme tipi — 'card' kartlı tahsilat, 'cari' bakiyeden düşüm.
   * Eski siparişlerde null gelebilir; null = cari kabul edilir.
   */
  paymentType?: string | null;
  /**
   * Kart komisyonu SNAPSHOT'ı — sipariş anındaki site oranı (%).
   * Sadece kartlı siparişte dolu; komisyon `total`'a DAHİL DEĞİLDİR.
   * Karttan çekilen = total + cardCommissionAmount.
   */
  cardCommissionRate?: number | null;
  cardCommissionAmount?: number | null;
  /** Tahsilatın geçtiği POS sağlayıcı key'i (örn. 'paytr') — admin-only. */
  posProviderKey?: string | null;
}

/** Sipariş detayında gösterilen aylık konsolide fatura kesimi özeti. */
export interface OrderInvoiceBatch {
  id: string;
  status: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  orderCode?: string | null;
  birfaturaOrderId?: string | null;
  invoiceUrl?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  invoicedAt?: string | null;
}

export interface OrderFilters {
  page?: number;
  pageSize?: number;
  status?: OrderStatus;
  customer?: string;
  /** Bayiye göre exact filtre (Customer.id). Serbest metin `customer`/`q`'dan
   * bağımsız — bulanık arama son müşteriye de değerken bu yalnız bayiyi süzer. */
  customerId?: string;
  /** Satış kanalına göre filtre (Order.marketplace). Kanonik lowercase değer. */
  marketplace?: string;
  from?: string;
  to?: string;
  /** Tedarikçi ID — tekil filtre (export/legacy). */
  supplierId?: string;
  /**
   * Çoklu tedarikçi seçimi (admin liste multi-select). `supplierId`'yi geçersiz
   * kılar. undefined → filtre yok ("tümü"); boş dizi → "hiçbiri seçili değil"
   * (hiçbir sipariş); ≥1 → yalnız bu tedarikçilerin siparişleri.
   */
  supplierIds?: string[];
  /**
   * Sözde-durum filtresi (gerçek OrderStatus DEĞİL, durum filtresinden
   * bağımsız çalışır):
   *  - `manual_pending` → elle alım bekleyen (bot/Excel dışı tedarikçi)
   *  - `bot_failed`     → bot alamadı (ödenmiş + çözülmemiş başarısız bot işi)
   */
  special?: OrderSpecialFilter;
}

/** Siparişler listesindeki iki tıklanabilir sayaç-çipin filtre değeri. */
export type OrderSpecialFilter = "manual_pending" | "bot_failed";

export interface OrdersStats {
  /** Filtreye uyan TÜM siparişlerin toplam cirosu (sadece görünen sayfa değil). */
  totalRevenue: number;
  today: { count: number; revenue: number };
  yesterday: { count: number; revenue: number };
  /** En çok sipariş veren müşteri (filtreye uyanlar arasında). */
  topCustomer: {
    customerId: string | null;
    name: string;
    orderCount: number;
    revenue: number;
  } | null;
}

export interface OrdersResponse {
  data: OrderListItem[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
  /** Backend stats payload yoksa null. */
  stats: OrdersStats | null;
}

function buildQuery(filters: OrderFilters): string {
  const params = new URLSearchParams();
  if (filters.page) params.set("page", String(filters.page));
  if (filters.pageSize) params.set("pageSize", String(filters.pageSize));
  if (filters.status) params.set("status", filters.status);
  if (filters.customer && filters.customer.trim().length > 0) {
    params.set("q", filters.customer.trim());
  }
  if (filters.customerId) params.set("customerId", filters.customerId);
  if (filters.marketplace) params.set("marketplace", filters.marketplace);
  if (filters.from) params.set("dateFrom", filters.from);
  if (filters.to) params.set("dateTo", filters.to);
  // Çoklu seçim önceliklidir; tanımlıysa (boş dizi dahil) tekil supplierId yerine
  // supplierIds gönderilir. Boş dizi → "supplierIds=" (backend: hiçbiri seçili).
  if (filters.supplierIds !== undefined) {
    params.set("supplierIds", filters.supplierIds.join(","));
  } else if (filters.supplierId) {
    params.set("supplierId", filters.supplierId);
  }
  if (filters.special) params.set("special", filters.special);
  return params.toString();
}

interface RawOrderRow {
  id: string;
  orderNumber?: string | null;
  humanOrderNo?: string | null;
  status?: string | null;
  total?: number | string | null;
  customerId?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  customerTags?: import("./customer-tags").CustomerTag[] | null;
  customerAutoTags?: import("./customer-tags").AutoTag[] | null;
  customerPhone?: string | null;
  bayiNo?: string | null;
  endCustomerName?: string | null;
  trackingNumber?: string | null;
  notes?: string | null;
  /** Auto-route yönlendirme notu (ADMIN-ONLY). Hangi kural hangi tedarikçiye çekti. */
  dispatchRoutingNote?: string | null;
  createdAt?: string | null;
  marketplace?: string | null;
  cargoCompany?: string | null;
  cargoBarcode?: string | null;
  supplierOrderNo?: string | null;
  hasPdf?: boolean | null;
  supplierNames?: string[] | null;
  suppliers?: Array<{ name?: string | null } | string> | null;
  manualPurchasePending?: boolean | null;
  products?: Array<{
    itemId?: string | null;
    productId?: string | null;
    name?: string | null;
    qty?: number | null;
    imageUrl?: string | null;
    supplierOrderNo?: string | null;
    supplierId?: string | null;
    supplierName?: string | null;
    manualPurchasePending?: boolean | null;
  }> | null;
  cheaperSupplierHint?: {
    productName?: string | null;
    currentSupplierName?: string | null;
    cheaperSupplierName?: string | null;
    currentUnitPrice?: number | string | null;
    cheaperUnitPrice?: number | string | null;
    saving?: number | string | null;
    savingPercent?: number | string | null;
  } | null;
}

function toCheaperHint(
  raw: RawOrderRow["cheaperSupplierHint"],
): OrderCheaperSupplierHint | null {
  if (!raw || typeof raw !== "object") return null;
  const cheaperSupplierName =
    typeof raw.cheaperSupplierName === "string" && raw.cheaperSupplierName.length > 0
      ? raw.cheaperSupplierName
      : null;
  const productName =
    typeof raw.productName === "string" && raw.productName.length > 0
      ? raw.productName
      : null;
  if (!cheaperSupplierName || !productName) return null;
  const num = (v: unknown): number =>
    typeof v === "number" ? v : typeof v === "string" ? Number(v) || 0 : 0;
  return {
    productName,
    currentSupplierName:
      typeof raw.currentSupplierName === "string" ? raw.currentSupplierName : null,
    cheaperSupplierName,
    currentUnitPrice: num(raw.currentUnitPrice),
    cheaperUnitPrice: num(raw.cheaperUnitPrice),
    saving: num(raw.saving),
    savingPercent: num(raw.savingPercent),
  };
}

function toOrderNumber(o: RawOrderRow): string {
  if (o.orderNumber && String(o.orderNumber).trim().length > 0) {
    return String(o.orderNumber);
  }
  return o.id.slice(0, 8);
}

function toSupplierNames(o: RawOrderRow): string[] {
  if (Array.isArray(o.supplierNames)) {
    return o.supplierNames.filter((s): s is string => typeof s === "string" && s.length > 0);
  }
  if (Array.isArray(o.suppliers)) {
    return o.suppliers
      .map((s) => (typeof s === "string" ? s : s?.name ?? ""))
      .filter((s): s is string => typeof s === "string" && s.length > 0);
  }
  return [];
}

function normalizeMarketplace(value: string | null | undefined): OrderMarketplace | null {
  if (!value) return null;
  const lower = value.toLowerCase();
  return (ORDER_MARKETPLACES as readonly string[]).includes(lower)
    ? (lower as OrderMarketplace)
    : null;
}

function normalizeOrderRow(o: RawOrderRow): OrderListItem {
  const totalNum =
    typeof o.total === "number"
      ? o.total
      : typeof o.total === "string"
        ? Number(o.total) || 0
        : 0;
  return {
    id: o.id,
    orderNumber: toOrderNumber(o),
    humanOrderNo:
      typeof o.humanOrderNo === "string" && o.humanOrderNo.trim().length > 0
        ? o.humanOrderNo
        : null,
    customerId:
      typeof o.customerId === "string" && o.customerId.length > 0
        ? o.customerId
        : null,
    customerName: o.customerName ?? "",
    customerEmail: o.customerEmail ?? null,
    customerTags: o.customerTags ?? [],
    customerAutoTags: o.customerAutoTags ?? [],
    customerPhone: o.customerPhone ?? null,
    bayiNo:
      typeof o.bayiNo === "string" && o.bayiNo.trim().length > 0 ? o.bayiNo : null,
    endCustomerName: o.endCustomerName ?? null,
    createdAt: o.createdAt ?? new Date().toISOString(),
    total: totalNum,
    status: (o.status ?? "paid") as OrderStatus,
    trackingNumber: o.trackingNumber ?? null,
    notes:
      typeof o.notes === "string" && o.notes.trim().length > 0 ? o.notes.trim() : null,
    dispatchRoutingNote:
      typeof o.dispatchRoutingNote === "string" && o.dispatchRoutingNote.trim().length > 0
        ? o.dispatchRoutingNote.trim()
        : null,
    marketplace: normalizeMarketplace(o.marketplace),
    cargoCompany: o.cargoCompany ?? null,
    cargoBarcode: o.cargoBarcode ?? null,
    supplierOrderNo:
      typeof o.supplierOrderNo === "string" && o.supplierOrderNo.length > 0
        ? o.supplierOrderNo
        : null,
    hasPdf: o.hasPdf === true,
    supplierNames: toSupplierNames(o),
    products: Array.isArray(o.products)
      ? o.products
          .filter(
            (
              p,
            ): p is {
              itemId: string;
              productId?: string | null;
              name: string;
              qty?: number | null;
              imageUrl?: string | null;
              supplierOrderNo?: string | null;
              supplierId?: string | null;
              supplierName?: string | null;
              manualPurchasePending?: boolean | null;
            } =>
              !!p &&
              typeof p.name === "string" &&
              p.name.length > 0 &&
              typeof p.itemId === "string" &&
              p.itemId.length > 0,
          )
          .map((p) => ({
            itemId: p.itemId,
            productId: typeof p.productId === "string" && p.productId.length > 0 ? p.productId : null,
            name: p.name,
            qty: typeof p.qty === "number" ? p.qty : Number(p.qty ?? 0) || 0,
            imageUrl: typeof p.imageUrl === "string" ? p.imageUrl : null,
            supplierOrderNo:
              typeof p.supplierOrderNo === "string" && p.supplierOrderNo.length > 0
                ? p.supplierOrderNo
                : null,
            supplierId:
              typeof p.supplierId === "string" && p.supplierId.length > 0 ? p.supplierId : null,
            supplierName:
              typeof p.supplierName === "string" && p.supplierName.length > 0
                ? p.supplierName
                : null,
            manualPurchasePending: p.manualPurchasePending === true,
          }))
      : [],
    cheaperSupplierHint: toCheaperHint(o.cheaperSupplierHint),
    manualPurchasePending: o.manualPurchasePending === true,
  };
}

interface RawOrdersStats {
  totalRevenue?: number | string | null;
  today?: { count?: number | null; revenue?: number | string | null } | null;
  yesterday?: { count?: number | null; revenue?: number | string | null } | null;
  topCustomer?: {
    customerId?: string | null;
    name?: string | null;
    orderCount?: number | null;
    revenue?: number | string | null;
  } | null;
}

function normalizeStats(raw: unknown): OrdersStats | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as RawOrdersStats;
  const num = (v: unknown): number =>
    typeof v === "number" ? v : typeof v === "string" ? Number(v) || 0 : 0;
  const intOr = (v: unknown): number =>
    typeof v === "number" ? Math.trunc(v) : 0;
  return {
    totalRevenue: num(r.totalRevenue),
    today: {
      count: intOr(r.today?.count),
      revenue: num(r.today?.revenue),
    },
    yesterday: {
      count: intOr(r.yesterday?.count),
      revenue: num(r.yesterday?.revenue),
    },
    topCustomer: r.topCustomer
      ? {
          customerId:
            typeof r.topCustomer.customerId === "string"
              ? r.topCustomer.customerId
              : null,
          name:
            typeof r.topCustomer.name === "string" && r.topCustomer.name.length > 0
              ? r.topCustomer.name
              : "Bilinmiyor",
          orderCount: intOr(r.topCustomer.orderCount),
          revenue: num(r.topCustomer.revenue),
        }
      : null,
  };
}

export async function fetchOrders(filters: OrderFilters = {}): Promise<OrdersResponse> {
  const qs = buildQuery(filters);
  const raw = await apiFetch<unknown>(`/admin/orders${qs ? `?${qs}` : ""}`);

  if (Array.isArray(raw)) {
    const data = (raw as RawOrderRow[]).map(normalizeOrderRow);
    return {
      data,
      meta: { total: data.length, page: 1, pageSize: data.length, totalPages: 1 },
      stats: null,
    };
  }

  if (raw && typeof raw === "object" && "data" in (raw as object)) {
    const env = raw as {
      data?: RawOrderRow[];
      meta?: {
        total?: number;
        page?: number;
        pageSize?: number;
        limit?: number;
        totalPages?: number;
      };
      stats?: unknown;
    };
    const list = Array.isArray(env.data) ? env.data : [];
    const m = env.meta ?? {};
    return {
      data: list.map(normalizeOrderRow),
      meta: {
        total: m.total ?? list.length,
        page: m.page ?? 1,
        pageSize: m.pageSize ?? m.limit ?? list.length,
        totalPages: m.totalPages ?? 1,
      },
      stats: normalizeStats(env.stats),
    };
  }

  return {
    data: [],
    meta: { total: 0, page: 1, pageSize: 0, totalPages: 1 },
    stats: null,
  };
}

interface RawOrderItem {
  id?: string;
  productId?: string | null;
  slug?: string | null;
  productSlug?: string | null;
  productName?: string | null;
  name?: string | null;
  sku?: string | null;
  imageUrl?: string | null;
  qty?: number | null;
  quantity?: number | null;
  unitPrice?: number | string | null;
  price?: number | string | null;
  total?: number | string | null;
  supplierSku?: string | null;
  supplierBarcode?: string | null;
  supplier?: {
    id?: string;
    name?: string | null;
    mandatoryCarriers?: string[] | null;
    requiresPdf?: boolean | null;
    leadTimeDays?: number | null;
  } | null;
  supplierIdOverride?: string | null;
  supplierOrderNo?: string | null;
  cheaperHint?: {
    supplierName?: string | null;
    theirCost?: number | string | null;
    ourCost?: number | string | null;
    savingPerUnit?: number | string | null;
    productUrl?: string | null;
  } | null;
}

interface RawOrderDetail extends RawOrderRow {
  items?: RawOrderItem[] | null;
  shippingAddress?: OrderAddress | null;
  billingAddress?: OrderAddress | null;
  timeline?: OrderTimelineEntry[] | null;
  trackingEvents?: Array<{
    id?: string;
    status?: string;
    description?: string | null;
    location?: string | null;
    occurredAt?: string | Date | null;
  }> | null;
  notes?: string | null;
  subtotal?: number | string | null;
  shippingFee?: number | string | null;
  packagingCost?: number | string | null;
  packagingUnitFee?: number | string | null;
  cargoCost?: number | string | null;
  pdfUrl?: string | null;
  customerId?: string | null;
  supportMessages?: Array<{
    id?: string;
    status?: string | null;
    kind?: string | null;
    category?: string | null;
    subject?: string | null;
    createdAt?: string | Date | null;
  }> | null;
  // Ödeme tipi + kart komisyonu snapshot'ı
  paymentType?: string | null;
  cardCommissionRate?: number | string | null;
  cardCommissionAmount?: number | string | null;
  posProviderKey?: string | null;
  // Konsolide fatura durumu (birfatura.md §11)
  invoicedAt?: string | Date | null;
  invoiceBatchId?: string | null;
  invoiceBatch?: {
    id?: string;
    status?: string | null;
    periodStart?: string | Date | null;
    periodEnd?: string | Date | null;
    orderCode?: string | null;
    birfaturaOrderId?: string | null;
    invoiceUrl?: string | null;
    invoiceNumber?: string | null;
    invoiceDate?: string | Date | null;
    invoicedAt?: string | Date | null;
  } | null;
}

function toNumberOrUndefined(value: number | string | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function normalizeOrderItem(raw: RawOrderItem): OrderItem {
  const qty = raw.qty ?? raw.quantity ?? 0;
  const unit = raw.unitPrice ?? raw.price ?? 0;
  const unitNum =
    typeof unit === "number" ? unit : Number(unit) || 0;
  const totalNum =
    typeof raw.total === "number"
      ? raw.total
      : raw.total !== null && raw.total !== undefined
        ? Number(raw.total) || unitNum * (Number(qty) || 0)
        : unitNum * (Number(qty) || 0);
  const slug =
    typeof raw.productSlug === "string" && raw.productSlug.length > 0
      ? raw.productSlug
      : typeof raw.slug === "string" && raw.slug.length > 0
        ? raw.slug
        : null;
  return {
    id: raw.id ?? "",
    productId:
      typeof raw.productId === "string" && raw.productId.length > 0
        ? raw.productId
        : null,
    productSlug: slug,
    productName: raw.productName ?? raw.name ?? "—",
    sku: raw.sku ?? null,
    imageUrl: raw.imageUrl ?? null,
    quantity: typeof qty === "number" ? qty : Number(qty) || 0,
    unitPrice: unitNum,
    total: totalNum,
    supplierSku: raw.supplierSku ?? null,
    supplierBarcode: raw.supplierBarcode ?? null,
    supplier: raw.supplier
      ? {
          id: raw.supplier.id ?? "",
          name: raw.supplier.name ?? "—",
          mandatoryCarriers: Array.isArray(raw.supplier.mandatoryCarriers)
            ? raw.supplier.mandatoryCarriers.filter(
                (v): v is string => typeof v === "string" && v.length > 0,
              )
            : [],
          requiresPdf: Boolean(raw.supplier.requiresPdf),
          leadTimeDays:
            typeof raw.supplier.leadTimeDays === "number"
              ? raw.supplier.leadTimeDays
              : null,
        }
      : null,
    supplierIdOverride:
      typeof raw.supplierIdOverride === "string" && raw.supplierIdOverride.length > 0
        ? raw.supplierIdOverride
        : null,
    supplierOrderNo:
      typeof raw.supplierOrderNo === "string" && raw.supplierOrderNo.length > 0
        ? raw.supplierOrderNo
        : null,
    cheaperHint: raw.cheaperHint && raw.cheaperHint.supplierName
      ? {
          supplierName: raw.cheaperHint.supplierName,
          theirCost: toNumberOrUndefined(raw.cheaperHint.theirCost) ?? 0,
          ourCost: toNumberOrUndefined(raw.cheaperHint.ourCost) ?? 0,
          savingPerUnit: toNumberOrUndefined(raw.cheaperHint.savingPerUnit) ?? 0,
          productUrl: raw.cheaperHint.productUrl ?? null,
        }
      : null,
  };
}

function toIsoString(value: string | Date | null | undefined): string {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function normalizeOrderDetail(raw: RawOrderDetail): OrderDetail {
  const base = normalizeOrderRow(raw);
  const timelineEntries = Array.isArray(raw.timeline) ? raw.timeline : [];
  const trackingEventsConverted = Array.isArray(raw.trackingEvents)
    ? raw.trackingEvents
        .filter((t) => typeof t.status === "string" && t.status.length > 0)
        .map((t) => ({
          status: t.status as OrderStatus,
          at:
            typeof t.occurredAt === "string"
              ? t.occurredAt
              : t.occurredAt instanceof Date
                ? t.occurredAt.toISOString()
                : "",
          note:
            typeof t.description === "string" && t.description.length > 0
              ? t.description
              : null,
        }))
    : [];
  const timeline = timelineEntries.length > 0 ? timelineEntries : trackingEventsConverted;
  return {
    ...base,
    items: Array.isArray(raw.items) ? raw.items.map(normalizeOrderItem) : [],
    shippingAddress: raw.shippingAddress ?? null,
    billingAddress: raw.billingAddress ?? null,
    timeline,
    notes: raw.notes ?? null,
    subtotal: toNumberOrUndefined(raw.subtotal),
    shippingFee: toNumberOrUndefined(raw.shippingFee),
    packagingCost:
      raw.packagingCost === null || raw.packagingCost === undefined
        ? null
        : toNumberOrUndefined(raw.packagingCost) ?? null,
    packagingUnitFee:
      raw.packagingUnitFee === null || raw.packagingUnitFee === undefined
        ? null
        : toNumberOrUndefined(raw.packagingUnitFee) ?? null,
    cargoCost:
      raw.cargoCost === null || raw.cargoCost === undefined
        ? null
        : toNumberOrUndefined(raw.cargoCost) ?? null,
    pdfUrl: typeof raw.pdfUrl === "string" && raw.pdfUrl.length > 0 ? raw.pdfUrl : null,
    customerId:
      typeof raw.customerId === "string" && raw.customerId.length > 0
        ? raw.customerId
        : null,
    supportMessages: Array.isArray(raw.supportMessages)
      ? raw.supportMessages
          .filter((t) => typeof t.id === "string" && t.id.length > 0)
          .map((t) => ({
            id: t.id as string,
            status: t.status ?? "pending",
            kind: t.kind ?? null,
            category: t.category ?? null,
            subject: t.subject ?? null,
            createdAt: toIsoString(t.createdAt),
          }))
      : [],
    paymentType:
      typeof raw.paymentType === "string" && raw.paymentType.length > 0
        ? raw.paymentType
        : null,
    cardCommissionRate:
      raw.cardCommissionRate === null || raw.cardCommissionRate === undefined
        ? null
        : toNumberOrUndefined(raw.cardCommissionRate) ?? null,
    cardCommissionAmount:
      raw.cardCommissionAmount === null || raw.cardCommissionAmount === undefined
        ? null
        : toNumberOrUndefined(raw.cardCommissionAmount) ?? null,
    posProviderKey:
      typeof raw.posProviderKey === "string" && raw.posProviderKey.length > 0
        ? raw.posProviderKey
        : null,
    invoicedAt: toIsoOrNull(raw.invoicedAt),
    invoiceBatchId:
      typeof raw.invoiceBatchId === "string" && raw.invoiceBatchId.length > 0
        ? raw.invoiceBatchId
        : null,
    invoiceBatch: raw.invoiceBatch
      ? {
          id: raw.invoiceBatch.id ?? "",
          status: raw.invoiceBatch.status ?? "FROZEN",
          periodStart: toIsoOrNull(raw.invoiceBatch.periodStart),
          periodEnd: toIsoOrNull(raw.invoiceBatch.periodEnd),
          orderCode: raw.invoiceBatch.orderCode ?? null,
          birfaturaOrderId: raw.invoiceBatch.birfaturaOrderId ?? null,
          invoiceUrl: raw.invoiceBatch.invoiceUrl ?? null,
          invoiceNumber: raw.invoiceBatch.invoiceNumber ?? null,
          invoiceDate: toIsoOrNull(raw.invoiceBatch.invoiceDate),
          invoicedAt: toIsoOrNull(raw.invoiceBatch.invoicedAt),
        }
      : null,
  };
}

/** Date|string|null → ISO string ya da null (boş string'e düşürmeden). */
function toIsoOrNull(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  const s = String(value);
  return s.length > 0 ? s : null;
}

export async function fetchOrder(id: string): Promise<OrderDetail> {
  const raw = await apiFetch<unknown>(`/admin/orders/${id}`);
  if (raw && typeof raw === "object" && "data" in (raw as object)) {
    const env = raw as { data: RawOrderDetail };
    return normalizeOrderDetail(env.data);
  }
  return normalizeOrderDetail(raw as RawOrderDetail);
}

export interface OrderUpdate {
  status?: OrderStatus;
  trackingNumber?: string;
  notes?: string;
  marketplace?: OrderMarketplace | null;
  cargoCompany?: string | null;
  cargoBarcode?: string | null;
  /** Müşteri ismi — Bayi'nin kendi son müşterisi (teslimat adıyla karışmaz). */
  endCustomerName?: string | null;
  /** Müşteriye status değişim mail'i gönderilsin mi? Varsayılan true. */
  notify?: boolean;
  /**
   * Riskli statü geçişini (iptal/iade'den "diriltme" veya depodan gönderilmiş
   * siparişi 'paid'e çekme) admin onay popup'ında onaylayınca true gönderilir.
   * Backend bu bayrak olmadan riskli geçişi 409 ile reddeder.
   */
  confirmReactivation?: boolean;
}

/**
 * Admin nav badge için: ödenmiş (admin aksiyonu gerektiren) sipariş sayısı.
 * `meta.total` üzerinden gider; pageSize=1 ile tek satır çekilip yalnızca
 * toplam okunur.
 *
 * NOT: `pending` OrderStatus'u kaldırıldı — yeni sipariş artık doğrudan
 * `paid` ile başlar.
 */
async function countOrdersByStatus(
  status: OrderStatus,
  extraFilters?: Omit<OrderFilters, "status" | "page" | "pageSize">,
): Promise<number> {
  try {
    const params = new URLSearchParams();
    params.set("status", status);
    params.set("pageSize", "1");
    if (extraFilters?.customer && extraFilters.customer.trim().length > 0) {
      params.set("q", extraFilters.customer.trim());
    }
    if (extraFilters?.customerId) params.set("customerId", extraFilters.customerId);
    if (extraFilters?.marketplace) params.set("marketplace", extraFilters.marketplace);
    if (extraFilters?.from) params.set("dateFrom", extraFilters.from);
    if (extraFilters?.to) params.set("dateTo", extraFilters.to);
    if (extraFilters?.supplierIds !== undefined) {
      params.set("supplierIds", extraFilters.supplierIds.join(","));
    } else if (extraFilters?.supplierId) {
      params.set("supplierId", extraFilters.supplierId);
    }
    const raw = await apiFetch<unknown>(`/admin/orders?${params.toString()}`);
    if (raw && typeof raw === "object" && "meta" in (raw as object)) {
      const meta = (raw as { meta?: { total?: number } }).meta;
      return typeof meta?.total === "number" ? meta.total : 0;
    }
    return 0;
  } catch {
    return 0;
  }
}

export async function fetchActionableOrdersCount(): Promise<number> {
  return countOrdersByStatus("paid");
}

export type OrderStatusCounts = Record<OrderStatus, number>;

/**
 * OrdersPage filtre chip'leri için: aktif tüm non-status filtreler altında
 * her status için ayrı toplam sayıyı paralel çeker.
 */
export async function fetchOrderStatusCounts(
  extraFilters?: Omit<OrderFilters, "status" | "page" | "pageSize">,
): Promise<OrderStatusCounts> {
  const entries = await Promise.all(
    ORDER_STATUSES.map(async (s) => {
      const n = await countOrdersByStatus(s, extraFilters);
      return [s, n] as const;
    }),
  );
  return entries.reduce<OrderStatusCounts>(
    (acc, [s, n]) => {
      acc[s] = n;
      return acc;
    },
    {
      paid: 0,
      preparing: 0,
      shipped: 0,
      cancelled: 0,
      refunded: 0,
    },
  );
}

/**
 * Sözde-durum sayacı — "Manuel bekliyor" / "Bot alamadı" çipleri için.
 * Yalnız toplam sayı gerekir; pageSize=1 ile meta.total okunur.
 * Sayfadaki diğer filtreler (bayi/tarih/tedarikçi/pazaryeri) korunur ki
 * çipteki sayı ile listede görülen kayıt sayısı tutarlı olsun.
 */
export async function countOrdersBySpecial(
  special: OrderSpecialFilter,
  extraFilters?: Omit<OrderFilters, "status" | "page" | "pageSize" | "special">,
): Promise<number> {
  try {
    const params = new URLSearchParams();
    params.set("special", special);
    params.set("pageSize", "1");
    if (extraFilters?.customer && extraFilters.customer.trim().length > 0) {
      params.set("q", extraFilters.customer.trim());
    }
    if (extraFilters?.customerId) params.set("customerId", extraFilters.customerId);
    if (extraFilters?.marketplace) params.set("marketplace", extraFilters.marketplace);
    if (extraFilters?.from) params.set("dateFrom", extraFilters.from);
    if (extraFilters?.to) params.set("dateTo", extraFilters.to);
    if (extraFilters?.supplierIds !== undefined) {
      params.set("supplierIds", extraFilters.supplierIds.join(","));
    } else if (extraFilters?.supplierId) {
      params.set("supplierId", extraFilters.supplierId);
    }
    const raw = await apiFetch<unknown>(`/admin/orders?${params.toString()}`);
    if (raw && typeof raw === "object" && "meta" in (raw as object)) {
      const meta = (raw as { meta?: { total?: number } }).meta;
      return typeof meta?.total === "number" ? meta.total : 0;
    }
    return 0;
  } catch {
    return 0;
  }
}

export interface OrderUpdateRefundMeta {
  amount: number;
  previousBalance: number;
  newBalance: number;
  customerId: string;
  customerName: string | null;
}

export interface OrderUpdateMeta {
  previousStatus: string;
  nextStatus: string;
  statusChanged: boolean;
  refund: OrderUpdateRefundMeta | null;
}

export interface OrderUpdateResult {
  order: OrderDetail;
  meta: OrderUpdateMeta | null;
}

export async function updateOrder(id: string, patch: OrderUpdate): Promise<OrderDetail> {
  const result = await updateOrderWithMeta(id, patch);
  return result.order;
}

/**
 * Aynı PATCH endpoint'i; envelope'taki `meta` alanını da döndürür.
 * Destek talebi karar paneli, iade sonrası popup'ta "Eski bakiye → Yeni bakiye"
 * göstermek için bu fonksiyonu kullanır.
 */
export async function updateOrderWithMeta(
  id: string,
  patch: OrderUpdate,
): Promise<OrderUpdateResult> {
  const raw = await apiFetch<unknown>(`/admin/orders/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });

  if (raw && typeof raw === "object" && "data" in (raw as object)) {
    const env = raw as { data: RawOrderDetail; meta?: unknown };
    return {
      order: normalizeOrderDetail(env.data),
      meta: normalizeUpdateMeta(env.meta),
    };
  }
  return {
    order: normalizeOrderDetail(raw as RawOrderDetail),
    meta: null,
  };
}

function normalizeUpdateMeta(raw: unknown): OrderUpdateMeta | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const previousStatus = typeof m.previousStatus === "string" ? m.previousStatus : null;
  const nextStatus = typeof m.nextStatus === "string" ? m.nextStatus : null;
  if (!previousStatus || !nextStatus) return null;

  let refund: OrderUpdateRefundMeta | null = null;
  if (m.refund && typeof m.refund === "object") {
    const r = m.refund as Record<string, unknown>;
    if (
      typeof r.amount === "number" &&
      typeof r.previousBalance === "number" &&
      typeof r.newBalance === "number" &&
      typeof r.customerId === "string"
    ) {
      refund = {
        amount: r.amount,
        previousBalance: r.previousBalance,
        newBalance: r.newBalance,
        customerId: r.customerId,
        customerName: typeof r.customerName === "string" ? r.customerName : null,
      };
    }
  }

  return {
    previousStatus,
    nextStatus,
    statusChanged: previousStatus !== nextStatus,
    refund,
  };
}

export async function deleteOrder(id: string): Promise<void> {
  await apiFetch<unknown>(`/admin/orders/${id}`, { method: "DELETE" });
}

export interface CargoBarcodeDuplicate {
  id: string;
  humanOrderNo: string;
  status: string;
  customerName: string | null;
  customerEmail: string | null;
  endCustomerName: string | null;
  cargoCompany: string | null;
  cargoBarcode: string | null;
  trackingNumber: string | null;
  createdAt: string;
}

/**
 * Kaydetmeden önce aynı kargo barkodunun başka bir siparişte kullanılıp
 * kullanılmadığını sorar — eşleşme dönerse UI onay penceresi açar.
 */
export async function checkCargoBarcodeDuplicates(
  barcode: string,
  excludeOrderId?: string | null,
): Promise<CargoBarcodeDuplicate[]> {
  const trimmed = barcode.trim();
  if (trimmed.length === 0) return [];
  const params = new URLSearchParams({ barcode: trimmed });
  if (excludeOrderId) params.set("excludeOrderId", excludeOrderId);
  const raw = await apiFetch<{ matches?: CargoBarcodeDuplicate[] }>(
    `/admin/orders/check-cargo-barcode?${params.toString()}`,
  );
  return Array.isArray(raw?.matches) ? raw.matches : [];
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("tr-TR");
  } catch {
    return String(value);
  }
}

/**
 * Liste tablosu için kısa tarih formatı: "DD.MM HH:MM" (örn. "15.05 23:13").
 * Detay sayfasında `formatDateTime` ile tam timestamp gösterilir.
 */
export function formatShortDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    const d = new Date(value);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return `${dd}.${mm} ${hh}:${mi}`;
  } catch {
    return String(value);
  }
}

// ---------------------------------------------------------------------------
// Toplu sipariş güncelleme
// ---------------------------------------------------------------------------

export const BULK_UPDATE_MAX = 200;

export type BulkUpdateMode = "selected" | "filtered" | "transition";

export interface BulkUpdateFilters {
  status?: OrderStatus;
  customerId?: string;
  supplierId?: string;
  supplierIds?: string[];
  dateFrom?: string;
  dateTo?: string;
  q?: string;
}

export interface BulkUpdateOrdersInput {
  mode: BulkUpdateMode;
  toStatus: OrderStatus;
  /** transition modunda zorunlu — kaynak status. */
  fromStatus?: OrderStatus;
  /** selected modunda zorunlu — seçili sipariş ID'leri. */
  orderIds?: string[];
  /** Müşterilere mail gönderilsin mi? Varsayılan true. */
  notify?: boolean;
  /** Opsiyonel ortak not — audit log'una yazılır. */
  notes?: string;

  // Filtre alanları (mode = 'filtered' veya 'transition' için kullanılır).
  // Backend DTO bunları düz alanlar olarak bekler — nested obje değil.
  status?: OrderStatus;
  customerId?: string;
  supplierId?: string;
  /** Çoklu tedarikçi seçimi — verildiğinde tekil supplierId'yi geçersiz kılar. */
  supplierIds?: string[];
  dateFrom?: string;
  dateTo?: string;
  q?: string;
}

export interface BulkUpdateResult {
  total: number;
  succeeded: string[];
  failed: Array<{ id: string; error: string }>;
}

export async function bulkUpdateOrders(
  input: BulkUpdateOrdersInput,
): Promise<BulkUpdateResult> {
  const raw = await apiFetch<unknown>(`/admin/orders/bulk-update`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  const env =
    raw && typeof raw === "object" && "data" in (raw as object)
      ? (raw as { data: unknown }).data
      : raw;
  const obj = (env ?? {}) as {
    total?: number;
    succeeded?: unknown;
    failed?: unknown;
  };
  const succeeded = Array.isArray(obj.succeeded)
    ? obj.succeeded.filter((v): v is string => typeof v === "string")
    : [];
  const failed = Array.isArray(obj.failed)
    ? obj.failed
        .map((f) => {
          if (!f || typeof f !== "object") return null;
          const r = f as { id?: unknown; error?: unknown };
          if (typeof r.id !== "string") return null;
          return {
            id: r.id,
            error: typeof r.error === "string" ? r.error : "Bilinmeyen hata",
          };
        })
        .filter((v): v is { id: string; error: string } => v !== null)
    : [];
  return {
    total: typeof obj.total === "number" ? obj.total : succeeded.length + failed.length,
    succeeded,
    failed,
  };
}

// ---------------------------------------------------------------------------
// Tedarikçi alternatifi ipuçları (admin-only)
// ---------------------------------------------------------------------------

/**
 * SİPARİŞ-SEVİYESİ tedarikçi kararı (maliyet-vs-maliyet, eşik-bilinçli):
 * - "deliberate" (YEŞİL): alternatif (İtedarik) 0 < diff < threshold daha ucuz →
 *   tedarikçi ilişkisi için BİLİNÇLİ olarak mevcut (TB) tedarikçide kalındı.
 * - "cheaper" (SARI): alternatif eşik kadar+ ucuz (henüz yönlendirilmemiş olabilir).
 * - "none": mevcut zaten en ucuz / alternatif yok / paid değil → mesaj YOK.
 */
export interface SupplierDecision {
  kind: "deliberate" | "cheaper" | "none";
  currentSupplierName?: string;
  cheaperSupplierName?: string;
  /** Toplam alış maliyeti farkı (mevcut − ucuz), TL, > 0. */
  diff?: number;
  /** Ayarlanabilir eşik (TL). */
  threshold?: number;
}

export async function fetchSupplierAlternatives(
  orderId: string,
): Promise<SupplierDecision> {
  try {
    const raw = await apiFetch<unknown>(
      `/admin/orders/${orderId}/supplier-alternatives`,
    );
    const env =
      raw && typeof raw === "object" && "data" in (raw as object)
        ? (raw as { data: unknown }).data
        : raw;
    if (!env || typeof env !== "object") return { kind: "none" };
    const r = env as Record<string, unknown>;
    const kind =
      r.kind === "deliberate" || r.kind === "cheaper" ? r.kind : "none";
    if (kind === "none") return { kind: "none" };
    const num = (v: unknown): number =>
      typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0;
    return {
      kind,
      currentSupplierName:
        typeof r.currentSupplierName === "string"
          ? r.currentSupplierName
          : undefined,
      cheaperSupplierName:
        typeof r.cheaperSupplierName === "string"
          ? r.cheaperSupplierName
          : undefined,
      diff: num(r.diff),
      threshold: num(r.threshold),
    };
  } catch {
    return { kind: "none" };
  }
}

// ---------------------------------------------------------------------------
// Tedarikçi override (bayinin gerçekte alım yaptığı tedarikçi)
// ---------------------------------------------------------------------------

export interface EligibleSupplier {
  id: string;
  name: string;
  unitPrice: number;
  costPrice: number | null;
}

export interface EligibleSuppliersResponse {
  currentSupplierId: string | null;
  overrideSupplierId: string | null;
  suppliers: EligibleSupplier[];
}

export async function fetchEligibleSuppliers(
  orderId: string,
  itemId: string,
): Promise<EligibleSuppliersResponse> {
  const raw = await apiFetch<unknown>(
    `/admin/orders/${orderId}/items/${itemId}/eligible-suppliers`,
  );
  const env =
    raw && typeof raw === "object" && "data" in (raw as object)
      ? (raw as { data: unknown }).data
      : raw;
  const empty: EligibleSuppliersResponse = {
    currentSupplierId: null,
    overrideSupplierId: null,
    suppliers: [],
  };
  if (!env || typeof env !== "object") return empty;
  const obj = env as Record<string, unknown>;
  const suppliers = Array.isArray(obj.suppliers)
    ? obj.suppliers
        .map((row): EligibleSupplier | null => {
          if (!row || typeof row !== "object") return null;
          const r = row as Record<string, unknown>;
          const id = typeof r.id === "string" ? r.id : null;
          const name = typeof r.name === "string" ? r.name : null;
          if (!id || !name) return null;
          const num = (v: unknown): number =>
            typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0;
          return {
            id,
            name,
            unitPrice: num(r.unitPrice),
            costPrice:
              r.costPrice === null || r.costPrice === undefined
                ? null
                : num(r.costPrice),
          };
        })
        .filter((v): v is EligibleSupplier => v !== null)
    : [];
  return {
    currentSupplierId:
      typeof obj.currentSupplierId === "string" ? obj.currentSupplierId : null,
    overrideSupplierId:
      typeof obj.overrideSupplierId === "string" ? obj.overrideSupplierId : null,
    suppliers,
  };
}

export async function setOrderItemSupplier(
  orderId: string,
  itemId: string,
  supplierId: string | null,
): Promise<void> {
  await apiFetch<unknown>(
    `/admin/orders/${orderId}/items/${itemId}/supplier`,
    {
      method: "PATCH",
      body: JSON.stringify({ supplierId }),
    },
  );
}

// ── SİPARİŞ-SEVİYESİ tedarikçi (tüm siparişi tek tıkla tek tedarikçiye) ──────
export interface OrderEligibleSupplierItem {
  productName: string;
  qty: number;
  cost: number;
}
export interface OrderEligibleSupplier {
  id: string;
  name: string;
  totalCost: number;
  items: OrderEligibleSupplierItem[];
}
export interface OrderEligibleSuppliersResponse {
  currentSupplierId: string | null;
  suppliers: OrderEligibleSupplier[];
}

export async function fetchOrderEligibleSuppliers(
  orderId: string,
): Promise<OrderEligibleSuppliersResponse> {
  const raw = await apiFetch<unknown>(
    `/admin/orders/${orderId}/order-eligible-suppliers`,
  );
  const env =
    raw && typeof raw === "object" && "data" in (raw as object)
      ? (raw as { data: unknown }).data
      : raw;
  const empty: OrderEligibleSuppliersResponse = {
    currentSupplierId: null,
    suppliers: [],
  };
  if (!env || typeof env !== "object") return empty;
  const obj = env as Record<string, unknown>;
  const suppliers = Array.isArray(obj.suppliers)
    ? obj.suppliers
        .map((row): OrderEligibleSupplier | null => {
          if (!row || typeof row !== "object") return null;
          const r = row as Record<string, unknown>;
          const id = typeof r.id === "string" ? r.id : null;
          const name = typeof r.name === "string" ? r.name : null;
          if (!id || !name) return null;
          const num = (v: unknown): number =>
            typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0;
          const items = Array.isArray(r.items)
            ? r.items
                .map((iv): OrderEligibleSupplierItem | null => {
                  if (!iv || typeof iv !== "object") return null;
                  const ir = iv as Record<string, unknown>;
                  return {
                    productName:
                      typeof ir.productName === "string" ? ir.productName : "—",
                    qty: num(ir.qty),
                    cost: num(ir.cost),
                  };
                })
                .filter((v): v is OrderEligibleSupplierItem => v !== null)
            : [];
          return { id, name, totalCost: num(r.totalCost), items };
        })
        .filter((v): v is OrderEligibleSupplier => v !== null)
    : [];
  return {
    currentSupplierId:
      typeof obj.currentSupplierId === "string" ? obj.currentSupplierId : null,
    suppliers,
  };
}

export async function setOrderSupplier(
  orderId: string,
  supplierId: string | null,
): Promise<void> {
  await apiFetch<unknown>(`/admin/orders/${orderId}/order-supplier`, {
    method: "PATCH",
    body: JSON.stringify({ supplierId }),
  });
}

export async function setOrderItemSupplierOrderNo(
  orderId: string,
  itemId: string,
  supplierOrderNo: string | null,
): Promise<void> {
  await apiFetch<unknown>(
    `/admin/orders/${orderId}/items/${itemId}/supplier-order-no`,
    {
      method: "PATCH",
      body: JSON.stringify({ supplierOrderNo }),
    },
  );
}

/**
 * Sipariş bazında tedarikçi sipariş numarası — tek input tüm kalemleri kapsar.
 * "paid" durumundaki bir siparişe ilk kez set edildiğinde otomatik
 * "preparing" durumuna geçer.
 */
export async function setOrderSupplierOrderNo(
  orderId: string,
  supplierOrderNo: string | null,
): Promise<void> {
  await apiFetch<unknown>(
    `/admin/orders/${orderId}/supplier-order-no`,
    {
      method: "PATCH",
      body: JSON.stringify({ supplierOrderNo }),
    },
  );
}
