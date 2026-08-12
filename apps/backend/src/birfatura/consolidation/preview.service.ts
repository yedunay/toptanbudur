import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppSettingsService } from '../../app-settings/app-settings.service';
import {
  mapPaymentTypeToBirfaturaId,
  mapPaymentTypeToBirfaturaLabel,
} from '../birfatura.constants';
import { decimalToNumber, nz } from '../birfatura.utils';
import {
  BatchMemberOrder,
  BatchSnapshotForMap,
  BIRFATURA_DEFAULT_TC_ENV,
  BIRFATURA_SALES_CHANNEL_ENV,
  CONSOLIDATED_SALES_CHANNEL,
  DEFAULT_TC_FALLBACK,
  mapBatchToBirfaturaOrder,
  resolveLineProductCode,
} from './batch-mapper';
import {
  computeBatchPricing,
  orderCommissionUnitExclShares,
  orderPackagingUnitExcl,
} from './pricing.engine';
import {
  BillingSnapshot,
  BillingSnapshotCustomer,
  buildBillingSnapshot,
  eligibleOrdersWhere,
  normalizePaymentType,
} from './freeze.service';
import { addMonthsIstanbul, startOfDayIstanbul } from './trt-date';

/**
 * Faz 6 — Konsolide fatura **önizleme** motoru (birfatura.md §8).
 *
 * Admin "Önizle": müşteri (veya tümü) + tarih seç → o ana kadar uygun
 * (kargolanmış, faturalanmamış, açık) siparişleri `(müşteri, ödeme tipi)`
 * gruplarına ayır → **DB'ye HİÇBİR ŞEY yazmadan** profesyonel fatura dökümü üret.
 *
 * KESİN TUTARLILIK (§8 "önizleme = kesilen fatura"): bu servis kendi mantığını
 * KURMAZ; gerçek akışın TAM aynı fonksiyonlarını çağırır →
 *  - uygunluk:       `eligibleOrdersWhere`  (freeze ile ortak)
 *  - gruplama:       `normalizePaymentType` + `${customerId} ${ptype}` (freeze ile ortak)
 *  - fiyat/KDV:      `computeBatchPricing`  (§2 motoru — freeze + /api/orders/ ile ortak)
 *  - billing snapshot: `buildBillingSnapshot` (freeze ile ortak)
 *  - BirFatura JSON: `mapBatchToBirfaturaOrder` (canlı /api/orders/ ile ortak)
 * Tek fark: `freeze()`'in yaptığı `$transaction` (InvoiceBatch.create + Order
 * bağlama) **hiç çalışmaz**. Sentetik `birfaturaOrderId` sequence'i de tüketilmez
 * → önizleme yer tutucu olarak `BigInt(0)` kullanır (OrderId: 0 = "henüz kesilmedi").
 *
 * Hem 25'i toplu (customerId yok) hem tekli (customerId verili) önizlenebilir.
 *
 * NOT (RLS): konsolide sorgular tüm tenant'lar arası çalışır (freeze ile aynı
 * desen) — uygunluk WHERE'i `customerId: { not: null }` ile sistem genelinde tarar.
 */

/** Önizlemede getirilecek uygun siparişin tam şekli (mapper'ın gerektirdiği alt küme). */
type PreviewEligibleOrder = Prisma.OrderGetPayload<{
  include: {
    customer: true;
    items: {
      select: {
        productId: true;
        productSlug: true;
        productName: true;
        unitPrice: true;
        qty: true;
        internalCodeSnapshot: true;
        publicBarcodeSnapshot: true;
        product: {
          select: { id: true; internalCode: true; publicBarcode: true };
        };
      };
    };
  };
}>;

/** Önizleme fatura satırı (insan-okur döküm; tüm tutarlar yuvarlanmamış number). */
export interface PreviewLine {
  /** Bu satırın ait olduğu siparişin no'su (humanOrderNo, önek yok). */
  orderCode: string;
  /** Müşteriye-açık stok kodu (internalCode → publicBarcode → slug; tedarikçi kodu ASLA). */
  productCode: string;
  productName: string;
  quantity: number;
  vatRate: number;
  unitPriceTaxExcluding: number;
  unitPriceTaxIncluding: number;
  lineTotalTaxExcluding: number;
  lineTotalTaxIncluding: number;
  /** "Kargo Bedeli" paketleme satırı mı? */
  isPackaging: boolean;
}

/** Tek bir konsolide önizleme faturası = bir `(müşteri, ödeme tipi)` grubu. */
export interface PreviewInvoice {
  customerId: string;
  customerName: string;
  /** 'card' | 'cari' (normalize edilmiş). */
  paymentType: string;
  paymentTypeId: number;
  paymentTypeLabel: string;
  isCorporate: boolean;
  billing: BillingSnapshot;
  orderCount: number;
  /** Üye sipariş no'ları (humanOrderNo, asc). */
  orderCodes: string[];
  totalQuantity: number;
  productsTotalTaxExcluding: number;
  productsTotalTaxIncluding: number;
  totalPaidTaxExcluding: number;
  totalPaidTaxIncluding: number;
  lines: PreviewLine[];
  /** Kesilecek olan BirFatura `/api/orders/` "Order" objesi (OrderId: 0 = önizleme). */
  birfaturaOrder: Record<string, unknown>;
}

