import { Prisma } from '@prisma/client';
import {
  decimalToNumber,
  formatTrDate,
  hashStringToInt,
  nz,
  sanitizePhone,
} from '../birfatura.utils';
import {
  computeBatchPricing,
  orderCommissionUnitExclShares,
  orderPackagingUnitExcl,
} from './pricing.engine';

/**
 * Konsolide modda satış kanalı (§6 #3 / §11): "Toptan Budur" — legacy bireysel
 * `/api/orders/` kanalından (toptanbudur.com) farklıdır. `BIRFATURA_SALES_CHANNEL`
 * env'i ile override edilebilir. Canlı `/api/orders/` (Faz 4) ile Faz 6 önizleme
 * AYNI sabiti kullanır → "önizleme = kesilen fatura" (drift yok).
 */
export const CONSOLIDATED_SALES_CHANNEL = 'Toptan Budur';

/** §11.1: bireysel müşteride TC boşsa BirFatura zorunlu alan fallback'i. Override: `BIRFATURA_DEFAULT_TC`. */
export const DEFAULT_TC_FALLBACK = '11111111111';

/** Konsolide mapping opsiyonlarının env override anahtarları (canlı servis + önizleme ortak). */
export const BIRFATURA_SALES_CHANNEL_ENV = 'BIRFATURA_SALES_CHANNEL';
export const BIRFATURA_DEFAULT_TC_ENV = 'BIRFATURA_DEFAULT_TC';

/**
 * Faz 4 — Konsolide (toplu) **batch → BirFatura `/api/orders/` JSON** eşleyici
 * (birfatura.md §6 #3 / §11 / §11.1). SAF fonksiyon: DB/yan etki yok.
 *
 * TEK doğruluk kaynağı: hem canlı `/api/orders/` hem Faz 6 önizleme bu
 * fonksiyonu çağırır → BirFatura'ya giden JSON ile admin önizlemesi birebir
 * aynıdır (§8 "önizleme = kesilen fatura").
 *
 * Üretilen sentetik konsolide sipariş:
 *  - 1 batch = 1 BirFatura "Order" (OrderId = batch.birfaturaOrderId).
 *  - OrderDetails = tüm üye OrderItem'lar (kalem başına 1 satır, §2 fiyat;
 *    paketleme ücreti her ürün matrahına gömülü — ayrı "Kargo Bedeli" satırı YOK).
 *  - Top-level tutarlar = donmuş batch snapshot (§6 #3 "Tutarlar = batch
 *    snapshot"); satır içi tutarlar = §2 motoru. Paketleme ücreti dondurmadan
 *    bu yana değişmediyse (normal/beklenen durum) ikisi birebir çakışır.
 *  - Shipping = Billing (bayi faturası; ayrı teslimat adresi yok).
 */

/** Batch snapshot'ının eşleme için gereken alt kümesi (donmuş `InvoiceBatch`). */
export interface BatchSnapshotForMap {
  /** Sentetik BirFatura sipariş no'su (sequence, ~9e9, JS-safe < 2^53). */
  birfaturaOrderId: bigint;
  /** Bu kesim = OrderDate. */
  periodEnd: Date;
  /**
   * Donmuş batch'in stored OrderCode'u. "Toplu Fatura " ile başlıyorsa (zaten BU
   * adla BirFatura'ya gönderilmiş = KİLİTLİ) AYNEN gider; değişirse GİB'de mükerrer
   * fatura olur. Aksi halde (humanOrderNo virgül-listesi / null) benzersiz hesaplanır.
   */
  orderCode?: string | null;
  /** 'card' → PaymentTypeId 1, aksi 'cari' → 2. */
  paymentType: string;
  billingName: string | null;
  billingCompanyTitle: string | null;
  billingVergiNo: string | null;
  billingVergiDairesi: string | null;
  billingTcNo: string | null;
  billingEmail: string | null;
  billingPhone: string | null;
  billingMobilePhone: string | null;
  billingAddressLine: string | null;
  billingDistrict: string | null;
  billingCity: string | null;
  productsTotalTaxExcluding: Prisma.Decimal | string | number;
  productsTotalTaxIncluding: Prisma.Decimal | string | number;
  totalPaidTaxExcluding: Prisma.Decimal | string | number;
  totalPaidTaxIncluding: Prisma.Decimal | string | number;
  /**
   * Kaynak ayrımı: 'integration_package' → Entegrasyon paketi faturası
   * (üye sipariş YOK → tek sentetik satır `lineDescription`). Verilmezse/'order'
   * → normal konsolide sipariş batch'i (mevcut davranış).
   */
  source?: string;
  lineDescription?: string | null;
}

