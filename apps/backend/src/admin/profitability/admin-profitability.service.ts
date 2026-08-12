import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { ProfitabilityQueryDto } from './dto/profitability-query.dto';
import {
  calcItemSupplyCost,
  supplierUnitQty,
  calcItemCollectedKdv,
  calcSupplyKdvPortion,
  calcPackagingKdvPortion,
  calcCardCommissionSpread,
  composeCentralProfit,
} from '../../profitability/profit-cost.util';
import {
  DELETED_SUPPLIER_ID,
  DELETED_SUPPLIER_NAME,
  resolveSupplier,
  resolveSupplierId,
  supplierMatchOr,
} from '../../profitability/supplier-attribution.util';
import { DEFAULT_DEALER_RETURN_COMMISSION_PERCENT } from '../../profitability/order-financials.util';
import {
  trDayStart,
  trDayEndExclusive,
  trDateKey,
  trTodayKey,
} from '../../common/utils/tr-time';

/** TEK KAYNAK: tedarikçi başına alış KDV oranı (Supplier.purchaseVatRate). */
export interface ProfitConfig {
  supplierId: string;
  purchaseVatRate: number;
}

/**
 * Merkezî kâr çıktısı (muhasebe.md Faz 1B). Geriye dönük uyum için legacy
 * `profit`/`margin` korunur ama anlamları DÜZELTİLDİ:
 *   • profit = netProfitKdvExcl (KDV-hariç net kâr; eski KDV-şişirilmiş değil)
 *   • margin = net kâr / net gelir(KDV hariç) × 100
 * KDV-dahil brüt marj, net KDV ve kart komisyon farkı ayrı alanlarda döner.
 */
export interface OrderProfitability {
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
  /** KDV-dahil brüt marj = (gelir − maliyet) + kart komisyon farkı. */
  grossMarginKdvIncl: number;
  /** KDV-hariç net kâr (= legacy profit). */
  netProfitKdvExcl: number;
  /** Net KDV = tahsil edilen satış KDV'si − alışta ödenen KDV. */
  netKdv: number;
  /** Kart komisyon farkı (kâr): (müşteri oranı − gerçek oran) × total. */
  cardCommissionSpread: number;
}

function toNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'string') return parseFloat(v) || 0;
  if (typeof v === 'number') return v;
  // Prisma Decimal object
  if (typeof (v as { toString?: () => string }).toString === 'function') {
    return parseFloat((v as { toString: () => string }).toString()) || 0;
  }
  return 0;
}

// Excel renk paleti (banker / modern)
const COLOR = {
  navy: 'FF0F2A4F',
  navyLight: 'FF1E3A6F',
  white: 'FFFFFFFF',
  zebraEven: 'FFF7F8FA',
  border: 'FFE5E7EB',
  textMuted: 'FF64748B',
  amberBg: 'FFFEF3C7',
  amberText: 'FF92400E',
  success: 'FF059669',
  warning: 'FFD97706',
  danger: 'FFDC2626',
} as const;

const NUMFMT_TRY = '#,##0.00 "₺"';
const NUMFMT_PCT = '0.00"%"';
const NUMFMT_INT = '#,##0';