/** Önizleme sonucu (kapsam + dönem + üretilen faturalar). DB'ye yazılmaz. */
export interface PreviewResult {
  /** Her zaman true — bu bir önizlemedir, hiçbir şey kesilmemiştir. */
  isPreview: true;
  /** 'single' (tek bayi) | 'all' (tüm uygun bayiler — 25'i toplu). */
  scope: 'single' | 'all';
  customerId: string | null;
  /** Önizleme anı (cutoff) — ISO. */
  asOf: string;
  /** Önceki kesim etiketi — ISO. */
  periodStart: string;
  /** Bu kesim (= OrderDate, TRT gün başlangıcı) — ISO. */
  periodEnd: string;
  /** Üretilen fatura (grup) sayısı. */
  invoiceCount: number;
  /** Önizlemeye giren toplam uygun sipariş sayısı. */
  orderCount: number;
  invoices: PreviewInvoice[];
}

/** Önizleme opsiyonları. */
export interface PreviewOptions {
  /** Sadece bu bayi (tekli önizleme); yoksa tüm uygun bayiler (toplu önizleme). */
  customerId?: string;
  /** Önizleme anı (cutoff). Yoksa "şimdi". */
  asOf?: Date;
}

/** `buildInvoice` için dönem/opsiyon bağlamı (her grupta tekrar hesaplanmasın). */
interface PreviewContext {
  periodEnd: Date;
  salesChannel: string;
  defaultTc: string;
}

