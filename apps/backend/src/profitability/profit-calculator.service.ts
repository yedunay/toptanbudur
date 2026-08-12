import { Injectable } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CalculateOptions,
  DEFAULT_PROFIT_STATUSES,
  OrderProfitRow,
  ProfitResult,
  SupplierBreakdown,
} from './profit-calculator.types';
import { calcItemSupplyCost, supplierUnitQty } from './profit-cost.util';
import {
  DELETED_SUPPLIER_ID,
  DELETED_SUPPLIER_NAME,
  resolveSupplier,
  supplierMatchOr,
} from './supplier-attribution.util';

/** Prisma Decimal / string / number → number. Boş değer 0. */
export function toNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v) || 0;
  // Prisma Decimal object
  if (typeof (v as { toString?: () => string }).toString === 'function') {
    return parseFloat((v as { toString: () => string }).toString()) || 0;
  }
  return 0;
}

/**
 * Paylaşılan karlılık motoru.
 *
 * Maliyet: sipariş anındaki `costPriceSnapshot` (yoksa güncel `costPrice`)
 * üzerine tedarikçi bazlı alış KDV'si + indirim + ekstra maliyet uygulanır.
 * Gelir: `unitPrice` (KDV hariç kaydedilir) sipariş KDV oranıyla brütleştirilir.
 */
@Injectable()
export class ProfitCalculatorService {
  constructor(private readonly prisma: PrismaService) {}

  /** TEK KAYNAK: tedarikçi başına alış KDV oranı (Supplier.purchaseVatRate). */
  async getConfigMap(
    tenantId: string,
  ): Promise<Map<string, { purchaseVatRate: number }>> {
    const suppliers = await this.prisma.supplier.findMany({
      where: { tenantId },
      select: { id: true, purchaseVatRate: true },
    });
    return new Map(
      // purchaseVatRate Prisma'da Decimal; toNum ile gerçek number'a çevrilir
      // (tip dürüstlüğü + aritmetikte örtük string-coercion'a güvenmemek için).
      suppliers.map((s) => [s.id, { purchaseVatRate: toNum(s.purchaseVatRate) }]),
    );
  }

  /**
   * Bir dönem için ciro / maliyet / kâr özeti.
   *
   * @param from dönem başı (dahil)
   * @param to   dönem sonu (dahil)
   */
  async calculate(
    tenantId: string,
    from: Date,
    to: Date,
    opts: CalculateOptions = {},
  ): Promise<ProfitResult> {
    const statuses = opts.statuses ?? DEFAULT_PROFIT_STATUSES;
    const configMap = await this.getConfigMap(tenantId);
    const items = await this.fetchOrderItems(
      tenantId,
      from,
      to,
      statuses,
      opts.supplierId,
    );
    return this.aggregate(items, configMap);
  }

  /**
   * `calculate()` ile AYNI motor/formüller — ek olarak sipariş bazlı kırılım
   * döner (Z raporu bayi analizi ve "en kârlı sipariş" için). Kalemler tek
   * sorguda çekilir; iki kez sorgu atılmaz.
   */
  async calculateWithOrders(
    tenantId: string,
    from: Date,
    to: Date,
    opts: CalculateOptions = {},
  ): Promise<ProfitResult & { byOrder: OrderProfitRow[] }> {
    const statuses = opts.statuses ?? DEFAULT_PROFIT_STATUSES;
    const configMap = await this.getConfigMap(tenantId);
    const items = await this.fetchOrderItems(
      tenantId,
      from,
      to,
      statuses,
      opts.supplierId,
    );
    return {
      ...this.aggregate(items, configMap),
      byOrder: this.aggregateByOrder(items, configMap),
    };
  }