/** Üye siparişin tek bir kalemi (eşleme için gereken alt küme). */
export interface BatchMemberItem {
  productId: string | null;
  productSlug: string;
  productName: string;
  unitPrice: Prisma.Decimal | string | number;
  qty: number;
  /**
   * Sipariş anında dondurulan müşteri-yüzlü stok kodu / public barkod snapshot'ı.
   * Ürün hard-delete edilse (product=null) bile fatura bu donmuş kodu gösterir →
   * slug ASLA sızmaz. Mevcut (snapshot öncesi) kalemlerde null olabilir.
   */
  internalCodeSnapshot?: string | null;
  publicBarcodeSnapshot?: string | null;
  /** Ürün hâlâ varsa müşteriye-güvenli kodlar; hard-delete ise null. */
  product?: {
    id: string;
    internalCode: string | null;
    publicBarcode: string | null;
  } | null;
}

/** Üye sipariş (eşleme için gereken alt küme). */
export interface BatchMemberOrder {
  humanOrderNo: string;
  /** Siparişin paketleme ücreti (KDV hariç, düz). Faturada ürün matrahlarına gömülür. */
  packagingCost: Prisma.Decimal | string | number | null;
  /**
   * Kart komisyonu (KDV DAHİL brüt — Order.cardCommissionAmount). Paketleme
   * gibi AYRI SATIR DEĞİL: KDV'siz hali ürün matrahlarına ORANSAL gömülür
   * (orderCommissionUnitExclShares) → fatura toplamı karttan çekilen tutarla
   * birebir. Cari ödemeli siparişte null/0.
   */
  cardCommissionAmount?: Prisma.Decimal | string | number | null;
  items: ReadonlyArray<BatchMemberItem>;
}

/** Eşleyici opsiyonları. */
export interface MapBatchOptions {
  /** §11: "Toptan Budur" (SalesChannelWebSite). */
  salesChannel: string;
  /** Bireysel müşteride TC boşsa fallback (ör. "11111111111"). */
  defaultTc: string;
}

/**
 * Üye kalemin `ProductCode`'unu çöz.
 *
 * ⚠️ SPEC SAPMASI (bilinçli, §11 tablosu "item.externalCode" der): `externalCode`
 * **tedarikçi** stok kodudur ve `OrderItem.supplierSku`/`supplierBarcode` gibi
 * "müşteriye ASLA sızdırılmaz" (schema + TBDR kuralı). Fatura BAYİYE gidiyor;
 * gösterilmesi gereken müşteriye-açık koddur. `Product.internalCode` tam da
 * "müşteriye 'Stok Kodu' olarak gösterilen", sonsuza dek sabit koddur → onu
 * kullanırız.
 *
 * ÇÖZÜMLEME ÖNCELİĞİ (slug ASLA müşteriye basılmaz):
 *   internalCodeSnapshot (sipariş anı, donmuş TBDR)
 *     → product.internalCode (canlı TBDR)
 *     → publicBarcodeSnapshot (donmuş public barkod)
 *     → product.publicBarcode (canlı public barkod)
 *     → customerSafeFallbackCode (deterministik temiz arşiv kodu).
 *
 * Snapshot ÖNCE gelir: ürün sonradan hard-delete edilse (productId → SET NULL,
 * product=null) bile fatura sipariş anındaki donmuş kodu gösterir, ASLA
 * `productSlug` (çirkin URL handle) sızmaz. Snapshot, ürünün sonradan değişmesi
 * durumunda da tarihsel doğruluğu korur ("Stok Kodu sabit" garantisi).
 */
export function resolveLineProductCode(item: BatchMemberItem): string {
  return (
    nz(item.internalCodeSnapshot) ??
    nz(item.product?.internalCode) ??
    nz(item.publicBarcodeSnapshot) ??
    nz(item.product?.publicBarcode) ??
    customerSafeFallbackCode(item)
  );
}

/**
 * SON ÇARE — ne canlı kod ne snapshot var (yalnız çok eski, snapshot öncesi
 * hard-delete edilmiş ürünler; backfill ile bu da kapatılır). `productSlug`'ı
 * (URL handle) DOĞRUDAN basmak YASAK → ondan deterministik, temiz, TBDR
 * namespace'iyle ÇAKIŞMAYAN bir kod türetilir. Aynı ürün her zaman aynı kodu
 * alır (tutarlı). Format: `STK-XXXXXX`.
 */