@Injectable()
export class PreviewService {
  private readonly logger = new Logger(PreviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AppSettingsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Uygun siparişleri (freeze ile birebir aynı kriter) gruplayıp her grup için
   * kesilecek faturanın **birebir aynısını** (DB yazmadan) üretir.
   */
  async preview(opts: PreviewOptions = {}): Promise<PreviewResult> {
    // 1) Tarih semantiği — freeze() ile birebir aynı.
    const asOf = opts.asOf ?? new Date();
    const cutoff = asOf;
    const periodEnd = startOfDayIstanbul(asOf);
    const periodStart = addMonthsIstanbul(periodEnd, -1);

    // 2) Mapping opsiyonları — canlı /api/orders/ ile aynı ortak sabit/env.
    const salesChannel =
      this.config.get<string>(BIRFATURA_SALES_CHANNEL_ENV) ??
      CONSOLIDATED_SALES_CHANNEL;
    const defaultTc =
      this.config.get<string>(BIRFATURA_DEFAULT_TC_ENV) ?? DEFAULT_TC_FALLBACK;
    const ctx: PreviewContext = {
      periodEnd,
      salesChannel,
      defaultTc,
    };

    // 3) Uygun siparişler (§4) — freeze ile ORTAK WHERE (drift yok). Yazma yok.
    const eligible = (await this.prisma.order.findMany({
      where: eligibleOrdersWhere(cutoff, opts.customerId),
      orderBy: { humanOrderNo: 'asc' },
      include: {
        customer: true,
        items: {
          orderBy: { id: 'asc' },
          select: {
            productId: true,
            productSlug: true,
            productName: true,
            unitPrice: true,
            qty: true,
            internalCodeSnapshot: true,
            publicBarcodeSnapshot: true,
            product: {
              select: { id: true, internalCode: true, publicBarcode: true },
            },
          },
        },
      },
    })) as PreviewEligibleOrder[];

    const scope: 'single' | 'all' = opts.customerId ? 'single' : 'all';

    if (eligible.length === 0) {
      return {
        isPreview: true,
        scope,
        customerId: opts.customerId ?? null,
        asOf: asOf.toISOString(),
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        invoiceCount: 0,
        orderCount: 0,
        invoices: [],
      };
    }

    // 4) (customerId, paymentType) gruplama — freeze ile birebir aynı anahtar
    //    ve sıra (humanOrderNo asc) korunur.
    const groups = new Map<string, PreviewEligibleOrder[]>();
    for (const order of eligible) {
      const ptype = normalizePaymentType(order.paymentType);
      const key = `${order.customerId} ${ptype}`;
      const bucket = groups.get(key);
      if (bucket) {
        bucket.push(order);
      } else {
        groups.set(key, [order]);
      }
    }

    // 5) Her grup → bir önizleme faturası (DB yazmadan).
    const invoices = [...groups.values()].map((orders) =>
      this.buildInvoice(orders, ctx),
    );

    return {
      isPreview: true,
      scope,
      customerId: opts.customerId ?? null,
      asOf: asOf.toISOString(),
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      invoiceCount: invoices.length,
      orderCount: eligible.length,
      invoices,
    };
  }

  /**
   * Bir `(müşteri, ödeme tipi)` grubunu kesilecek faturanın birebir aynısına
   * dönüştürür: §2 fiyat motoru + ortak billing snapshot + canlı BirFatura
   * mapper. Hiçbir DB yazımı yoktur; sentetik sipariş no'su yer tutucudur (0).
   */
  private buildInvoice(
    orders: PreviewEligibleOrder[],
    ctx: PreviewContext,
  ): PreviewInvoice {
    // Bir grubun tüm üyeleri aynı müşteri + aynı ödeme tipidir → temsilci ilk üye.
    const representative = orders[0];
    const ptype = normalizePaymentType(representative.paymentType);

    // Üye kalemleri sırayı koruyarak düzleştir (index, §2 motoru çıktısıyla hizalı).
    // Her kaleme: siparişin no'su (satır "Sipariş No") + o siparişin GERÇEK
    // paketlemesinden birim matrah (packagingUnitExcl).
    const flatItems = orders.flatMap((o) => {
      const oQty = o.items.reduce((a, it) => a + it.qty, 0);
      const pkgUnit = orderPackagingUnitExcl(o.packagingCost, oQty);
      // Kart komisyonu: kalemlere ORANSAL per-unit matrah payı (cari → 0).
      const commissionUnits = orderCommissionUnitExclShares(
        o.cardCommissionAmount ?? null,
        o.items.map((it) => ({ unitPrice: it.unitPrice, qty: it.qty })),
      );
      return o.items.map((it, idx) => ({
        ...it,
        orderCode: o.humanOrderNo,
        packagingUnitExcl: pkgUnit.add(commissionUnits[idx]),
      }));
    });

    // §2 motoru — freeze + /api/orders/ + önizleme ortak (tutar her yerde aynı).
    const pricing = computeBatchPricing(
      flatItems.map((it) => ({
        unitPrice: it.unitPrice,
        qty: it.qty,
        packagingUnitExcl: it.packagingUnitExcl,
      })),
    );

    // Billing snapshot — freeze ile ortak (öncelik order, fallback canlı Customer).
    const billing = buildBillingSnapshot(
      representative.customer as unknown as BillingSnapshotCustomer,
      representative,
    );

    const members: BatchMemberOrder[] = orders.map((o) => ({
      humanOrderNo: o.humanOrderNo,
      packagingCost: o.packagingCost,
      cardCommissionAmount: o.cardCommissionAmount,
      items: o.items,
    }));

    // Kesilecek BirFatura "Order" objesinin birebir aynısı — DB yazmadan.
    // birfaturaOrderId yer tutucu (0): sequence tüketilmez, OrderId: 0 = önizleme.
    const snapshot: BatchSnapshotForMap = {
      birfaturaOrderId: BigInt(0),
      periodEnd: ctx.periodEnd,
      paymentType: ptype,
      ...billing,
      productsTotalTaxExcluding: pricing.productsTotalTaxExcluding,
      productsTotalTaxIncluding: pricing.productsTotalTaxIncluding,
      totalPaidTaxExcluding: pricing.totalPaidTaxExcluding,
      totalPaidTaxIncluding: pricing.totalPaidTaxIncluding,
    };
    const birfaturaOrder = mapBatchToBirfaturaOrder(snapshot, members, {
      salesChannel: ctx.salesChannel,
      defaultTc: ctx.defaultTc,
    });

    // İnsan-okur döküm satırları — §2 motoru çıktısı ile birebir (mapper'la aynı).
    const lines: PreviewLine[] = flatItems.map((item, i) => {
      const line = pricing.productLines[i];
      return {
        orderCode: item.orderCode,
        productCode: resolveLineProductCode(item),
        productName: item.productName,
        quantity: line.qty,
        vatRate: line.vatRate,
        unitPriceTaxExcluding: decimalToNumber(line.unitPriceTaxExcluding),
        unitPriceTaxIncluding: decimalToNumber(line.unitPriceTaxIncluding),
        lineTotalTaxExcluding: decimalToNumber(line.lineTotalTaxExcluding),
        lineTotalTaxIncluding: decimalToNumber(line.lineTotalTaxIncluding),
        isPackaging: false,
      };
    });

    // NOT: Ayrı "Kargo Bedeli" satırı YOK — paketleme ücreti her ürün matrahına
    // gömülü (§2). Önizleme = kesilen fatura (motor + mapper ile birebir).

    return {
      customerId: representative.customerId as string,
      customerName:
        nz(billing.billingName) ?? representative.customer?.name ?? '-',
      paymentType: ptype,
      paymentTypeId: mapPaymentTypeToBirfaturaId(ptype),
      paymentTypeLabel: mapPaymentTypeToBirfaturaLabel(ptype),
      isCorporate: !!nz(billing.billingVergiNo),
      billing,
      orderCount: orders.length,
      orderCodes: orders.map((o) => o.humanOrderNo),
      totalQuantity: pricing.totalQty,
      productsTotalTaxExcluding: decimalToNumber(
        pricing.productsTotalTaxExcluding,
      ),
      productsTotalTaxIncluding: decimalToNumber(
        pricing.productsTotalTaxIncluding,
      ),
      totalPaidTaxExcluding: decimalToNumber(pricing.totalPaidTaxExcluding),
      totalPaidTaxIncluding: decimalToNumber(pricing.totalPaidTaxIncluding),
      lines,
      birfaturaOrder,
    };
  }
}
