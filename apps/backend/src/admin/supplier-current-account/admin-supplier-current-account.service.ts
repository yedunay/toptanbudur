import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminProfitabilityService } from '../profitability/admin-profitability.service';
import {
  calcItemSupplyCost,
  calcPackagingKdvPortion,
} from '../../profitability/profit-cost.util';
import {
  DELETED_SUPPLIER_ID,
  DELETED_SUPPLIER_NAME,
  resolveSupplier,
  supplierMatchOr,
} from '../../profitability/supplier-attribution.util';
import { trDateRange, trTodayKey } from '../../common/utils/tr-time';
import { TedarikciCariQueryDto } from './dto/tedarikci-cari-query.dto';

type ReportRow = {
  id: string;
  dateIso: string;
  supplierId: string;
  supplierName: string;
  description: string;
  productPurchasePrice: number;
  salePrice: number;
  packagingAmount: number;
  profit: number;
  vatDifference: number;
  humanOrderNo: string;
  customerId: string | null;
  customerName: string | null;
  customerEmail: string | null;
  qty: number;
  saleKdvRate: number;
  purchaseKdvRate: number;
  paymentType: string | null;
  saleBase: number;
  saleKdv: number;
  purchaseBase: number;
  purchaseKdv: number;
};

@Injectable()
export class AdminSupplierCurrentAccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profitability: AdminProfitabilityService,
  ) {}

  async getReport(
    tenantId: string,
    q: TedarikciCariQueryDto,
    opts: { unbounded?: boolean } = {},
  ) {
    const page = q.page ?? 1;
    // Export yolu (unbounded) sayfalama clamp'ini atlar — aksi halde Excel
    // sessizce 500 satıra kırpılır ve özet sayfalarıyla tutarsız kalır.
    const pageSize = opts.unbounded
      ? Number.MAX_SAFE_INTEGER
      : Math.min(q.pageSize ?? 25, 500);

    // 1) Dropdown için tedarikçi listesi
    const suppliers = await this.prisma.supplier.findMany({
      where: { tenantId, active: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });

    // 2) Order query (cancelled/refunded hariç — sadece geçerli satışlar)
    const orderWhere: Prisma.OrderWhereInput = {
      tenantId,
      status: { in: ['paid', 'preparing', 'shipped'] as const },
    };
    {
      // TR takvim günü: başlangıç dahil, bitiş günü de DAHİL (yarı-açık üst sınır).
      const range = trDateRange(q.from, q.to);
      if (range) orderWhere.createdAt = range;
    }
    if (q.paymentType) orderWhere.paymentType = q.paymentType;
    if (q.kdvRate) orderWhere.kdvRate = q.kdvRate;
    if (q.search) {
      orderWhere.OR = [
        { humanOrderNo: { contains: q.search, mode: 'insensitive' } },
        { customerName: { contains: q.search, mode: 'insensitive' } },
        { customerEmail: { contains: q.search, mode: 'insensitive' } },
        { items: { some: { productName: { contains: q.search, mode: 'insensitive' } } } },
      ];
    }
    if (q.supplierId) {
      // Çözümleme önceliğini BİREBİR yansıt: override → snapshot → product.
      // Silinmiş ürünlü kalemler snapshot dalıyla doğru tedarikçide görünür.
      orderWhere.items = { some: { OR: supplierMatchOr(q.supplierId) } };
    }

    // 3) Siparişler + kalemler
    const orders = await this.prisma.order.findMany({
      where: orderWhere,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        humanOrderNo: true,
        createdAt: true,
        customerId: true,
        customerName: true,
        customerEmail: true,
        subtotal: true,
        kdvRate: true,
        kdvAmount: true,
        total: true,
        packagingUnitFee: true,
        paymentType: true,
        items: {
          select: {
            id: true,
            productId: true,
            productName: true,
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
            product: {
              select: {
                supplierId: true,
                costPrice: true,
                supplier: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
      take: 10_000,
    });

    // 4) Profit map (cross-validation amaçlı, ileride dashboard ile uyumluluk)
    await this.profitability.getOrderProfitability(
      tenantId,
      orders.map((o) => o.id),
    );

    // 5) TEK KAYNAK: per-supplier KDV oranı (Supplier.purchaseVatRate).
    const supplierVatRows = await this.prisma.supplier.findMany({
      where: { tenantId },
      select: { id: true, purchaseVatRate: true },
    });
    const vatBySupplier = new Map(
      supplierVatRows.map((s) => [s.id, s.purchaseVatRate]),
    );

    // 6) Rows üret (sipariş-başı ekMaliyet kalktı — maliyet tamamen costPrice'tan).
    const rows: ReportRow[] = [];
    for (const o of orders) {
      const saleKdvRate = o.kdvRate ?? 20;
      const packagingUnitFee = Number(o.packagingUnitFee ?? 0);
      for (const it of o.items) {
        // Çözümleme önceliği: override → snapshot → product (TEK KAYNAK). id ve
        // ad TEK çözümlemeyle gelir → daima uyumlu. Ürün hard-delete edilse bile
        // snapshot sayesinde kalem DOĞRU tedarikçiye atfedilir ve rapordan DÜŞMEZ
        // (eski davranış: silinmiş ürünleri sessizce atlıyordu → Toplam Alış/Kâr
        // eksik çıkıyordu). Atıf tamamen kaybolduysa "Ürün Silinmiş" kovasına yaz
        // — karlılık raporuyla aynı toplam çıksın diye sessizce atlamıyoruz.
        const { id: resolvedSupplierId, name: resolvedSupplierName } =
          resolveSupplier(it, '—');
        const supplierId = resolvedSupplierId ?? DELETED_SUPPLIER_ID;
        const supplierName = resolvedSupplierId
          ? resolvedSupplierName
          : DELETED_SUPPLIER_NAME;
        if (q.supplierId && supplierId !== q.supplierId) continue;

        const effectiveQty = it.qty;
        if (effectiveQty <= 0) continue;

        // Karlılık raporuyla BİREBİR aynı varsayılan (%20) — çözülmüş ama VAT
        // haritasında olmayan (örn. hard-delete edilmiş) tedarikçide de
        // profitability ile aynı sayıyı verir (saleKdvRate'e DÜŞMEZ).
        const purchaseKdvRate = resolvedSupplierId
          ? (vatBySupplier.get(supplierId) ?? 20)
          : 20;

        // Maliyet kaynağı diğer rapor yollarıyla aynı: snapshot yoksa güncel
        // ürün maliyetine düş. TEK KAYNAK: maliyet = costPrice × (1 + KDV oranı).
        const costSource = it.costPriceSnapshot ?? it.product?.costPrice ?? null;
        const unitCostBase = Number(costSource ?? 0);
        const lineCost = calcItemSupplyCost(costSource, effectiveQty, {
          purchaseVatRate: purchaseKdvRate,
        });

        const unitPrice = Number(it.unitPrice ?? 0);
        const lineProductRevenue =
          unitPrice * effectiveQty * (1 + saleKdvRate / 100);
        const linePackaging = packagingUnitFee * effectiveQty;
        const lineRevenue = lineProductRevenue + linePackaging;

        const lineProfit = lineRevenue - lineCost;

        const lineSaleBase = unitPrice * effectiveQty;
        // Paketleme/hizmet ücreti KDV-DAHİL (kullanıcı kararı): içindeki KDV,
        // tahsil edilen satış KDV'sine eklenir → KDV farkında görünür ve net
        // kârdan düşülür. Bayi ürünü maliyetine alıp kârı bu üc­rette elde
        // ettiği için ürün KDV farkı 0 olsa bile ücretin KDV'si yansır.
        const linePackagingKdv = calcPackagingKdvPortion(
          linePackaging,
          saleKdvRate,
        );
        const lineSaleKdv = lineSaleBase * (saleKdvRate / 100) + linePackagingKdv;
        const linePurchaseBase = unitCostBase * effectiveQty;
        const linePurchaseKdv = linePurchaseBase * (purchaseKdvRate / 100);
        const vatDifference = lineSaleKdv - linePurchaseKdv;

        rows.push({
          id: it.id,
          dateIso: o.createdAt.toISOString(),
          supplierId,
          supplierName,
          description: `Sipariş #${o.humanOrderNo} — ${it.productName}`,
          productPurchasePrice: lineCost,
          salePrice: lineRevenue,
          packagingAmount: linePackaging,
          profit: lineProfit,
          vatDifference,
          humanOrderNo: o.humanOrderNo,
          customerId: o.customerId,
          customerName: o.customerName ?? null,
          customerEmail: o.customerEmail ?? null,
          qty: effectiveQty,
          saleKdvRate,
          purchaseKdvRate,
          paymentType: o.paymentType ?? null,
          saleBase: lineSaleBase,
          saleKdv: lineSaleKdv,
          purchaseBase: linePurchaseBase,
          purchaseKdv: linePurchaseKdv,
        });
      }
    }

    // 7) Özet
    // netProfit = brüt kâr − KDV farkı. Daha önce gross profit ile aynı değere
    // basılıyordu; bayi ödenecek/tahsil edilecek KDV netleştiği için iki rakam
    // hep eşitti. Doğru tanım: brüt kâr ödenecek KDV farkıyla erozyona uğrar.
    const totalGrossProfit = sumBy(rows, (r) => r.profit);
    const totalVatDifference = sumBy(rows, (r) => r.vatDifference);
    const summary = {
      totalPurchaseAmount: sumBy(rows, (r) => r.productPurchasePrice),
      totalSalesAmount: sumBy(rows, (r) => r.salePrice),
      totalPackaging: sumBy(rows, (r) => r.packagingAmount),
      totalGrossProfit,
      totalVatDifference,
      netProfit: totalGrossProfit - totalVatDifference,
      orderCount: orders.length,
      itemCount: rows.length,
    };

    // 8) Profit distribution (donut/pie)
    const byProfit = groupBy(rows, (r) => r.supplierId);
    const profitDistribution = Array.from(byProfit.entries()).map(([sid, items]) => {
      const profitAmount = sumBy(items, (r) => r.profit);
      return {
        supplierId: sid,
        supplierName: items[0]!.supplierName,
        profitAmount,
        percent: 0,
      };
    });
    const totalProfit = sumBy(profitDistribution, (p) => p.profitAmount);
    profitDistribution.forEach((p) => {
      p.percent = totalProfit > 0 ? (p.profitAmount / totalProfit) * 100 : 0;
    });
    profitDistribution.sort((a, b) => b.profitAmount - a.profitAmount);

    // 9) Top 5 by sales total
    const bySalesSupplier = groupBy(rows, (r) => r.supplierId);
    const salesTotalsBySupplier = Array.from(bySalesSupplier.entries())
      .map(([sid, items]) => ({
        supplierId: sid,
        supplierName: items[0]!.supplierName,
        totalPurchaseAmount: sumBy(items, (r) => r.productPurchasePrice),
        totalSalesAmount: sumBy(items, (r) => r.salePrice),
      }))
      .sort((a, b) => b.totalSalesAmount - a.totalSalesAmount)
      .slice(0, 5);

    // 10) Monthly trend (günlük data point)
    const byDay = new Map<string, { p: number; s: number; pr: number }>();
    for (const r of rows) {
      const key = r.dateIso.slice(0, 10);
      const c = byDay.get(key) ?? { p: 0, s: 0, pr: 0 };
      c.p += r.productPurchasePrice;
      c.s += r.salePrice;
      c.pr += r.profit;
      byDay.set(key, c);
    }
    const monthlyTrend = Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([d, v]) => ({
        date: formatDayLabel(d),
        purchaseAmount: v.p,
        salesAmount: v.s,
        profitAmount: v.pr,
      }));

    // 11) Pagination
    const total = rows.length;
    const paginated = rows.slice((page - 1) * pageSize, page * pageSize);

    return {
      suppliers,
      summary,
      profitDistribution,
      salesTotalsBySupplier,
      monthlyTrend,
      rows: paginated,
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  async exportReport(tenantId: string, q: TedarikciCariQueryDto) {
    // Tüm rows export — pagination clamp'i atlanır (unbounded), aksi halde
    // Excel 500 satırla sınırlanıp özet sayfalarıyla tutarsız kalırdı.
    const data = await this.getReport(
      tenantId,
      { ...q, page: 1 },
      { unbounded: true },
    );
    const allRows = data.rows;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Toptan Budur';
    workbook.created = new Date();

    // Sheet 1: Tedarikçi Cari Hareketleri
    const detail = workbook.addWorksheet('Tedarikçi Cari Hareketleri', {
      views: [{ state: 'frozen', ySplit: 4 }],
    });
    detail.columns = [
      { key: 'date', width: 18 },
      { key: 'supplier', width: 24 },
      { key: 'desc', width: 48 },
      { key: 'orderNo', width: 14 },
      { key: 'qty', width: 8 },
      { key: 'purchase', width: 16 },
      { key: 'packaging', width: 14 },
      { key: 'sale', width: 16 },
      { key: 'profit', width: 16 },
      { key: 'vatDiff', width: 16 },
    ];
    detail.mergeCells('A1:J1');
    const t1 = detail.getCell('A1');
    t1.value = 'Toptan Budur — Tedarikçi Cari Hareketleri';
    t1.font = { name: 'Calibri', size: 18, bold: true, color: { argb: 'FFFFFFFF' } };
    t1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1267F4' } };
    detail.getRow(1).height = 32;
    detail.getRow(3).values = [
      'Tarih',
      'Tedarikçi',
      'Açıklama',
      'Sipariş No',
      'Adet',
      'Ürün Alış (₺)',
      'Paketleme (₺)',
      'Satış (₺)',
      'Kâr (₺)',
      'KDV Farkı (₺)',
    ];
    detail.getRow(3).font = { bold: true };
    allRows.forEach((r) => {
      detail.addRow({
        date: new Date(r.dateIso),
        supplier: r.supplierName,
        desc: r.description,
        orderNo: r.humanOrderNo,
        qty: r.qty,
        purchase: r.productPurchasePrice,
        packaging: r.packagingAmount,
        sale: r.salePrice,
        profit: r.profit,
        vatDiff: r.vatDifference,
      });
    });
    (['purchase', 'packaging', 'sale', 'profit', 'vatDiff'] as const).forEach((k) => {
      detail.getColumn(k).numFmt = '#,##0.00 "₺"';
    });
    detail.getColumn('date').numFmt = 'dd.mm.yyyy hh:mm';

    // ── MODERN CİLA: başlık dolgusu + zebra + TOPLAM satırı + kenarlık ───────
    const NAVY = 'FF0F2A4F';
    const headerRow = detail.getRow(3);
    headerRow.eachCell((c) => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.alignment = { vertical: 'middle', horizontal: 'center' };
    });
    headerRow.height = 20;
    const firstDataRow = 4;
    const lastDataRow = 3 + allRows.length;
    for (let r = firstDataRow; r <= lastDataRow; r += 1) {
      if ((r - firstDataRow) % 2 === 1) {
        detail.getRow(r).eachCell((c) => {
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F8FA' } };
        });
      }
    }
    const sumBySel = (sel: (r: ReportRow) => number): number =>
      allRows.reduce((a, r) => a + (Number(sel(r)) || 0), 0);
    const totalRow = detail.addRow({
      desc: 'TOPLAM',
      qty: allRows.reduce((a, r) => a + (r.qty || 0), 0),
      purchase: sumBySel((r) => r.productPurchasePrice),
      packaging: sumBySel((r) => r.packagingAmount),
      sale: sumBySel((r) => r.salePrice),
      profit: sumBySel((r) => r.profit),
      vatDiff: sumBySel((r) => r.vatDifference),
    });
    totalRow.font = { bold: true };
    totalRow.eachCell((c) => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
    });
    (['purchase', 'packaging', 'sale', 'profit', 'vatDiff'] as const).forEach((k) => {
      totalRow.getCell(k).numFmt = '#,##0.00 "₺"';
    });
    const thin: Partial<ExcelJS.Border> = {
      style: 'thin',
      color: { argb: 'FFE5E7EB' },
    };
    for (let r = 3; r <= lastDataRow + 1; r += 1) {
      detail.getRow(r).eachCell((c) => {
        c.border = { top: thin, left: thin, bottom: thin, right: thin };
      });
    }

    // Sheet 2: Tedarikçi Özeti
    const supplierSheet = workbook.addWorksheet('Tedarikçi Özeti');
    supplierSheet.columns = [
      { key: 'name', width: 28 },
      { key: 'purchase', width: 18 },
      { key: 'sale', width: 18 },
      { key: 'profit', width: 18 },
      { key: 'percent', width: 12 },
    ];
    supplierSheet.getRow(1).values = [
      'Tedarikçi',
      'Toplam Alış (₺)',
      'Toplam Satış (₺)',
      'Kâr (₺)',
      'Kâr %',
    ];
    supplierSheet.getRow(1).font = { bold: true };
    data.profitDistribution.forEach((p) => {
      const sales = data.salesTotalsBySupplier.find((s) => s.supplierId === p.supplierId);
      supplierSheet.addRow({
        name: p.supplierName,
        purchase: sales?.totalPurchaseAmount ?? 0,
        sale: sales?.totalSalesAmount ?? 0,
        profit: p.profitAmount,
        percent: `%${p.percent.toFixed(2)}`,
      });
    });
    (['purchase', 'sale', 'profit'] as const).forEach((k) => {
      supplierSheet.getColumn(k).numFmt = '#,##0.00 "₺"';
    });

    // Sheet 3: KDV Özeti (oran bazlı kırılım)
    const kdvSheet = workbook.addWorksheet('KDV Özeti');
    kdvSheet.columns = [
      { key: 'rate', width: 12 },
      { key: 'saleBase', width: 18 },
      { key: 'saleKdv', width: 18 },
      { key: 'purchaseBase', width: 18 },
      { key: 'purchaseKdv', width: 18 },
      { key: 'diff', width: 18 },
    ];
    kdvSheet.getRow(1).values = [
      'KDV %',
      'Satış Matrahı',
      'Satış KDV',
      'Alış Matrahı',
      'Alış KDV',
      'Fark (Ödenecek)',
    ];
    kdvSheet.getRow(1).font = { bold: true };
    const kdvGroups = new Map<
      number,
      { saleBase: number; saleKdv: number; purchaseBase: number; purchaseKdv: number }
    >();
    for (const r of allRows) {
      const rate = r.saleKdvRate;
      const c =
        kdvGroups.get(rate) ?? { saleBase: 0, saleKdv: 0, purchaseBase: 0, purchaseKdv: 0 };
      c.saleBase += r.saleBase;
      c.saleKdv += r.saleKdv;
      c.purchaseBase += r.purchaseBase;
      c.purchaseKdv += r.purchaseKdv;
      kdvGroups.set(rate, c);
    }
    Array.from(kdvGroups.entries())
      .sort(([a], [b]) => a - b)
      .forEach(([rate, v]) => {
        kdvSheet.addRow({
          rate: `%${rate}`,
          saleBase: v.saleBase,
          saleKdv: v.saleKdv,
          purchaseBase: v.purchaseBase,
          purchaseKdv: v.purchaseKdv,
          diff: v.saleKdv - v.purchaseKdv,
        });
      });
    (['saleBase', 'saleKdv', 'purchaseBase', 'purchaseKdv', 'diff'] as const).forEach((k) => {
      kdvSheet.getColumn(k).numFmt = '#,##0.00 "₺"';
    });

    // Sheet 4: Müşteri Özeti
    const customerSheet = workbook.addWorksheet('Müşteri Özeti');
    customerSheet.columns = [
      { key: 'name', width: 28 },
      { key: 'orderCount', width: 14 },
      { key: 'sale', width: 18 },
      { key: 'kdv', width: 16 },
      { key: 'cariOdemeCount', width: 14 },
      { key: 'kartOdemeCount', width: 14 },
    ];
    customerSheet.getRow(1).values = [
      'Müşteri',
      'Sipariş',
      'Satış (₺)',
      'KDV (₺)',
      'Cari Öd.',
      'Kart Öd.',
    ];
    customerSheet.getRow(1).font = { bold: true };
    // Müşteri bazında order distinct count + per-payment-type order count
    type CustomerAgg = {
      name: string;
      sale: number;
      kdv: number;
      orderIds: Set<string>;
      cariOrderIds: Set<string>;
      cardOrderIds: Set<string>;
    };
    const byCustomer = new Map<string, CustomerAgg>();
    for (const r of allRows) {
      const key = r.customerEmail ?? r.customerName ?? r.customerId ?? '—';
      const c =
        byCustomer.get(key) ??
        ({
          name: r.customerName ?? r.customerEmail ?? '—',
          sale: 0,
          kdv: 0,
          orderIds: new Set<string>(),
          cariOrderIds: new Set<string>(),
          cardOrderIds: new Set<string>(),
        } satisfies CustomerAgg);
      c.sale += r.salePrice;
      c.kdv += r.saleKdv;
      c.orderIds.add(r.humanOrderNo);
      if (r.paymentType === 'cari') c.cariOrderIds.add(r.humanOrderNo);
      else if (r.paymentType === 'card') c.cardOrderIds.add(r.humanOrderNo);
      byCustomer.set(key, c);
    }
    Array.from(byCustomer.values())
      .sort((a, b) => b.sale - a.sale)
      .forEach((c) => {
        customerSheet.addRow({
          name: c.name,
          orderCount: c.orderIds.size,
          sale: c.sale,
          kdv: c.kdv,
          cariOdemeCount: c.cariOrderIds.size,
          kartOdemeCount: c.cardOrderIds.size,
        });
      });
    (['sale', 'kdv'] as const).forEach((k) => {
      customerSheet.getColumn(k).numFmt = '#,##0.00 "₺"';
    });

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const filename = `tedarikci-cari-hareketleri-${trTodayKey()}.xlsx`;
    return { buffer, filename };
  }
}

function sumBy<T>(arr: T[], f: (x: T) => number): number {
  return arr.reduce((s, x) => s + f(x), 0);
}

function groupBy<T, K>(arr: T[], keyFn: (x: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const x of arr) {
    const k = keyFn(x);
    const list = m.get(k) ?? [];
    list.push(x);
    m.set(k, list);
  }
  return m;
}

function formatDayLabel(yyyymmdd: string): string {
  const [y, m, d] = yyyymmdd.split('-');
  void y;
  return `${d}.${m}`;
}