export function customerSafeFallbackCode(item: BatchMemberItem): string {
  const seed = nz(item.productSlug) ?? String(item.productId ?? '');
  const n = hashStringToInt(seed) % 1_000_000;
  return `STK-${String(n).padStart(6, '0')}`;
}

/**
 * Legacy tekli e-fatura "Barcode" alanı için MÜŞTERİ-güvenli barkod. Ham tedarikçi
 * barkodu (`Product.barcode`) ASLA gitmez — yalnız `publicBarcode` (snapshot →
 * canlı). Hiçbiri yoksa null (alan opsiyonel).
 */
export function resolveLineBarcode(item: BatchMemberItem): string | null {
  return (
    nz(item.publicBarcodeSnapshot) ?? nz(item.product?.publicBarcode) ?? null
  );
}

/** Üye kalemin `ProductId`'sini çöz (sayısal; cuid/uuid → hash, fallback slug). */
export function resolveLineProductId(item: BatchMemberItem): number {
  const id = item.product?.id ?? item.productId;
  return id ? hashStringToInt(id) : hashStringToInt(item.productSlug);
}

/**
 * Donmuş batch + üye siparişleri → BirFatura `/api/orders/` "Order" objesi.
 * Üye sırası çağıran tarafından (humanOrderNo asc) korunmalıdır.
 */