function fmtDateTR(d: Date): string {
  return d.toLocaleDateString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

@Injectable()
export class AdminProfitabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * TEK KAYNAK: tedarikçi başına alış KDV oranı haritası (Supplier.purchaseVatRate).
   * Eski ProfitabilityConfig (ayrı KDV/indirim/ekMaliyet) kaldırıldı; maliyet
   * tamamen Product.costPrice'tan (ingest'te alış ayarlarıyla hesaplanan) türer.
   */
  private async getSupplierVatMap(
    tenantId: string,
  ): Promise<Map<string, ProfitConfig>> {
    const suppliers = await this.prisma.supplier.findMany({
      where: { tenantId },
      select: { id: true, purchaseVatRate: true },
    });
    return new Map(
      suppliers.map((s) => [
        s.id,
        { supplierId: s.id, purchaseVatRate: s.purchaseVatRate },
      ]),
    );
  }

  async getAnalysis(tenantId: string, query: ProfitabilityQueryDto) {
    // TR takvim günü sınırları: başlangıç gün başı, bitiş günü DAHİL (gün sonu).
    const dateFrom = trDayStart(query.dateFrom) ?? new Date('2000-01-01');
    const dateTo = query.dateTo
      ? new Date(trDayEndExclusive(query.dateTo)!.getTime() - 1)
      : new Date();

    const periodMs = dateTo.getTime() - dateFrom.getTime();
    const prevFrom = new Date(dateFrom.getTime() - periodMs);
    const prevTo = new Date(dateFrom.getTime() - 1);

    const [currentItems, prevItems, configMap] = await Promise.all([
      this._fetchOrderItems(tenantId, dateFrom, dateTo, query.supplierId),
      this._fetchOrderItems(tenantId, prevFrom, prevTo, query.supplierId),
      this.getSupplierVatMap(tenantId),
    ]);

    const current = this._aggregate(currentItems, configMap);
    const prev = this._aggregate(prevItems, configMap);

    return {
      period: { from: dateFrom, to: dateTo },
      summary: {
        revenue: current.totalRevenue,
        cost: current.totalCost,
        profit: current.totalProfit,
        margin:
          current.totalRevenue > 0
            ? (current.totalProfit / current.totalRevenue) * 100
            : 0,
        orderCount: current.orderCount,
        itemCount: current.itemCount,
        // KDV farkı = tahsil edilen − ödenen (Aylık Finans paneli kullanır).
        collectedKdv: current.totalCollectedKdv,
        paidKdv: current.totalPaidKdv,
        netKdv: current.totalNetKdv,
        prevRevenue: prev.totalRevenue,
        prevProfit: prev.totalProfit,
        prevNetKdv: prev.totalNetKdv,
        prevMargin:
          prev.totalRevenue > 0
            ? (prev.totalProfit / prev.totalRevenue) * 100
            : 0,
      },
      bySupplier: current.bySupplier,
      dailyTrend: current.dailyTrend,
      zeroCostItemCount: current.zeroCostItemCount,
    };
  }

  /**
   * Bir tarih aralığı için yalın toplamlar — getAnalysis ile AYNI kuralları
   * (statü kümesi, tedarikçi çözümleme, KDV) kullanır ama "önceki dönem"
   * hesabını YAPMAZ (tek fetch). Aylık Finans paneli her ay için bunu çağırır.
   * `dateTo` DAHİL son andır (çağıran taraf ay sonunu verir).
   */
  async getRangeTotals(
    tenantId: string,
    dateFrom: Date,
    dateTo: Date,
    includeCardSpread = false,
  ) {
    const [items, configMap] = await Promise.all([
      this._fetchOrderItems(tenantId, dateFrom, dateTo),
      this.getSupplierVatMap(tenantId),
    ]);
    const a = this._aggregate(items, configMap);

    // Kart komisyon farkı sipariş DÜZEYİNDE bir büyüklük; kalem tabanlı _aggregate
    // onu göremez. Yalnız gerekince (finans dağıtımı) çek — trend gibi çağıranlar bu
    // 2 ekstra sorguyu ödemesin (opt-in). Σ (müşteriden alınan − POS'a ödenen gerçek);
    // müşteriye yansıtılan modelde bu FARK platform kârıdır.
    let cardCommissionSpread = 0;
    if (includeCardSpread) {
      const [cardOrders, activePos] = await Promise.all([
        this.prisma.order.findMany({
          where: {
            tenantId,
            status: { in: ['paid', 'preparing', 'shipped'] },
            createdAt: { gte: dateFrom, lte: dateTo },
            paymentType: 'card',
          },
          select: {
            paymentType: true,
            total: true,
            cardCommissionRate: true,
            cardCommissionAmount: true,
            cardCommissionRateActual: true,
            cardCommissionAmountActual: true,
          },
        }),
        this.prisma.posProvider.findFirst({
          where: { active: true },
          select: { commissionRate: true, customerCommissionRate: true },
        }),
      ]);
      for (const o of cardOrders) {
        cardCommissionSpread += calcCardCommissionSpread({
          paymentType: o.paymentType,
          total: o.total,
          customerAmount: o.cardCommissionAmount,
          customerRate: o.cardCommissionRate,
          realAmount: o.cardCommissionAmountActual,
          realRate: o.cardCommissionRateActual,
          fallbackCustomerRate: activePos?.customerCommissionRate,
          fallbackRealRate: activePos?.commissionRate,
        });
      }
    }
    return {
      revenue: a.totalRevenue,
      cost: a.totalCost,
      profit: a.totalProfit,
      collectedKdv: a.totalCollectedKdv,
      paidKdv: a.totalPaidKdv,
      netKdv: a.totalNetKdv,
      cardCommissionSpread,
      orderCount: a.orderCount,
      itemCount: a.itemCount,
    };
  }

  /**
   * Verilen sipariş id'leri için sipariş-bazlı karlılık (gelir / maliyet /
   * kâr / marj). Karlılık Analizi (`getAnalysis`) ile BİREBİR aynı kuralları
   * ve formülü kullanır:
   *  - `cancelled` / `refunded` siparişler hariç (sonuç map'inde yer almaz),
   *  - APPROVED iade talebi olan kalemler hariç,
   *  - gelir = birim fiyat × adet × (1 + satış KDV),
   *  - maliyet = (alış × (1 + alış KDV) − indirim) × adet
   *             + ek maliyet (tedarikçi başına SİPARİŞTE BİR KEZ; yalnız o
   *               tedarikçiden fiilen alım yapılan siparişlere).
   *
   * Sipariş Dökümü Excel'i bu metodu kullanır; böylece "Kârlılık Analizi"
   * ekranındaki kâr ile Excel'deki kâr birebir örtüşür.
   */
  async getOrderProfitability(
    tenantId: string,
    orderIds: string[],
  ): Promise<Map<string, OrderProfitability>> {
    const result = new Map<string, OrderProfitability>();
    // KDV bileşenleri sipariş düzeyinde toplanır (kalem döngüsünde birikir),
    // sonda composeCentralProfit ile merkezî kâra dönüşür.
    const kdvAccum = new Map<
      string,
      { collectedKdv: number; paidKdv: number }
    >();
    if (orderIds.length === 0) return result;

    const configMap = await this.getSupplierVatMap(tenantId);

    const items = await this.prisma.orderItem.findMany({
      where: {
        orderId: { in: orderIds },
        order: {
          tenantId,
          // §3.2 — awaiting_payment (tahsil edilmemiş kart) ve iptal/iade HARİÇ.
          // Tüm muhasebe yüzeyleriyle (Z-rapor, Tedarikçi Cari, ProfitCalculator)
          // AYNI statü kümesi → Karlılık artık onlarla mutabık.
          status: { in: ['paid', 'preparing', 'shipped'] },
        },
      },
      select: {
        id: true,
        orderId: true,
        qty: true,
        unitPrice: true,
        costPriceSnapshot: true,
        supplierIdOverride: true,
        supplierIdSnapshot: true,
        fulfillmentSource: true,
        houseStockDispatchedAt: true,
        houseStockReservedQty: true,
        houseStockReservedUntil: true,
        order: { select: { kdvRate: true, packagingUnitFee: true } },
        product: { select: { supplierId: true, costPrice: true } },
      },
    });

    const emptyProfit = (): OrderProfitability =>
      ({
        revenue: 0,
        cost: 0,
        profit: 0,
        margin: 0,
        grossMarginKdvIncl: 0,
        netProfitKdvExcl: 0,
        netKdv: 0,
        cardCommissionSpread: 0,
      }) as OrderProfitability;

    for (const item of items) {
      const effectiveQty = item.qty;
      if (effectiveQty <= 0) continue;

      // §3.3/§3.9 — dealer_return: yalnız platform komisyon kârı (maliyet/KDV yok).
      if (item.fulfillmentSource === 'dealer_return') {
        const commission =
          toNum(item.unitPrice) *
          effectiveQty *
          (DEFAULT_DEALER_RETURN_COMMISSION_PERCENT / 100);
        const cur0 = result.get(item.orderId) ?? emptyProfit();
        cur0.revenue += commission;
        result.set(item.orderId, cur0);
        continue;
      }

      const effItem = { ...item, qty: effectiveQty };

      // Çözümleme önceliği: override → snapshot → product (TEK KAYNAK).
      const effectiveSupplierId = resolveSupplierId(item);
      const config = effectiveSupplierId
        ? (configMap.get(effectiveSupplierId) ?? null)
        : null;

      const revenue = this._calcItemRevenue(effItem);
      const supplyCost = this._calcItemCost(effItem, config);
      // TEK KAYNAK: maliyet = mal maliyeti (costPrice × (1+KDV)). Sipariş-başı
      // ekMaliyet kalktı — tüm maliyet costPrice'tan türer.
      const cost = supplyCost;

      // KDV bileşenleri: tahsil edilen satış KDV'si ürün cirosundan + paketleme
      // ücretinden (paketleme KDV-DAHİL, kullanıcı kararı 2026-06-24); ödenen
      // alış KDV'si yalnız ürün alış maliyetinden.
      const saleKdvRate = item.order.kdvRate ?? 20;
      const packagingTotal = toNum(item.order.packagingUnitFee) * effectiveQty;
      const collectedKdv =
        calcItemCollectedKdv(item.unitPrice, effectiveQty, saleKdvRate) +
        calcPackagingKdvPortion(packagingTotal, saleKdvRate);
      const paidKdv = calcSupplyKdvPortion(
        supplyCost,
        config?.purchaseVatRate,
      );

      const cur = result.get(item.orderId) ?? emptyProfit();
      cur.revenue += revenue;
      cur.cost += cost;
      result.set(item.orderId, cur);

      const ka = kdvAccum.get(item.orderId) ?? { collectedKdv: 0, paidKdv: 0 };
      ka.collectedKdv += collectedKdv;
      ka.paidKdv += paidKdv;
      kdvAccum.set(item.orderId, ka);
    }

    // "Kendim İçin" kargo bedeli (Order.cargoCost): bayiden tahsil edilen +200
    // hem GELİR (siparişe yansıyan toplama dahil) hem de bizim kargo MALİYETİMİZ
    // olarak sipariş başına BİR KEZ eklenir → pass-through (kâr nötr), dökümde
    // hem gelir hem maliyet tarafında görünür. self-DIŞI siparişlerde cargoCost
    // null/0 → hiçbir şey değişmez (paketleme gibi dealer-charged bir bedeldir).
    // Sipariş düzeyi alanlar: kargo (pass-through) + kart komisyon snapshot'ları
    // (gerçek/müşteri oran/tutar) tek sorguda. Geçmiş siparişte gerçek oran
    // yoksa şu anki aktif POS'un oranına düşeceğiz (muhasebe.md karar #2).
    const [orderRows, activePos] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          id: { in: orderIds },
          tenantId,
          // §3.2 — awaiting_payment (tahsil edilmemiş kart) ve iptal/iade HARİÇ.
          // Tüm muhasebe yüzeyleriyle (Z-rapor, Tedarikçi Cari, ProfitCalculator)
          // AYNI statü kümesi → Karlılık artık onlarla mutabık.
          status: { in: ['paid', 'preparing', 'shipped'] },
        },
        select: {
          id: true,
          cargoCost: true,
          paymentType: true,
          total: true,
          cardCommissionRate: true,
          cardCommissionAmount: true,
          cardCommissionRateActual: true,
          cardCommissionAmountActual: true,
        },
      }),
      this.prisma.posProvider.findFirst({
        where: { active: true },
        select: { commissionRate: true, customerCommissionRate: true },
      }),
    ]);

    for (const o of orderRows) {
      const cur = result.get(o.id);
      if (!cur) continue;

      // "Kendim İçin" kargo bedeli (Order.cargoCost): bayiden tahsil edilen +200
      // hem GELİR hem MALİYET → pass-through (kâr nötr). self-DIŞI'nda null/0.
      const cargo = o.cargoCost ? Number(o.cargoCost) : 0;
      if (cargo !== 0) {
        cur.revenue += cargo;
        cur.cost += cargo;
      }

      // Kart komisyon farkı: kart ödemesiyse müşteriden alınan − POS'a ödenen.
      cur.cardCommissionSpread = calcCardCommissionSpread({
        paymentType: o.paymentType,
        total: o.total,
        customerAmount: o.cardCommissionAmount,
        customerRate: o.cardCommissionRate,
        realAmount: o.cardCommissionAmountActual,
        realRate: o.cardCommissionRateActual,
        fallbackCustomerRate: activePos?.customerCommissionRate,
        fallbackRealRate: activePos?.commissionRate,
      });
    }

    for (const [orderId, entry] of result) {
      const ka = kdvAccum.get(orderId) ?? { collectedKdv: 0, paidKdv: 0 };
      const central = composeCentralProfit({
        revenue: entry.revenue,
        cost: entry.cost,
        collectedKdv: ka.collectedKdv,
        paidKdv: ka.paidKdv,
        cardCommissionSpread: entry.cardCommissionSpread,
      });
      entry.grossMarginKdvIncl = central.grossMarginKdvIncl;
      entry.netKdv = central.netKdv;
      entry.netProfitKdvExcl = central.netProfitKdvExcl;
      // Legacy alanların anlamı düzeltildi: kâr = KDV-hariç net kâr, marj =
      // net kâr / net gelir(KDV hariç). Net gelir = gelir − tahsil edilen KDV.
      entry.profit = central.netProfitKdvExcl;
      const netRevenueExcl = entry.revenue - ka.collectedKdv;
      entry.margin =
        netRevenueExcl > 0 ? (entry.profit / netRevenueExcl) * 100 : 0;
    }
    return result;
  }

  /**
   * Tek bir tedarikçi için derin karlılık raporu:
   * - Genel özet (gelir / maliyet / kar / marj)
   * - Günlük trend (sparkline için)
   * - En karlı ürünler (top N)
   * - Sipariş listesi (en yenisi en üstte)
   */
  async getSupplierDetail(
    tenantId: string,
    supplierId: string,
    query: ProfitabilityQueryDto,
  ) {
    // TR takvim günü sınırları: başlangıç gün başı, bitiş günü DAHİL (gün sonu).
    const dateFrom = trDayStart(query.dateFrom) ?? new Date('2000-01-01');
    const dateTo = query.dateTo
      ? new Date(trDayEndExclusive(query.dateTo)!.getTime() - 1)
      : new Date();

    const periodMs = dateTo.getTime() - dateFrom.getTime();
    const prevFrom = new Date(dateFrom.getTime() - periodMs);
    const prevTo = new Date(dateFrom.getTime() - 1);

    const [supplier, configMap, currentItems, prevItems] = await Promise.all([
      this.prisma.supplier.findFirst({
        where: { id: supplierId, tenantId },
        select: { id: true, name: true },
      }),
      this.getSupplierVatMap(tenantId),
      this._fetchSupplierItemsDetailed(tenantId, dateFrom, dateTo, supplierId),
      this._fetchSupplierItemsDetailed(tenantId, prevFrom, prevTo, supplierId),
    ]);

    if (!supplier) {
      return {
        supplier: { id: supplierId, name: 'Bilinmeyen Tedarikçi' },
        period: { from: dateFrom, to: dateTo },
        summary: this._emptySummary(),
        dailyTrend: [],
        topProducts: [],
        orders: [],
      };
    }

    const config = configMap.get(supplierId) ?? null;

    let revenue = 0;
    let cost = 0;
    let itemCount = 0;
    const orderMap = new Map<
      string,
      {
        id: string;
        humanOrderNo: string;
        createdAt: Date;
        status: string;
        customerName: string | null;
        revenue: number;
        cost: number;
        itemCount: number;
      }
    >();
    const productMap = new Map<
      string,
      {
        productId: string | null;
        productName: string;
        sku: string | null;
        qty: number;
        revenue: number;
        cost: number;
      }
    >();
    const dailyMap = new Map<
      string,
      { date: string; revenue: number; cost: number; orderIds: Set<string> }
    >();

    const now = Date.now();
    // Bu tedarikçiden FİİLEN alım yapılan siparişler (depo değil) —
    // sipariş-başı ekMaliyet yalnız bunlara eklenir.
    const purchaseOrderIds = new Set<string>();
    const dayPurchaseOrders = new Map<string, Set<string>>();

    for (const item of currentItems) {
      const itemRevenue = this._calcItemRevenue(item);
      const itemCost = this._calcItemCost(item, config);

      revenue += itemRevenue;
      cost += itemCost;
      itemCount += item.qty;

      const orderId = item.order.id;
      if (supplierUnitQty(item, now) > 0) {
        purchaseOrderIds.add(orderId);
        const dk = trDateKey(item.order.createdAt);
        if (!dayPurchaseOrders.has(dk)) dayPurchaseOrders.set(dk, new Set());
        dayPurchaseOrders.get(dk)!.add(orderId);
      }
      if (!orderMap.has(orderId)) {
        orderMap.set(orderId, {
          id: orderId,
          humanOrderNo: item.order.humanOrderNo,
          createdAt: item.order.createdAt,
          status: item.order.status,
          customerName:
            item.order.endCustomerName ?? item.order.customerName ?? null,
          revenue: 0,
          cost: 0,
          itemCount: 0,
        });
      }
      const ord = orderMap.get(orderId)!;
      ord.revenue += itemRevenue;
      ord.cost += itemCost;
      ord.itemCount += item.qty;

      const productKey = item.product?.id ?? `__del__${item.productName}`;
      if (!productMap.has(productKey)) {
        productMap.set(productKey, {
          productId: item.product?.id ?? null,
          productName: item.product?.name ?? item.productName,
          sku:
            item.product?.internalCode ?? item.supplierSku ?? null,
          qty: 0,
          revenue: 0,
          cost: 0,
        });
      }
      const prod = productMap.get(productKey)!;
      prod.qty += item.qty;
      prod.revenue += itemRevenue;
      prod.cost += itemCost;

      const dayKey = trDateKey(item.order.createdAt);
      if (!dailyMap.has(dayKey)) {
        dailyMap.set(dayKey, {
          date: dayKey,
          revenue: 0,
          cost: 0,
          orderIds: new Set(),
        });
      }
      const day = dailyMap.get(dayKey)!;
      day.revenue += itemRevenue;
      day.cost += itemCost;
      day.orderIds.add(orderId);
    }

    // (TEK KAYNAK: sipariş-başı ekMaliyet kalktı — tüm maliyet costPrice'tan türer.)

    let prevRevenue = 0;
    let prevCost = 0;
    const prevPurchaseOrderIds = new Set<string>();
    for (const item of prevItems) {
      prevRevenue += this._calcItemRevenue(item);
      prevCost += this._calcItemCost(item, config);
      if (supplierUnitQty(item, now) > 0) prevPurchaseOrderIds.add(item.order.id);
    }
    // (TEK KAYNAK: sipariş-başı ekMaliyet kalktı — prev dönem + ürün dağıtımına
    // ek maliyet eklenmez; tüm maliyet costPrice × (1+KDV)'den türer.)

    const profit = revenue - cost;
    const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
    const prevProfit = prevRevenue - prevCost;
    const prevMargin = prevRevenue > 0 ? (prevProfit / prevRevenue) * 100 : 0;

    const orders = Array.from(orderMap.values())
      .map((o) => ({
        id: o.id,
        humanOrderNo: o.humanOrderNo,
        status: o.status,
        customerName: o.customerName,
        revenue: o.revenue,
        cost: o.cost,
        itemCount: o.itemCount,
        profit: o.revenue - o.cost,
        margin: o.revenue > 0 ? ((o.revenue - o.cost) / o.revenue) * 100 : 0,
        createdAt: o.createdAt.toISOString(),
      }))
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );

    const topProducts = Array.from(productMap.values())
      .map((p) => ({
        productId: p.productId,
        productName: p.productName,
        sku: p.sku,
        qty: p.qty,
        revenue: p.revenue,
        cost: p.cost,
        profit: p.revenue - p.cost,
        margin: p.revenue > 0 ? ((p.revenue - p.cost) / p.revenue) * 100 : 0,
      }))
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 20);

    const dailyTrend = Array.from(dailyMap.values())
      .map((d) => ({
        date: d.date,
        revenue: d.revenue,
        cost: d.cost,
        profit: d.revenue - d.cost,
        orderCount: d.orderIds.size,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      supplier: { id: supplier.id, name: supplier.name },
      period: { from: dateFrom, to: dateTo },
      summary: {
        revenue,
        cost,
        profit,
        margin,
        orderCount: orderMap.size,
        itemCount,
        prevRevenue,
        prevProfit,
        prevMargin,
      },
      dailyTrend,
      topProducts,
      orders,
    };
  }

  private _emptySummary() {
    return {
      revenue: 0,
      cost: 0,
      profit: 0,
      margin: 0,
      orderCount: 0,
      itemCount: 0,
      collectedKdv: 0,
      paidKdv: 0,
      netKdv: 0,
      prevRevenue: 0,
      prevProfit: 0,
      prevNetKdv: 0,
      prevMargin: 0,
    };
  }

  /**
   * Profesyonel Excel raporu üretir — 3 sheet:
   *   1) Özet (KPI kartları + dönem bilgisi)
   *   2) Tedarikçi Detay (zebra-stripe, renkli marj, toplam satırı)
   *   3) Filtreler & Metodoloji
   * Audit log bırakır.
   */
  async getExcelReport(
    tenantId: string,
    query: ProfitabilityQueryDto,
    actor: { id: string; email?: string | null },
    supplierNameForFilter?: string | null,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const data = await this.getAnalysis(tenantId, query);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Toptan Budur';
    workbook.created = new Date();
    workbook.properties.date1904 = false;

    this._buildSummarySheet(workbook, data);
    this._buildSupplierSheet(workbook, data);
    this._buildInfoSheet(workbook, data, query, actor, supplierNameForFilter);

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const filename = `karlilik-analizi-${trTodayKey()}.xlsx`;

    void this.audit.log({
      actorType: 'admin',
      actorId: actor.id,
      tenantId,
      action: 'EXPORT',
      target: 'profitability-analysis',
      metadata: {
        kind: 'profitability-analysis',
        filter: {
          dateFrom: query.dateFrom ?? null,
          dateTo: query.dateTo ?? null,
          supplierId: query.supplierId ?? null,
        },
        supplierRowCount: data.bySupplier.length,
        actorEmail: actor.email ?? null,
      },
    });

    return { buffer, filename };
  }

  // ---------------------------------------------------------------
  // Excel sheet builders
  // ---------------------------------------------------------------

  private _buildSummarySheet(
    workbook: ExcelJS.Workbook,
    data: Awaited<ReturnType<AdminProfitabilityService['getAnalysis']>>,
  ): void {
    const sheet = workbook.addWorksheet('Özet', {
      views: [{ showGridLines: false }],
    });

    // Sütun genişlikleri — 6 sütunlu mini layout
    sheet.columns = [
      { width: 4 },
      { width: 22 },
      { width: 22 },
      { width: 22 },
      { width: 22 },
      { width: 4 },
    ];

    // Üst başlık bandı (B2:E2)
    sheet.mergeCells('B2:E2');
    const title = sheet.getCell('B2');
    title.value = 'KARLILIK ANALİZİ RAPORU';
    title.font = {
      name: 'Calibri',
      size: 18,
      bold: true,
      color: { argb: COLOR.white },
    };
    title.alignment = { horizontal: 'center', vertical: 'middle' };
    title.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: COLOR.navy },
    };
    sheet.getRow(2).height = 42;

    // Alt başlık — dönem
    sheet.mergeCells('B3:E3');
    const period = sheet.getCell('B3');
    period.value = `Dönem: ${fmtDateTR(data.period.from)} — ${fmtDateTR(data.period.to)}`;
    period.font = {
      name: 'Calibri',
      size: 11,
      color: { argb: COLOR.white },
    };
    period.alignment = { horizontal: 'center', vertical: 'middle' };
    period.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: COLOR.navyLight },
    };
    sheet.getRow(3).height = 22;

    // Boşluk
    sheet.getRow(4).height = 12;

    // KPI kartları — 4 kart yan yana (B5:E7)
    const s = data.summary;
    this._buildKpiCard(sheet, 'B5', 'B6', 'B7', 'TOPLAM GELİR', s.revenue, NUMFMT_TRY, s.revenue, s.prevRevenue);
    this._buildKpiCard(sheet, 'C5', 'C6', 'C7', 'TOPLAM MALİYET', s.cost, NUMFMT_TRY);
    this._buildKpiCard(sheet, 'D5', 'D6', 'D7', 'NET KAR', s.profit, NUMFMT_TRY, s.profit, s.prevProfit);
    this._buildKpiCard(sheet, 'E5', 'E6', 'E7', 'KARLILIK ORANI', s.margin, NUMFMT_PCT, s.margin, s.prevMargin);

    sheet.getRow(5).height = 22;
    sheet.getRow(6).height = 32;
    sheet.getRow(7).height = 20;

    // Boşluk
    sheet.getRow(8).height = 14;

    // Sipariş & Kalem bilgisi
    sheet.mergeCells('B9:C9');
    const ordCell = sheet.getCell('B9');
    ordCell.value = `Toplam Sipariş: ${s.orderCount.toLocaleString('tr-TR')}`;
    ordCell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: COLOR.navy } };
    ordCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ordCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.zebraEven } };
    ordCell.border = this._thinBorder();

    sheet.mergeCells('D9:E9');
    const itemCell = sheet.getCell('D9');
    itemCell.value = `Toplam Kalem: ${s.itemCount.toLocaleString('tr-TR')}`;
    itemCell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: COLOR.navy } };
    itemCell.alignment = { horizontal: 'center', vertical: 'middle' };
    itemCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.zebraEven } };
    itemCell.border = this._thinBorder();
    sheet.getRow(9).height = 26;

    // Maliyet eksik uyarısı
    if (data.zeroCostItemCount > 0) {
      sheet.getRow(10).height = 10;
      sheet.mergeCells('B11:E11');
      const warn = sheet.getCell('B11');
      warn.value = `⚠ ${data.zeroCostItemCount.toLocaleString('tr-TR')} kalem için alış fiyatı (costPrice) sıfır — bu kalemlerin maliyeti hesaplanamadı. Tedarikçi ayarlarını veya XML feed'inizi kontrol edin.`;
      warn.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLOR.amberText } };
      warn.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
      warn.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: COLOR.amberBg },
      };
      warn.border = this._thinBorder();
      sheet.getRow(11).height = 36;
    }
  }

  private _buildKpiCard(
    sheet: ExcelJS.Worksheet,
    labelAddr: string,
    valueAddr: string,
    deltaAddr: string,
    label: string,
    value: number,
    numFmt: string,
    current?: number,
    previous?: number,
  ): void {
    // Label
    const labelCell = sheet.getCell(labelAddr);
    labelCell.value = label;
    labelCell.font = {
      name: 'Calibri',
      size: 9,
      bold: true,
      color: { argb: COLOR.textMuted },
    };
    labelCell.alignment = { horizontal: 'center', vertical: 'middle' };
    labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.white } };
    labelCell.border = {
      top: { style: 'thin', color: { argb: COLOR.border } },
      left: { style: 'thin', color: { argb: COLOR.border } },
      right: { style: 'thin', color: { argb: COLOR.border } },
    };

    // Değer
    const valueCell = sheet.getCell(valueAddr);
    valueCell.value = value;
    valueCell.numFmt = numFmt;
    valueCell.font = {
      name: 'Calibri',
      size: 16,
      bold: true,
      color: { argb: COLOR.navy },
    };
    valueCell.alignment = { horizontal: 'center', vertical: 'middle' };
    valueCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.white } };
    valueCell.border = {
      left: { style: 'thin', color: { argb: COLOR.border } },
      right: { style: 'thin', color: { argb: COLOR.border } },
    };

    // Delta (önceki döneme göre değişim)
    const deltaCell = sheet.getCell(deltaAddr);
    if (current !== undefined && previous !== undefined) {
      let deltaText = '';
      let color: string = COLOR.textMuted;
      if (previous === 0) {
        deltaText = current > 0 ? '+∞ vs. önceki dönem' : '— vs. önceki dönem';
      } else {
        const d = ((current - previous) / Math.abs(previous)) * 100;
        const sign = d >= 0 ? '+' : '';
        deltaText = `${sign}${d.toFixed(1)}% vs. önceki dönem`;
        color = d >= 0 ? COLOR.success : COLOR.danger;
      }
      deltaCell.value = deltaText;
      deltaCell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: color } };
    } else {
      deltaCell.value = '';
    }
    deltaCell.alignment = { horizontal: 'center', vertical: 'middle' };
    deltaCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.white } };
    deltaCell.border = {
      left: { style: 'thin', color: { argb: COLOR.border } },
      right: { style: 'thin', color: { argb: COLOR.border } },
      bottom: { style: 'thin', color: { argb: COLOR.border } },
    };
  }

  private _buildSupplierSheet(
    workbook: ExcelJS.Workbook,
    data: Awaited<ReturnType<AdminProfitabilityService['getAnalysis']>>,
  ): void {
    const sheet = workbook.addWorksheet('Tedarikçi Detay', {
      views: [{ state: 'frozen', xSplit: 2, ySplit: 1, showGridLines: false }],
    });

    sheet.columns = [
      { header: '#', key: 'rank', width: 6 },
      { header: 'Tedarikçi', key: 'supplierName', width: 34 },
      { header: 'Gelir', key: 'revenue', width: 18, style: { numFmt: NUMFMT_TRY } },
      { header: 'Maliyet', key: 'cost', width: 18, style: { numFmt: NUMFMT_TRY } },
      { header: 'Net Kar', key: 'profit', width: 18, style: { numFmt: NUMFMT_TRY } },
      { header: 'Marj %', key: 'margin', width: 12, style: { numFmt: NUMFMT_PCT } },
      { header: 'Sipariş', key: 'orderCount', width: 12, style: { numFmt: NUMFMT_INT } },
      { header: 'Kalem', key: 'itemCount', width: 12, style: { numFmt: NUMFMT_INT } },
    ];

    // Başlık satırı stili
    const header = sheet.getRow(1);
    header.height = 32;
    header.eachCell((cell) => {
      cell.font = {
        name: 'Calibri',
        size: 11,
        bold: true,
        color: { argb: COLOR.white },
      };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: COLOR.navy },
      };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'thin', color: { argb: COLOR.navy } },
        bottom: { style: 'medium', color: { argb: COLOR.navy } },
        left: { style: 'thin', color: { argb: COLOR.navyLight } },
        right: { style: 'thin', color: { argb: COLOR.navyLight } },
      };
    });

    // Veri satırları (zebra-stripe + renkli marj)
    data.bySupplier.forEach((s, i) => {
      const rowNum = i + 2;
      const row = sheet.addRow({
        rank: i + 1,
        supplierName: s.supplierName,
        revenue: s.revenue,
        cost: s.cost,
        profit: s.profit,
        margin: s.margin,
        orderCount: s.orderCount,
        itemCount: s.itemCount,
      });
      row.height = 22;

      const isEven = i % 2 === 1;
      const bgColor = isEven ? COLOR.zebraEven : COLOR.white;

      row.eachCell((cell, colNum) => {
        cell.font = {
          name: 'Calibri',
          size: 11,
          color: { argb: 'FF1F2937' },
        };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
        cell.border = {
          bottom: { style: 'thin', color: { argb: COLOR.border } },
        };

        // Rank ve sayı sütunları sağa yaslı; isim sola
        if (colNum === 1) {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
          cell.font = { name: 'Calibri', size: 10, color: { argb: COLOR.textMuted } };
        } else if (colNum === 2) {
          cell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
          cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF1F2937' } };
        } else {
          cell.alignment = { horizontal: 'right', vertical: 'middle', indent: 1 };
        }

        // Net Kar — yeşil emerald, kalın
        if (colNum === 5) {
          cell.font = {
            name: 'Calibri',
            size: 11,
            bold: true,
            color: { argb: COLOR.success },
          };
        }

        // Marj — renkli (≥25 yeşil, 10-25 amber, <10 kırmızı)
        if (colNum === 6) {
          let color: string = COLOR.danger;
          if (s.margin >= 25) color = COLOR.success;
          else if (s.margin >= 10) color = COLOR.warning;
          cell.font = {
            name: 'Calibri',
            size: 11,
            bold: true,
            color: { argb: color },
          };
        }
      });
    });

    // TOPLAM satırı
    const totalRowNum = data.bySupplier.length + 2;
    const totalRow = sheet.addRow({
      rank: '',
      supplierName: 'TOPLAM',
      revenue: data.summary.revenue,
      cost: data.summary.cost,
      profit: data.summary.profit,
      margin: data.summary.margin,
      orderCount: data.summary.orderCount,
      itemCount: data.summary.itemCount,
    });
    totalRow.height = 30;
    totalRow.eachCell((cell, colNum) => {
      cell.font = {
        name: 'Calibri',
        size: 12,
        bold: true,
        color: { argb: COLOR.white },
      };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: COLOR.navy },
      };
      cell.border = {
        top: { style: 'double', color: { argb: COLOR.navy } },
        bottom: { style: 'medium', color: { argb: COLOR.navy } },
      };
      if (colNum === 1 || colNum === 2) {
        cell.alignment = { horizontal: colNum === 1 ? 'center' : 'left', vertical: 'middle', indent: colNum === 2 ? 1 : 0 };
      } else {
        cell.alignment = { horizontal: 'right', vertical: 'middle', indent: 1 };
      }
    });

    // Auto filter sadece veri sütunları üstünde
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: 8 },
    };

    // Boş veri durumu
    if (data.bySupplier.length === 0) {
      sheet.mergeCells('A2:H2');
      const empty = sheet.getCell('A2');
      empty.value = 'Bu dönem için tedarikçi verisi bulunamadı.';
      empty.font = { name: 'Calibri', size: 11, italic: true, color: { argb: COLOR.textMuted } };
      empty.alignment = { horizontal: 'center', vertical: 'middle' };
      sheet.getRow(2).height = 40;
    }
  }

  private _buildInfoSheet(
    workbook: ExcelJS.Workbook,
    data: Awaited<ReturnType<AdminProfitabilityService['getAnalysis']>>,
    query: ProfitabilityQueryDto,
    actor: { id: string; email?: string | null },
    supplierNameForFilter?: string | null,
  ): void {
    const sheet = workbook.addWorksheet('Filtreler & Bilgi', {
      views: [{ showGridLines: false }],
    });
    sheet.columns = [
      { width: 4 },
      { width: 28 },
      { width: 50 },
      { width: 4 },
    ];

    // Bölüm başlığı: Filtreler
    sheet.mergeCells('B2:C2');
    const h1 = sheet.getCell('B2');
    h1.value = 'UYGULANAN FİLTRELER';
    h1.font = { name: 'Calibri', size: 12, bold: true, color: { argb: COLOR.white } };
    h1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.navy } };
    h1.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
    sheet.getRow(2).height = 26;

    const rows: Array<[string, string]> = [
      ['Tarih Aralığı', `${fmtDateTR(data.period.from)} — ${fmtDateTR(data.period.to)}`],
      [
        'Tedarikçi Filtresi',
        query.supplierId
          ? `${supplierNameForFilter ?? '—'} (${query.supplierId})`
          : 'Tümü',
      ],
    ];

    let r = 3;
    for (const [k, v] of rows) {
      const isEven = (r - 3) % 2 === 1;
      const bg = isEven ? COLOR.zebraEven : COLOR.white;
      const kc = sheet.getCell(`B${r}`);
      const vc = sheet.getCell(`C${r}`);
      kc.value = k;
      vc.value = v;
      kc.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLOR.textMuted } };
      vc.font = { name: 'Calibri', size: 11, color: { argb: 'FF1F2937' } };
      kc.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
      vc.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
      kc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      vc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      kc.border = { bottom: { style: 'thin', color: { argb: COLOR.border } } };
      vc.border = { bottom: { style: 'thin', color: { argb: COLOR.border } } };
      sheet.getRow(r).height = 22;
      r++;
    }

    // Boşluk
    r++;

    // Bölüm başlığı: Metodoloji
    sheet.mergeCells(`B${r}:C${r}`);
    const h2 = sheet.getCell(`B${r}`);
    h2.value = 'HESAPLAMA METODOLOJİSİ';
    h2.font = { name: 'Calibri', size: 12, bold: true, color: { argb: COLOR.white } };
    h2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.navy } };
    h2.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
    sheet.getRow(r).height = 26;
    r++;

    const methodRows: Array<[string, string]> = [
      ['Gelir', 'Satış birim fiyatı × adet × (1 + satış KDV oranı). Müşteriden tahsil edilen brüt tutar.'],
      ['Maliyet', 'Kalem: Alış fiyatı (sipariş anındaki snapshot tercih edilir) × (1 + alış KDV) − tedarikçi indirimi, sonra adet ile çarpılır. Ek maliyet (kargo/hizmet) tedarikçi başına SİPARİŞTE BİR KEZ eklenir — yalnız o tedarikçiden fiilen alım yapılan siparişlere.'],
      ['Net Kar', 'Gelir − Maliyet.'],
      ['Marj %', '(Net Kar ÷ Gelir) × 100. Gelir sıfırsa 0 gösterilir.'],
      ['Dahil Edilen Siparişler', 'Statüsü iptal (cancelled) ya da iade (refunded) OLMAYAN tüm siparişler. Admin onayı beklenmez — paid, preparing, shipped statülerinin hepsi ciroya yansır.'],
      ['Önceki Dönem', 'Mevcut dönemin uzunluğu kadar geriye gidilerek hesaplanır.'],
    ];

    for (const [k, v] of methodRows) {
      const isEven = (r % 2) === 1;
      const bg = isEven ? COLOR.zebraEven : COLOR.white;
      const kc = sheet.getCell(`B${r}`);
      const vc = sheet.getCell(`C${r}`);
      kc.value = k;
      vc.value = v;
      kc.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLOR.textMuted } };
      vc.font = { name: 'Calibri', size: 10, color: { argb: 'FF1F2937' } };
      kc.alignment = { horizontal: 'left', vertical: 'top', indent: 1, wrapText: true };
      vc.alignment = { horizontal: 'left', vertical: 'top', indent: 1, wrapText: true };
      kc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      vc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      kc.border = { bottom: { style: 'thin', color: { argb: COLOR.border } } };
      vc.border = { bottom: { style: 'thin', color: { argb: COLOR.border } } };
      sheet.getRow(r).height = 36;
      r++;
    }

    // Boşluk
    r++;

    // Bölüm başlığı: Rapor Bilgisi
    sheet.mergeCells(`B${r}:C${r}`);
    const h3 = sheet.getCell(`B${r}`);
    h3.value = 'RAPOR BİLGİSİ';
    h3.font = { name: 'Calibri', size: 12, bold: true, color: { argb: COLOR.white } };
    h3.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.navy } };
    h3.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
    sheet.getRow(r).height = 26;
    r++;

    const now = new Date();
    const infoRows: Array<[string, string]> = [
      ['Üretim Zamanı', now.toLocaleString('tr-TR')],
      ['Üreten', actor.email ?? actor.id],
      ['Sistem', 'Toptan Budur — Karlılık Analizi Modülü'],
    ];

    for (const [k, v] of infoRows) {
      const isEven = (r % 2) === 1;
      const bg = isEven ? COLOR.zebraEven : COLOR.white;
      const kc = sheet.getCell(`B${r}`);
      const vc = sheet.getCell(`C${r}`);
      kc.value = k;
      vc.value = v;
      kc.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLOR.textMuted } };
      vc.font = { name: 'Calibri', size: 11, color: { argb: 'FF1F2937' } };
      kc.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
      vc.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
      kc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      vc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      kc.border = { bottom: { style: 'thin', color: { argb: COLOR.border } } };
      vc.border = { bottom: { style: 'thin', color: { argb: COLOR.border } } };
      sheet.getRow(r).height = 22;
      r++;
    }
  }

  private _thinBorder(): Partial<ExcelJS.Borders> {
    return {
      top: { style: 'thin', color: { argb: COLOR.border } },
      left: { style: 'thin', color: { argb: COLOR.border } },
      right: { style: 'thin', color: { argb: COLOR.border } },
      bottom: { style: 'thin', color: { argb: COLOR.border } },
    };
  }

  // ---------------------------------------------------------------
  // Order item fetch & aggregation (DEĞİŞMEDİ — sadece sunum katmanı yenilendi)
  // ---------------------------------------------------------------

  /**
   * Karlılığa dahil edilecek sipariş kalemlerini getirir.
   *
   * Politika (kullanıcı kararı):
   * - Sipariş statüsü `cancelled` veya `refunded` OLMADIĞI sürece tüm
   *   siparişler dahil edilir. Onay/hazırlık/kargo gibi tüm ara statüler
   *   ciroya yansır (admin "onayla" basmamış olsa bile).
   */
  private async _fetchOrderItems(
    tenantId: string,
    from: Date,
    to: Date,
    supplierId?: string,
  ) {
    return this.prisma.orderItem.findMany({
      where: {
        order: {
          tenantId,
          // §3.2 — awaiting_payment (tahsil edilmemiş kart) ve iptal/iade HARİÇ.
          // Tüm muhasebe yüzeyleriyle (Z-rapor, Tedarikçi Cari, ProfitCalculator)
          // AYNI statü kümesi → Karlılık artık onlarla mutabık.
          status: { in: ['paid', 'preparing', 'shipped'] },
          createdAt: { gte: from, lte: to },
        },
        // Tek bir tedarikçi filtresi istenirse çözümleme önceliğini BİREBİR
        // yansıt: override → snapshot → product (silinmiş ürünler snapshot'tan).
        ...(supplierId ? { OR: supplierMatchOr(supplierId) } : {}),
      },
      select: {
        qty: true,
        unitPrice: true,
        costPriceSnapshot: true,
        supplierIdOverride: true,
        supplierIdSnapshot: true,
        supplierNameSnapshot: true,
        fulfillmentSource: true,
        houseStockDispatchedAt: true,
        houseStockReservedQty: true,
        houseStockReservedUntil: true,
        supplierOverride: { select: { id: true, name: true } },
        order: { select: { id: true, kdvRate: true, createdAt: true, packagingUnitFee: true } },
        product: {
          select: {
            supplierId: true,
            costPrice: true,
            supplier: { select: { name: true } },
          },
        },
      },
    });
  }

  private _aggregate(
    items: Awaited<ReturnType<typeof this._fetchOrderItems>>,
    configMap: Map<string, ProfitConfig>,
  ) {
    const supplierMap = new Map<
      string,
      {
        supplierName: string;
        revenue: number;
        cost: number;
        orderIds: Set<string>;
        itemCount: number;
      }
    >();
    const dailyMap = new Map<
      string,
      { date: string; revenue: number; cost: number; orderIds: Set<string> }
    >();

    let zeroCostItemCount = 0;
    // KDV farkı (Aylık Finans paneli için): tahsil edilen satış KDV'si ile
    // alışta ödenen KDV summary seviyesinde toplanır. Kalem-bazlı kurallar
    // getOrderProfitability ile BİREBİR.
    let totalCollectedKdv = 0;
    let totalPaidKdv = 0;

    for (const item of items) {
      let supplierId: string;
      let supplierName: string;
      let totalCost: number;

      // Çözümleme önceliği: override → snapshot → güncel ürün (TEK KAYNAK:
      // supplier-attribution.util). id ve ad TEK çözümlemeyle gelir → daima
      // uyumlu. Snapshot dalı sayesinde ürün hard-delete edilse bile sipariş
      // doğru tedarikçiye atfedilir.
      const { id: effectiveSupplierId, name: effectiveSupplierName } =
        resolveSupplier(item);

      if (!effectiveSupplierId) {
        supplierId = DELETED_SUPPLIER_ID;
        supplierName = DELETED_SUPPLIER_NAME;
        // Tedarikçi atfı tamamen kaybolmuş (override/snapshot/product yok).
        // Maliyeti SIFIRLAMA — costPriceSnapshot'tan hesapla; aksi halde
        // silinmiş ürünler maliyetsiz görünüp toplam kârı yapay olarak şişirir.
        // Snapshot da yoksa 0 sayılır (zeroCostItemCount uyarısına düşer).
        if (toNum(item.costPriceSnapshot) === 0) zeroCostItemCount += item.qty;
        totalCost = calcItemSupplyCost(item.costPriceSnapshot, item.qty, null);
      } else {
        supplierId = effectiveSupplierId;
        supplierName = effectiveSupplierName;
        // Snapshot önce: sipariş anındaki alış fiyatı. Yoksa güncel DB değeri.
        const costPrice = item.costPriceSnapshot ?? item.product?.costPrice;
        // Tedarikçi snapshot ile çözüldüğü için silinmiş üründe bile DOĞRU
        // tedarikçinin alış KDV oranı uygulanır (varsayılan %20 değil).
        const config = configMap.get(supplierId) ?? null;

        if (toNum(costPrice) === 0) zeroCostItemCount += item.qty;
        // TEK KAYNAK: kalem mal maliyeti = costPrice × (1+KDV) × qty. Sipariş-başı
        // ekMaliyet kalktı — tüm maliyet costPrice'tan türer (ekonomik COGS).
        totalCost = calcItemSupplyCost(costPrice, item.qty, config);
      }

      // unitPrice KDV hariç kaydedilir; müşteriden alınan gerçek gelir KDV dahildir.
      // Paketleme ücreti per-unit, KDV hariç eklenir (Order.packagingUnitFee snapshot).
      const saleKdvRate = item.order.kdvRate ?? 20;
      const productRevenue = toNum(item.unitPrice) * item.qty * (1 + saleKdvRate / 100);
      const packagingRevenue = toNum(item.order.packagingUnitFee ?? 0) * item.qty;
      const revenue = productRevenue + packagingRevenue;

      // KDV bileşenleri (summary netKdv için): tahsil = ürün satış KDV'si +
      // paketleme KDV payı; ödenen = mal maliyetine gömülü alış KDV'si.
      totalCollectedKdv +=
        calcItemCollectedKdv(item.unitPrice, item.qty, saleKdvRate) +
        calcPackagingKdvPortion(packagingRevenue, saleKdvRate);
      totalPaidKdv += calcSupplyKdvPortion(
        totalCost,
        configMap.get(supplierId)?.purchaseVatRate,
      );

      if (!supplierMap.has(supplierId)) {
        supplierMap.set(supplierId, {
          supplierName,
          revenue: 0,
          cost: 0,
          orderIds: new Set(),
          itemCount: 0,
        });
      }

      const entry = supplierMap.get(supplierId)!;
      entry.revenue += revenue;
      entry.cost += totalCost;
      entry.orderIds.add(item.order.id);
      entry.itemCount += item.qty;

      const dayKey = trDateKey(item.order.createdAt);
      if (!dailyMap.has(dayKey)) {
        dailyMap.set(dayKey, {
          date: dayKey,
          revenue: 0,
          cost: 0,
          orderIds: new Set(),
        });
      }
      const day = dailyMap.get(dayKey)!;
      day.revenue += revenue;
      day.cost += totalCost;
      day.orderIds.add(item.order.id);
    }

    let totalRevenue = 0;
    let totalCost = 0;
    const totalOrderIds = new Set<string>();
    let totalItemCount = 0;

    const bySupplier = Array.from(supplierMap.entries()).map(
      ([supplierId, s]) => {
        const profit = s.revenue - s.cost;
        const margin = s.revenue > 0 ? (profit / s.revenue) * 100 : 0;
        totalRevenue += s.revenue;
        totalCost += s.cost;
        s.orderIds.forEach((id) => totalOrderIds.add(id));
        totalItemCount += s.itemCount;
        return {
          supplierId,
          supplierName: s.supplierName,
          revenue: s.revenue,
          cost: s.cost,
          profit,
          margin,
          orderCount: s.orderIds.size,
          itemCount: s.itemCount,
        };
      },
    );

    bySupplier.sort((a, b) => b.profit - a.profit);

    const dailyTrend = Array.from(dailyMap.values())
      .map((d) => ({
        date: d.date,
        revenue: d.revenue,
        cost: d.cost,
        profit: d.revenue - d.cost,
        orderCount: d.orderIds.size,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      totalRevenue,
      totalCost,
      zeroCostItemCount,
      totalProfit: totalRevenue - totalCost,
      totalCollectedKdv,
      totalPaidKdv,
      totalNetKdv: totalCollectedKdv - totalPaidKdv,
      orderCount: totalOrderIds.size,
      itemCount: totalItemCount,
      bySupplier,
      dailyTrend,
    };
  }

  /**
   * Tedarikçi detay sayfası için zenginleştirilmiş kalem listesi.
   * Override eden tedarikçi varsa o tedarikçinin kalemleri de dahil edilir.
   */
  private async _fetchSupplierItemsDetailed(
    tenantId: string,
    from: Date,
    to: Date,
    supplierId: string,
  ) {
    return this.prisma.orderItem.findMany({
      where: {
        order: {
          tenantId,
          // §3.2 — awaiting_payment (tahsil edilmemiş kart) ve iptal/iade HARİÇ.
          // Tüm muhasebe yüzeyleriyle (Z-rapor, Tedarikçi Cari, ProfitCalculator)
          // AYNI statü kümesi → Karlılık artık onlarla mutabık.
          status: { in: ['paid', 'preparing', 'shipped'] },
          createdAt: { gte: from, lte: to },
        },
        // Çözümleme önceliği BİREBİR: override → snapshot → product. Silinmiş
        // ürünler snapshot dalıyla bu tedarikçinin detayında görünür.
        OR: supplierMatchOr(supplierId),
      },
      select: {
        qty: true,
        unitPrice: true,
        costPriceSnapshot: true,
        productName: true,
        supplierSku: true,
        supplierIdOverride: true,
        supplierIdSnapshot: true,
        supplierNameSnapshot: true,
        fulfillmentSource: true,
        houseStockDispatchedAt: true,
        houseStockReservedQty: true,
        houseStockReservedUntil: true,
        order: {
          select: {
            id: true,
            kdvRate: true,
            createdAt: true,
            humanOrderNo: true,
            status: true,
            customerName: true,
            endCustomerName: true,
            packagingUnitFee: true,
          },
        },
        product: {
          select: {
            id: true,
            name: true,
            internalCode: true,
            costPrice: true,
            supplierId: true,
          },
        },
      },
    });
  }

  private _calcItemRevenue(item: {
    unitPrice: unknown;
    qty: number;
    order: { kdvRate: number | null; packagingUnitFee?: unknown };
  }): number {
    const saleKdvRate = item.order.kdvRate ?? 20;
    const productRevenue = toNum(item.unitPrice) * item.qty * (1 + saleKdvRate / 100);
    const packagingRevenue = toNum(item.order.packagingUnitFee ?? 0) * item.qty;
    return productRevenue + packagingRevenue;
  }

  private _calcItemCost(
    item: {
      qty: number;
      costPriceSnapshot: unknown;
      product: { costPrice: unknown } | null;
    },
    config: ProfitConfig | null,
  ): number {
    // TEK KAYNAK (profit-cost.util): kâr raporu ile tedarikçi bakiye düşümü
    // aynı "gerçek alış maliyeti" = costPrice × (1+KDV) formülünü kullanır.
    return calcItemSupplyCost(
      item.costPriceSnapshot ?? item.product?.costPrice,
      item.qty,
      config,
    );
  }
}