  private async fetchOrderItems(
    tenantId: string,
    from: Date,
    to: Date,
    statuses: readonly string[],
    supplierId?: string,
  ) {
    return this.prisma.orderItem.findMany({
      where: {
        order: {
          tenantId,
          status: { in: statuses as OrderStatus[] },
          createdAt: { gte: from, lte: to },
        },
        // Tek bir tedarikçi filtresi istenirse çözümleme önceliğini BİREBİR
        // yansıt: override → snapshot → product. Ürün hard-delete edilmiş
        // (productId null) kalemler snapshot dalıyla yine doğru tedarikçiye düşer.
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
        order: {
          select: {
            id: true,
            kdvRate: true,
            packagingUnitFee: true,
            // Sipariş bazlı kırılım (calculateWithOrders) için kimlik alanları.
            humanOrderNo: true,
            customerId: true,
            customerName: true,
          },
        },
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

  /**
   * TEK KAYNAK — bir kalemin tedarikçi atfı + maliyeti + geliri.
   * Hem tedarikçi bazlı (`aggregate`) hem sipariş bazlı (`aggregateByOrder`)
   * toplama bu formülleri kullanır; ikisi asla ayrışamaz.
   */
  private itemFinancials(
    item: Awaited<ReturnType<typeof this.fetchOrderItems>>[number],
    configMap: Map<string, { purchaseVatRate: number }>,
  ): {
    supplierId: string;
    supplierName: string;
    revenue: number;
    cost: number;
    zeroCostQty: number;
  } {
    let supplierId: string;
    let supplierName: string;
    let cost: number;
    let zeroCostQty = 0;

    // Çözümleme önceliği: override → snapshot → güncel ürün (TEK KAYNAK:
    // supplier-attribution.util). id ve ad TEK çözümlemeyle gelir → daima
    // uyumlu. Snapshot dalı sayesinde ürün hard-delete edilse (product null)
    // bile sipariş doğru tedarikçiye atfedilir; "Ürün Silinmiş" yalnızca
    // hiçbir atıf yoksa kalır.
    const { id: effectiveSupplierId, name: effectiveSupplierName } =
      resolveSupplier(item);

    if (!effectiveSupplierId) {
      supplierId = DELETED_SUPPLIER_ID;
      supplierName = DELETED_SUPPLIER_NAME;
      // Tedarikçi atfı tamamen kaybolmuş (override/snapshot/product yok).
      // Maliyeti SIFIRLAMA — costPriceSnapshot'tan hesapla; aksi halde
      // silinmiş ürünler maliyetsiz görünüp kârı şişirir. config yok → KDV %20.
      if (toNum(item.costPriceSnapshot) === 0) zeroCostQty = item.qty;
      cost = calcItemSupplyCost(item.costPriceSnapshot, item.qty, null);
    } else {
      supplierId = effectiveSupplierId;
      supplierName = effectiveSupplierName;
      // Snapshot önce: sipariş anındaki alış fiyatı. Yoksa güncel DB değeri.
      const costPrice = item.costPriceSnapshot ?? item.product?.costPrice;
      // Tedarikçi snapshot ile çözüldüğü için silinmiş üründe bile DOĞRU
      // tedarikçinin alış KDV oranı uygulanır (varsayılan %20 değil).
      const config = configMap.get(supplierId);

      if (toNum(costPrice) === 0) zeroCostQty = item.qty;
      // Tek kaynak: kâr raporu ile bakiye düşümü aynı formülü kullanır.
      cost = calcItemSupplyCost(costPrice, item.qty, config ?? null);
    }

    // unitPrice KDV hariç kaydedilir; müşteriden alınan gerçek gelir KDV
    // dahildir. Paketleme/hizmet ücreti de gelire (kâra) eklenir — bayi ürünü
    // maliyetine alıp kârı bu ücrette elde ettiği modelde aksi halde Z-rapor
    // kârı 0 çıkıyordu. (KDV-DAHİL kabul; Z-rapor brüt kârı gösterir.)
    const saleKdvRate = item.order.kdvRate ?? 20;
    const packagingRevenue = toNum(item.order.packagingUnitFee) * item.qty;
    const revenue =
      toNum(item.unitPrice) * item.qty * (1 + saleKdvRate / 100) +
      packagingRevenue;

    return { supplierId, supplierName, revenue, cost, zeroCostQty };
  }

  /** Kalemleri siparişe göre toplar — ciroya göre azalan sıralı döner. */
  private aggregateByOrder(
    items: Awaited<ReturnType<typeof this.fetchOrderItems>>,
    configMap: Map<string, { purchaseVatRate: number }>,
  ): OrderProfitRow[] {
    const orderMap = new Map<string, OrderProfitRow>();

    for (const item of items) {
      const { revenue, cost } = this.itemFinancials(item, configMap);
      const o = item.order;

      const row = orderMap.get(o.id) ?? {
        orderId: o.id,
        humanOrderNo: o.humanOrderNo,
        customerId: o.customerId ?? null,
        customerName: o.customerName,
        revenue: 0,
        cost: 0,
        profit: 0,
        itemCount: 0,
      };
      row.revenue += revenue;
      row.cost += cost;
      row.profit = row.revenue - row.cost;
      row.itemCount += item.qty;
      orderMap.set(o.id, row);
    }

    return Array.from(orderMap.values()).sort((a, b) => b.revenue - a.revenue);
  }

  private aggregate(
    items: Awaited<ReturnType<typeof this.fetchOrderItems>>,
    configMap: Map<string, { purchaseVatRate: number }>,
  ): ProfitResult {
    const supplierMap = new Map<
      string,
      {
        supplierName: string;
        revenue: number;
        cost: number;
        orderIds: Set<string>;
        // Bu tedarikçiden FİİLEN alım yapılan siparişler (ekMaliyet bunlara).
        purchaseOrderIds: Set<string>;
        itemCount: number;
      }
    >();

    let zeroCostItemCount = 0;
    const now = Date.now();

    for (const item of items) {
      const {
        supplierId,
        supplierName,
        revenue,
        cost: totalCost,
        zeroCostQty,
      } = this.itemFinancials(item, configMap);
      zeroCostItemCount += zeroCostQty;

      if (!supplierMap.has(supplierId)) {
        supplierMap.set(supplierId, {
          supplierName,
          revenue: 0,
          cost: 0,
          orderIds: new Set(),
          purchaseOrderIds: new Set(),
          itemCount: 0,
        });
      }

      const entry = supplierMap.get(supplierId)!;
      entry.revenue += revenue;
      entry.cost += totalCost;
      entry.orderIds.add(item.order.id);
      if (supplierUnitQty(item, now) > 0) {
        entry.purchaseOrderIds.add(item.order.id);
      }
      entry.itemCount += item.qty;
    }

    // (Sipariş-başı ekMaliyet kalktı — maliyet tamamen costPrice × (1+KDV)'den
    // türer; tek kaynak.)

    let totalRevenue = 0;
    let totalCost = 0;
    const totalOrderIds = new Set<string>();
    let totalItemCount = 0;

    const bySupplier: SupplierBreakdown[] = Array.from(
      supplierMap.entries(),
    ).map(([supplierId, s]) => {
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
    });

    bySupplier.sort((a, b) => b.profit - a.profit);

    const totalProfit = totalRevenue - totalCost;
    return {
      totalRevenue,
      totalCost,
      totalProfit,
      margin: totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0,
      orderCount: totalOrderIds.size,
      itemCount: totalItemCount,
      zeroCostItemCount,
      bySupplier,
    };
  }
}