export function mapBatchToBirfaturaOrder(
  batch: BatchSnapshotForMap,
  members: ReadonlyArray<BatchMemberOrder>,
  options: MapBatchOptions,
): Record<string, unknown> {
  // Üye kalemleri sırayı koruyarak düzleştir (index, §2 motoru çıktısıyla hizalı).
  // Her kaleme: ait olduğu siparişin no'su (ProductName öneki) + o siparişin GERÇEK
  // paketlemesinden birim matrah (packagingUnitExcl) iliştirilir.
  const flatItems = members.flatMap((m) => {
    const mQty = m.items.reduce((a, it) => a + it.qty, 0);
    const pkgUnit = orderPackagingUnitExcl(m.packagingCost, mQty);
    // Kart komisyonu: o siparişin kalemlerine ORANSAL per-unit matrah payı
    // (cari siparişte sıfırlar). Paketleme eklentisiyle aynı kanaldan gömülür.
    const commissionUnits = orderCommissionUnitExclShares(
      m.cardCommissionAmount ?? null,
      m.items.map((it) => ({ unitPrice: it.unitPrice, qty: it.qty })),
    );
    return m.items.map((it, idx) => ({
      ...it,
      humanOrderNo: m.humanOrderNo,
      packagingUnitExcl: pkgUnit.add(commissionUnits[idx]),
    }));
  });
  const pricing = computeBatchPricing(
    flatItems.map((it) => ({
      unitPrice: it.unitPrice,
      qty: it.qty,
      packagingUnitExcl: it.packagingUnitExcl,
    })),
  );

  // OrderDetails — her üye kalemi için 1 satır (§6 #3), §2 fiyatı.
  // Paket faturası (source='integration_package'): üye sipariş YOK → tek sentetik
  // satır; tutarlar zaten batch snapshot'ından (aşağıda) gelir.
  const orderDetails: Record<string, unknown>[] =
    batch.source === 'integration_package'
      ? [
          {
            ProductId: 0,
            ProductCode: 'ENTEGRASYON',
            ProductName: batch.lineDescription ?? 'Entegrasyon Paketi',
            ProductQuantityType: 'Adet',
            ProductQuantity: 1,
            VatRate: 20,
            ProductUnitPriceTaxExcluding: decimalToNumber(batch.productsTotalTaxExcluding),
            ProductUnitPriceTaxIncluding: decimalToNumber(batch.productsTotalTaxIncluding),
          },
        ]
      : flatItems.map((item, i) => {
    const line = pricing.productLines[i];
    return {
      ProductId: resolveLineProductId(item),
      ProductCode: resolveLineProductCode(item),
      // Satır-bazlı sipariş no GİB e-fatura kolonlarına eklenemez → ürün adının
      // önüne gömülür (sitedeki düz no ile aynı): "61001192 · Ürün adı".
      ProductName: `${item.humanOrderNo} · ${item.productName}`,
      ProductQuantityType: 'Adet',
      ProductQuantity: line.qty,
      VatRate: line.vatRate,
      ProductUnitPriceTaxExcluding: decimalToNumber(line.unitPriceTaxExcluding),
      ProductUnitPriceTaxIncluding: decimalToNumber(line.unitPriceTaxIncluding),
    };
  });

  // NOT: Ayrı "Kargo Bedeli" satırı YOK — paketleme ücreti (matrah +4.00 / KDV
  // dahil +4.80) her ürün satırının matrahına gömülüdür (§2, computeBatchPricing).

  // Town boşsa → city → '-' (asla null, §6 #3 / §11.1).
  const town = nz(batch.billingDistrict) ?? nz(batch.billingCity) ?? '-';
  const city = nz(batch.billingCity) ?? '-';
  const name = nz(batch.billingName) ?? '-';
  const address = nz(batch.billingAddressLine) ?? '-';
  const mobile = sanitizePhone(batch.billingMobilePhone ?? batch.billingPhone);

  const isCorporate = !!nz(batch.billingVergiNo);

  const out: Record<string, unknown> = {
    // ── Sipariş başlığı ──────────────────────────────────────────────
    // OrderId: BigInt ~9e9 < 2^53 → Number güvenli (NestJS BigInt serialize edemez).
    OrderId: Number(batch.birfaturaOrderId),
    // Üstte virgüllü sipariş listesi YOK (çirkin) — sipariş no'ları artık her satırda
    // (ProductName öneki). OrderCode BENZERSİZ olmalı: aynı kesim gününde birden çok
    // bayi batch'i aynı OrderCode'a düşerse BirFatura "Sipariş No"yu MÜKERRER sayıp
    // HİÇBİRİNİ göstermez → batch no'sunu ekliyoruz.
    // KİLİT: batch.orderCode "Toplu Fatura " ile başlıyorsa (zaten BU adla BirFatura'ya
    // gönderilmiş = sabit) AYNEN kullanılır — değişirse GİB'de MÜKERRER fatura olur.
    // Aksi halde (humanOrderNo virgül-listesi / null) benzersiz kod hesaplanır.
    // Callback birfaturaOrderId ile çözülür; OrderCode'a bağlı değil → güvenli.
    OrderCode:
      typeof batch.orderCode === 'string' &&
      batch.orderCode.startsWith('Toplu Fatura ')
        ? batch.orderCode
        : `Toplu Fatura ${formatTrDate(batch.periodEnd).slice(0, 10)} #${batch.birfaturaOrderId}`,
    OrderDate: formatTrDate(batch.periodEnd),

    // ── Billing (bayi) ───────────────────────────────────────────────
    BillingName: name,
    BillingAddress: address,
    BillingTown: town,
    BillingCity: city,
    BillingMobilePhone: mobile,
    BillingPhone: sanitizePhone(batch.billingPhone),
    Email: nz(batch.billingEmail) ?? '', // §7: BirFatura faturayı bu adrese yollar.

    // ── Shipping = Billing (bayi faturası; ayrı teslimat yok) ─────────
    ShippingName: name,
    ShippingAddress: address,
    ShippingTown: town,
    ShippingCity: city,

    // ── Ödeme / kanal / döviz ────────────────────────────────────────
    PaymentTypeId: batch.paymentType === 'card' ? 1 : 2,
    Currency: 'TRY',
    CurrencyRate: 1,
    SalesChannelWebSite: options.salesChannel,

    // ── Tutarlar = donmuş batch snapshot (§6 #3) — yuvarlama yok ──────
    TotalPaidTaxExcluding: decimalToNumber(batch.totalPaidTaxExcluding),
    TotalPaidTaxIncluding: decimalToNumber(batch.totalPaidTaxIncluding),
    ProductsTotalTaxExcluding: decimalToNumber(batch.productsTotalTaxExcluding),
    ProductsTotalTaxIncluding: decimalToNumber(batch.productsTotalTaxIncluding),
    // §2: indirim ayrı satır değil (matraha gömülü) / paketleme satır olarak gidiyor.
    DiscountTotalTaxExcluding: 0,
    DiscountTotalTaxIncluding: 0,
    ShippingChargeTotalTaxExcluding: 0,
    ShippingChargeTotalTaxIncluding: 0,

    OrderDetails: orderDetails,
  };

  // ── Vergi kimliği: kurumsal → TaxNo/TaxOffice; bireysel → SSNTCNo ──
  if (isCorporate) {
    out.TaxNo = nz(batch.billingVergiNo);
    const taxOffice = nz(batch.billingVergiDairesi);
    if (taxOffice) out.TaxOffice = taxOffice; // §6 #3: "her zaman, varsa"
  } else {
    out.SSNTCNo = nz(batch.billingTcNo) ?? options.defaultTc;
  }

  return out;
}
