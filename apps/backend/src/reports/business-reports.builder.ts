/**
 * Faz 4 — İş raporları üretici servisi.
 *
 * Aylık satış, bayi performansı, stok değeri ve tedarikçi karlılığı raporlarını
 * Prisma sorguları + ExcelJS ile XLSX olarak üretir. PDF formatı şu an XLSX'e
 * fallback eder (pdfkit opsiyonel; ileride eklenir). Çıktı `Buffer` olarak
 * dönülür ki çağıran (controller veya scheduler) email'e attach edebilsin.
 *
 * Ayrıca `buildSummary(...)` çağrısı dosya üretmeden hızlı bir özet + detay
 * satırları döner — frontend Raporlar sayfasının "Önizleme" panelinde dökümü
 * göstermek için kullanılır.
 */
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  DELETED_SUPPLIER_ID,
  DELETED_SUPPLIER_NAME,
  resolveSupplier,
  supplierMatchOr,
} from '../profitability/supplier-attribution.util';
import {
  trParts,
  trDayStart,
  trDayEndExclusive,
  trStartOfDay,
  trAddDays,
  trDateKey,
  trTodayKey,
} from '../common/utils/tr-time';

export type BusinessReportType =
  | 'monthly_sales'
  | 'dealer_performance'
  | 'inventory_value'
  | 'supplier_profit';

export type BusinessReportFormat = 'xlsx' | 'pdf';

/**
 * Desteklenen dönem anahtarları. UI'da görünen etiket "Mayıs 2026 (1–17)"
 * gibi dinamik bir isim olabilir; backend sadece anahtarı çevirir.
 */
export type BusinessReportPeriod =
  | 'current_month'
  | 'last_month'
  | 'last_30_days'
  | 'last_3_months'
  | 'last_6_months'
  | 'year_to_date'
  | 'last_year'
  | 'custom';

export interface BusinessReportParams {
  /** ISO date (YYYY-MM-DD). Yoksa periyot başına göre hesaplanır. */
  from?: string;
  to?: string;
  /** Yukarıdaki anahtarlardan biri; bilinmeyen değer "current_month" sayılır. */
  period?: string;
  /** Bazı raporlar için filtre (örn. supplier_profit için supplierId). */
  supplierId?: string;
}

export interface BuiltReport {
  filename: string;
  contentType: string;
  buffer: Buffer;
  summary: BusinessReportSummary;
}

export interface BusinessReportSummary {
  type: BusinessReportType;
  rowCount: number;
  rangeFrom: string;
  rangeTo: string;
  totalAmount?: number;
  /** Ek metrikler (rapor tipine göre değişir). */
  metrics?: Record<string, number | string>;
}

/** Önizleme yanıtı — dosya üretilmeden hızlıca dönen JSON yapısı. */
export interface BusinessReportPreview {
  summary: BusinessReportSummary;
  /**
   * Frontend'in dinamik render edeceği kolonlar. `key` satırdaki alana,
   * `align` hizalamaya, `format` tarayıcı tarafındaki formatlamaya işaret eder.
   */
  columns: ReadonlyArray<PreviewColumn>;
  /** İlk N satır (UI'da tabloyu doldurur). */
  rows: ReadonlyArray<Record<string, unknown>>;
  /** Toplam satır sayısı; rows'tan büyük olabilir (paged preview). */
  totalRows: number;
  /** Sayfa altında özet hesaplar (sum/avg). */
  totals?: Record<string, number | string>;
}

export interface PreviewColumn {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  format?: 'currency' | 'number' | 'percent' | 'date' | 'datetime' | 'text';
  width?: number;
}

interface Range {
  from: Date;
  to: Date;
}

const REPORT_LABELS: Record<BusinessReportType, string> = {
  monthly_sales: 'Aylık Satış Raporu',
  dealer_performance: 'Bayi Performans Raporu',
  inventory_value: 'Stok Değer Raporu',
  supplier_profit: 'Tedarikçi Karlılık Raporu',
};

/** Önizlemede gösterilecek azami satır sayısı. XLSX'te tüm satırlar yazılır. */
const PREVIEW_ROW_LIMIT = 100;

@Injectable()
export class BusinessReportsBuilder {
  private readonly logger = new Logger(BusinessReportsBuilder.name);

  constructor(private readonly prisma: PrismaService) {}

  resolveRange(params: BusinessReportParams = {}): Range {
    const now = new Date();
    // Tüm sınırlar TR takvimine göre. Belirli bir TR takvim gününün (ya da ayın
    // 1'inin) 00:00 TR anını döner; ay/gün taşması Date.UTC'ye bırakılır.
    const civilDayStart = (y: number, mIndex0: number, d: number): Date =>
      trDayStart(new Date(Date.UTC(y, mIndex0, d, 12, 0, 0)))!;
    if (params.from && params.to) {
      const f = trDayStart(params.from);
      const tEnd = trDayEndExclusive(params.to);
      if (f && tEnd) {
        // Bitiş günü DAHİL: gün sonu = ertesi TR günü başı − 1ms.
        return { from: f, to: new Date(tEnd.getTime() - 1) };
      }
    }
    const tp = trParts(now);
    const period = (params.period ?? 'current_month') as BusinessReportPeriod;
    switch (period) {
      case 'last_30_days': {
        const from = trAddDays(trStartOfDay(now), -30);
        return { from, to: now };
      }
      case 'last_3_months': {
        const from = civilDayStart(tp.year, tp.month - 1 - 3, 1);
        return { from, to: now };
      }
      case 'last_6_months': {
        const from = civilDayStart(tp.year, tp.month - 1 - 6, 1);
        return { from, to: now };
      }
      case 'year_to_date': {
        const from = civilDayStart(tp.year, 0, 1);
        return { from, to: now };
      }
      case 'last_year': {
        const from = civilDayStart(tp.year - 1, 0, 1);
        // Geçen yılın son anı = bu yılın 1 Ocak 00:00 TR − 1ms.
        const to = new Date(civilDayStart(tp.year, 0, 1).getTime() - 1);
        return { from, to };
      }
      case 'last_month': {
        const from = civilDayStart(tp.year, tp.month - 1 - 1, 1);
        // Geçen ayın son anı = bu ayın 1'i 00:00 TR − 1ms.
        const to = new Date(civilDayStart(tp.year, tp.month - 1, 1).getTime() - 1);
        return { from, to };
      }
      case 'current_month':
      default: {
        const from = civilDayStart(tp.year, tp.month - 1, 1);
        return { from, to: now };
      }
    }
  }

  async build(
    type: BusinessReportType,
    format: BusinessReportFormat,
    params: BusinessReportParams = {},
  ): Promise<BuiltReport> {
    const range = this.resolveRange(params);
    switch (type) {
      case 'monthly_sales':
        return this.buildMonthlySales(range, format);
      case 'dealer_performance':
        return this.buildDealerPerformance(range, format);
      case 'inventory_value':
        return this.buildInventoryValue(format);
      case 'supplier_profit':
        return this.buildSupplierProfit(range, format, params.supplierId);
      default:
        throw new BadRequestException(`Bilinmeyen rapor tipi: ${type}`);
    }
  }

  /**
   * Dosya üretmeden hızlı önizleme. Frontend tarafı bunu çağırıp tablo
   * dökümünü gösterir; kullanıcı "İndir" derse `build(...)` ile XLSX üretir.
   */
  async buildPreview(
    type: BusinessReportType,
    params: BusinessReportParams = {},
  ): Promise<BusinessReportPreview> {
    const range = this.resolveRange(params);
    switch (type) {
      case 'monthly_sales':
        return this.previewMonthlySales(range);
      case 'dealer_performance':
        return this.previewDealerPerformance(range);
      case 'inventory_value':
        return this.previewInventoryValue();
      case 'supplier_profit':
        return this.previewSupplierProfit(range, params.supplierId);
      default:
        throw new BadRequestException(`Bilinmeyen rapor tipi: ${type}`);
    }
  }

  // ───────────────────── monthly_sales ─────────────────────

  /**
   * Aylık satış raporunun ham verisini toplar. Hem build hem preview tarafından
   * kullanılır ki kullanıcı UI'da gördüğü dökümle indirilen Excel arasında
   * tutarsızlık yaşamasın.
   */
  private async collectMonthlySales(range: Range) {
    const orders = await this.prisma.order.findMany({
      where: {
        createdAt: { gte: range.from, lte: range.to },
        status: { notIn: ['cancelled', 'refunded', 'awaiting_payment'] },
      },
      select: {
        id: true,
        humanOrderNo: true,
        createdAt: true,
        total: true,
        subtotal: true,
        kdvAmount: true,
        kdvRate: true,
        currency: true,
        status: true,
        marketplace: true,
        paymentType: true,
        customerName: true,
        customerEmail: true,
        items: {
          select: {
            qty: true,
            unitPrice: true,
            costPriceSnapshot: true,
            supplierIdOverride: true,
            supplierIdSnapshot: true,
            supplierNameSnapshot: true,
            supplierOverride: { select: { name: true, purchaseVatRate: true } },
            product: {
              select: {
                supplierId: true,
                costPrice: true,
                supplier: { select: { id: true, name: true, purchaseVatRate: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Silinmiş ürünlü kalemleri snapshot id'siyle doğru tedarikçiye atfederken
    // alış KDV oranı/adını da bulabilmek için tedarikçi haritası (TEK KAYNAK).
    const supplierMeta = new Map(
      (
        await this.prisma.supplier.findMany({
          select: { id: true, name: true, purchaseVatRate: true },
        })
      ).map((s) => [s.id, s]),
    );

    const daily = new Map<
      string,
      { date: string; orderCount: number; revenue: number; units: number }
    >();
    const channels = new Map<
      string,
      { channel: string; orderCount: number; revenue: number }
    >();
    const suppliers = new Map<
      string,
      { supplier: string; units: number; revenue: number; cost: number }
    >();
    let totalRevenue = 0;
    let totalUnits = 0;
    let totalCost = 0;

    for (const o of orders) {
      const amount = Number(o.total);
      totalRevenue += amount;
      const dayKey = trDateKey(o.createdAt);
      const dayUnits = o.items.reduce((acc, it) => acc + it.qty, 0);
      totalUnits += dayUnits;

      const d = daily.get(dayKey);
      if (d) {
        d.orderCount += 1;
        d.revenue += amount;
        d.units += dayUnits;
      } else {
        daily.set(dayKey, {
          date: dayKey,
          orderCount: 1,
          revenue: amount,
          units: dayUnits,
        });
      }

      const channelKey = (o.marketplace ?? 'website').toLowerCase();
      const channelLabel = formatChannel(channelKey);
      const ch = channels.get(channelKey);
      if (ch) {
        ch.orderCount += 1;
        ch.revenue += amount;
      } else {
        channels.set(channelKey, {
          channel: channelLabel,
          orderCount: 1,
          revenue: amount,
        });
      }

      for (const it of o.items) {
        // Çözümleme önceliği: override → snapshot → product (TEK KAYNAK). id ve
        // ad TEK çözümlemeyle gelir → daima uyumlu.
        const { id: resolvedSupplierId, name: resolvedName } = resolveSupplier(
          it,
          'Bilinmeyen',
        );
        // snapMeta yalnız alış KDV oranı içindir (ad resolveSupplier'dan gelir).
        const snapMeta = resolvedSupplierId
          ? supplierMeta.get(resolvedSupplierId)
          : undefined;
        const supplierKey = resolvedSupplierId ?? DELETED_SUPPLIER_ID;
        const supplierName = resolvedSupplierId ? resolvedName : DELETED_SUPPLIER_NAME;
        // TEK KAYNAK uyumu: kâr modülüyle aynı KDV-dahil taban.
        // gelir = unitPrice × qty × (1 + satışKDV); maliyet = costPrice × (1 + alışKDV) × qty.
        const saleKdvRate = Number(o.kdvRate ?? 20);
        // Alış KDV oranı ÇÖZÜLEN tedarikçiyle uyumlu olmalı: snapMeta zaten
        // resolvedSupplierId ile anahtarlandığı için onu önce kullan; ürün başka
        // tedarikçiye taşınmış kalemlerde canlı ürün KDV'sine (yanlış tedarikçi)
        // düşmeyi önler. Yalnız id meta haritasında yoksa override/ürüne düşülür.
        const purchaseVatRate = Number(
          snapMeta?.purchaseVatRate ??
            it.supplierOverride?.purchaseVatRate ??
            it.product?.supplier?.purchaseVatRate ??
            20,
        );
        const itemRevenue =
          Number(it.unitPrice) * it.qty * (1 + saleKdvRate / 100);
        // costPriceSnapshot eski siparişlerde null → 0 maliyet kârı şişirir.
        // Ürünün güncel costPrice'ına düş (fallback).
        const itemUnitCost =
          it.costPriceSnapshot != null
            ? Number(it.costPriceSnapshot)
            : it.product?.costPrice != null
              ? Number(it.product.costPrice)
              : 0;
        const itemCost =
          itemUnitCost * (1 + purchaseVatRate / 100) * it.qty;
        totalCost += itemCost;
        const s = suppliers.get(supplierKey);
        if (s) {
          s.units += it.qty;
          s.revenue += itemRevenue;
          s.cost += itemCost;
        } else {
          suppliers.set(supplierKey, {
            supplier: supplierName,
            units: it.qty,
            revenue: itemRevenue,
            cost: itemCost,
          });
        }
      }
    }

    return {
      orders,
      daily: Array.from(daily.values()).sort((a, b) =>
        a.date.localeCompare(b.date),
      ),
      channels: Array.from(channels.values()).sort(
        (a, b) => b.revenue - a.revenue,
      ),
      suppliers: Array.from(suppliers.values()).sort(
        (a, b) => b.revenue - a.revenue,
      ),
      totals: {
        revenue: totalRevenue,
        units: totalUnits,
        cost: totalCost,
        orderCount: orders.length,
        avgBasket: orders.length ? totalRevenue / orders.length : 0,
      },
    };
  }

  private async previewMonthlySales(range: Range): Promise<BusinessReportPreview> {
    const data = await this.collectMonthlySales(range);
    const rows = data.orders.slice(0, PREVIEW_ROW_LIMIT).map((o) => ({
      humanOrderNo: o.humanOrderNo,
      createdAt: o.createdAt.toISOString(),
      customerName: o.customerName,
      channel: formatChannel(o.marketplace ?? 'website'),
      status: o.status,
      itemCount: o.items.reduce((acc, it) => acc + it.qty, 0),
      total: round2(Number(o.total)),
    }));
    return {
      summary: {
        type: 'monthly_sales',
        rowCount: data.orders.length,
        rangeFrom: range.from.toISOString(),
        rangeTo: range.to.toISOString(),
        totalAmount: round2(data.totals.revenue),
        metrics: {
          'Sipariş': data.totals.orderCount,
          'Ürün adedi': data.totals.units,
          'Ortalama sepet': round2(data.totals.avgBasket),
        },
      },
      columns: [
        { key: 'humanOrderNo', label: 'Sipariş No', width: 110 },
        { key: 'createdAt', label: 'Tarih', format: 'datetime', width: 140 },
        { key: 'customerName', label: 'Müşteri', width: 200 },
        { key: 'channel', label: 'Kanal', width: 110 },
        { key: 'status', label: 'Durum', width: 110 },
        { key: 'itemCount', label: 'Adet', format: 'number', align: 'right', width: 70 },
        { key: 'total', label: 'Tutar', format: 'currency', align: 'right', width: 120 },
      ],
      rows,
      totalRows: data.orders.length,
      totals: {
        total: round2(data.totals.revenue),
        itemCount: data.totals.units,
      },
    };
  }

  private async buildMonthlySales(
    range: Range,
    format: BusinessReportFormat,
  ): Promise<BuiltReport> {
    const data = await this.collectMonthlySales(range);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Toptan Budur';
    wb.created = new Date();

    // ── Özet
    const summary = wb.addWorksheet('Özet');
    summary.columns = [
      { header: 'Metrik', key: 'metric', width: 30 },
      { header: 'Değer', key: 'value', width: 28 },
    ];
    summary.addRows([
      { metric: 'Rapor', value: REPORT_LABELS.monthly_sales },
      {
        metric: 'Dönem',
        value: `${trDateKey(range.from)} → ${trDateKey(range.to)}`,
      },
      { metric: 'Toplam Sipariş', value: data.totals.orderCount },
      { metric: 'Toplam Ürün Adedi', value: data.totals.units },
      { metric: 'Toplam Ciro (TRY)', value: round2(data.totals.revenue) },
      { metric: 'Toplam Maliyet (TRY)', value: round2(data.totals.cost) },
      {
        metric: 'Brüt Kar (TRY)',
        value: round2(data.totals.revenue - data.totals.cost),
      },
      {
        metric: 'Ortalama Sepet (TRY)',
        value: round2(data.totals.avgBasket),
      },
    ]);
    styleHeader(summary);

    // ── Günlük breakdown
    const daily = wb.addWorksheet('Günlük Satış');
    daily.columns = [
      { header: 'Tarih', key: 'date', width: 14 },
      { header: 'Sipariş Sayısı', key: 'orderCount', width: 18 },
      { header: 'Ürün Adedi', key: 'units', width: 14 },
      { header: 'Ciro (TRY)', key: 'revenue', width: 18 },
    ];
    for (const row of data.daily) {
      daily.addRow({ ...row, revenue: round2(row.revenue) });
    }
    styleHeader(daily);

    // ── Kanal kırılımı
    const channel = wb.addWorksheet('Kanal Kırılımı');
    channel.columns = [
      { header: 'Kanal', key: 'channel', width: 20 },
      { header: 'Sipariş', key: 'orderCount', width: 12 },
      { header: 'Ciro (TRY)', key: 'revenue', width: 18 },
      { header: 'Pay (%)', key: 'share', width: 12 },
    ];
    for (const c of data.channels) {
      channel.addRow({
        channel: c.channel,
        orderCount: c.orderCount,
        revenue: round2(c.revenue),
        share: data.totals.revenue
          ? round2((c.revenue / data.totals.revenue) * 100)
          : 0,
      });
    }
    styleHeader(channel);

    // ── Tedarikçi kırılımı
    const supplier = wb.addWorksheet('Tedarikçi Kırılımı');
    supplier.columns = [
      { header: 'Tedarikçi', key: 'supplier', width: 28 },
      { header: 'Adet', key: 'units', width: 10 },
      { header: 'Ciro (TRY)', key: 'revenue', width: 18 },
      { header: 'Maliyet (TRY)', key: 'cost', width: 18 },
      { header: 'Kar (TRY)', key: 'profit', width: 16 },
      { header: 'Marj (%)', key: 'margin', width: 12 },
    ];
    for (const s of data.suppliers) {
      const profit = s.revenue - s.cost;
      supplier.addRow({
        supplier: s.supplier,
        units: s.units,
        revenue: round2(s.revenue),
        cost: round2(s.cost),
        profit: round2(profit),
        margin: s.revenue > 0 ? round2((profit / s.revenue) * 100) : 0,
      });
    }
    styleHeader(supplier);

    // ── Sipariş detayı
    const detail = wb.addWorksheet('Sipariş Detayı');
    detail.columns = [
      { header: 'Sipariş No', key: 'humanOrderNo', width: 14 },
      { header: 'Tarih', key: 'createdAt', width: 20 },
      { header: 'Müşteri', key: 'customerName', width: 30 },
      { header: 'E-posta', key: 'customerEmail', width: 28 },
      { header: 'Kanal', key: 'channel', width: 14 },
      { header: 'Durum', key: 'status', width: 14 },
      { header: 'Ödeme', key: 'paymentType', width: 12 },
      { header: 'Adet', key: 'itemCount', width: 8 },
      { header: 'Ara Toplam', key: 'subtotal', width: 14 },
      { header: 'KDV', key: 'kdv', width: 12 },
      { header: 'Tutar', key: 'total', width: 14 },
      { header: 'Para Birimi', key: 'currency', width: 10 },
    ];
    for (const o of data.orders) {
      detail.addRow({
        humanOrderNo: o.humanOrderNo,
        createdAt: o.createdAt.toISOString().slice(0, 16).replace('T', ' '),
        customerName: o.customerName,
        customerEmail: o.customerEmail,
        channel: formatChannel(o.marketplace ?? 'website'),
        status: o.status,
        paymentType: o.paymentType ?? '—',
        itemCount: o.items.reduce((acc, it) => acc + it.qty, 0),
        subtotal: o.subtotal ? round2(Number(o.subtotal)) : null,
        kdv: o.kdvAmount ? round2(Number(o.kdvAmount)) : null,
        total: round2(Number(o.total)),
        currency: o.currency,
      });
    }
    styleHeader(detail);

    const buffer = await this.workbookBuffer(wb);
    return {
      filename: this.filename('aylik-satis', range, format),
      contentType: this.mime(format),
      buffer,
      summary: {
        type: 'monthly_sales',
        rowCount: data.orders.length,
        rangeFrom: range.from.toISOString(),
        rangeTo: range.to.toISOString(),
        totalAmount: round2(data.totals.revenue),
      },
    };
  }

  // ───────────────────── dealer_performance ─────────────────────

  private async collectDealerPerformance(range: Range) {
    const orders = await this.prisma.order.findMany({
      where: {
        createdAt: { gte: range.from, lte: range.to },
        status: { notIn: ['cancelled', 'refunded', 'awaiting_payment'] },
        customerId: { not: null },
      },
      select: {
        customerId: true,
        customerName: true,
        customerEmail: true,
        customerPhone: true,
        createdAt: true,
        total: true,
        items: { select: { qty: true } },
      },
    });

    const map = new Map<
      string,
      {
        customerId: string;
        name: string;
        email: string;
        phone: string;
        orderCount: number;
        revenue: number;
        units: number;
        firstOrderAt: Date;
        lastOrderAt: Date;
      }
    >();
    for (const o of orders) {
      if (!o.customerId) continue;
      const amount = Number(o.total);
      const units = o.items.reduce((acc, it) => acc + it.qty, 0);
      const prev = map.get(o.customerId);
      if (prev) {
        prev.orderCount += 1;
        prev.revenue += amount;
        prev.units += units;
        if (o.createdAt < prev.firstOrderAt) prev.firstOrderAt = o.createdAt;
        if (o.createdAt > prev.lastOrderAt) prev.lastOrderAt = o.createdAt;
      } else {
        map.set(o.customerId, {
          customerId: o.customerId,
          name: o.customerName,
          email: o.customerEmail,
          phone: o.customerPhone,
          orderCount: 1,
          revenue: amount,
          units,
          firstOrderAt: o.createdAt,
          lastOrderAt: o.createdAt,
        });
      }
    }
    const rows = Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
    const totalRevenue = rows.reduce((acc, r) => acc + r.revenue, 0);
    return { rows, totalRevenue };
  }

  private async previewDealerPerformance(range: Range): Promise<BusinessReportPreview> {
    const data = await this.collectDealerPerformance(range);
    const rows = data.rows.slice(0, PREVIEW_ROW_LIMIT).map((r, idx) => ({
      rank: idx + 1,
      name: r.name,
      email: r.email,
      phone: r.phone,
      orderCount: r.orderCount,
      units: r.units,
      revenue: round2(r.revenue),
      avg: r.orderCount ? round2(r.revenue / r.orderCount) : 0,
      lastOrderAt: r.lastOrderAt.toISOString(),
    }));
    return {
      summary: {
        type: 'dealer_performance',
        rowCount: data.rows.length,
        rangeFrom: range.from.toISOString(),
        rangeTo: range.to.toISOString(),
        totalAmount: round2(data.totalRevenue),
        metrics: {
          'Aktif bayi': data.rows.length,
          'Toplam ciro': round2(data.totalRevenue),
        },
      },
      columns: [
        { key: 'rank', label: '#', align: 'right', width: 50 },
        { key: 'name', label: 'Bayi', width: 220 },
        { key: 'email', label: 'E-posta', width: 200 },
        { key: 'orderCount', label: 'Sipariş', format: 'number', align: 'right', width: 80 },
        { key: 'units', label: 'Adet', format: 'number', align: 'right', width: 70 },
        { key: 'revenue', label: 'Ciro', format: 'currency', align: 'right', width: 130 },
        { key: 'avg', label: 'Ort. Sepet', format: 'currency', align: 'right', width: 130 },
        { key: 'lastOrderAt', label: 'Son Sipariş', format: 'date', width: 110 },
      ],
      rows,
      totalRows: data.rows.length,
      totals: {
        revenue: round2(data.totalRevenue),
      },
    };
  }

  private async buildDealerPerformance(
    range: Range,
    format: BusinessReportFormat,
  ): Promise<BuiltReport> {
    const data = await this.collectDealerPerformance(range);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Toptan Budur';

    const summary = wb.addWorksheet('Özet');
    summary.columns = [
      { header: 'Metrik', key: 'metric', width: 30 },
      { header: 'Değer', key: 'value', width: 28 },
    ];
    summary.addRows([
      { metric: 'Rapor', value: REPORT_LABELS.dealer_performance },
      {
        metric: 'Dönem',
        value: `${trDateKey(range.from)} → ${trDateKey(range.to)}`,
      },
      { metric: 'Aktif Bayi Sayısı', value: data.rows.length },
      { metric: 'Toplam Ciro (TRY)', value: round2(data.totalRevenue) },
      {
        metric: 'Ortalama Bayi Cirosu',
        value: data.rows.length
          ? round2(data.totalRevenue / data.rows.length)
          : 0,
      },
    ]);
    styleHeader(summary);

    const sheet = wb.addWorksheet('Bayi Performansı');
    sheet.columns = [
      { header: 'Sıra', key: 'rank', width: 6 },
      { header: 'Bayi', key: 'name', width: 32 },
      { header: 'E-posta', key: 'email', width: 28 },
      { header: 'Telefon', key: 'phone', width: 16 },
      { header: 'Sipariş', key: 'orderCount', width: 10 },
      { header: 'Ürün Adedi', key: 'units', width: 12 },
      { header: 'Ciro (TRY)', key: 'revenue', width: 16 },
      { header: 'Ortalama Sepet', key: 'avg', width: 16 },
      { header: 'İlk Sipariş', key: 'firstOrderAt', width: 12 },
      { header: 'Son Sipariş', key: 'lastOrderAt', width: 12 },
    ];
    data.rows.forEach((r, i) =>
      sheet.addRow({
        rank: i + 1,
        name: r.name,
        email: r.email,
        phone: r.phone,
        orderCount: r.orderCount,
        units: r.units,
        revenue: round2(r.revenue),
        avg: r.orderCount ? round2(r.revenue / r.orderCount) : 0,
        firstOrderAt: trDateKey(r.firstOrderAt),
        lastOrderAt: trDateKey(r.lastOrderAt),
      }),
    );
    styleHeader(sheet);

    const buffer = await this.workbookBuffer(wb);
    return {
      filename: this.filename('bayi-performansi', range, format),
      contentType: this.mime(format),
      buffer,
      summary: {
        type: 'dealer_performance',
        rowCount: data.rows.length,
        rangeFrom: range.from.toISOString(),
        rangeTo: range.to.toISOString(),
        totalAmount: round2(data.totalRevenue),
      },
    };
  }

  // ───────────────────── inventory_value ─────────────────────

  private async collectInventoryValue() {
    const products = await this.prisma.product.findMany({
      where: { active: true },
      select: {
        id: true,
        name: true,
        internalCode: true,
        externalCode: true,
        stock: true,
        costPrice: true,
        price: true,
        supplier: { select: { id: true, name: true } },
      },
    });

    const rows = products
      .map((p) => {
        const cost = p.costPrice ? Number(p.costPrice) : 0;
        const price = p.price ? Number(p.price) : 0;
        const value = cost * p.stock;
        const potential = price * p.stock;
        return {
          id: p.id,
          name: p.name,
          sku: p.internalCode ?? p.externalCode,
          supplierId: p.supplier?.id ?? null,
          supplier: p.supplier?.name ?? '—',
          stock: p.stock,
          cost,
          price,
          value,
          potential,
        };
      })
      .sort((a, b) => b.value - a.value);

    const totalValue = rows.reduce((acc, r) => acc + r.value, 0);
    const totalPotential = rows.reduce((acc, r) => acc + r.potential, 0);
    const totalUnits = rows.reduce((acc, r) => acc + r.stock, 0);

    return { rows, totalValue, totalPotential, totalUnits };
  }

  private async previewInventoryValue(): Promise<BusinessReportPreview> {
    const data = await this.collectInventoryValue();
    const now = new Date();
    const rows = data.rows.slice(0, PREVIEW_ROW_LIMIT).map((r) => ({
      sku: r.sku,
      name: r.name,
      supplier: r.supplier,
      stock: r.stock,
      cost: round2(r.cost),
      price: round2(r.price),
      value: round2(r.value),
    }));
    return {
      summary: {
        type: 'inventory_value',
        rowCount: data.rows.length,
        rangeFrom: now.toISOString(),
        rangeTo: now.toISOString(),
        totalAmount: round2(data.totalValue),
        metrics: {
          'Aktif ürün': data.rows.length,
          'Toplam stok': data.totalUnits,
          'Potansiyel ciro': round2(data.totalPotential),
        },
      },
      columns: [
        { key: 'sku', label: 'SKU', width: 130 },
        { key: 'name', label: 'Ürün', width: 280 },
        { key: 'supplier', label: 'Tedarikçi', width: 160 },
        { key: 'stock', label: 'Stok', format: 'number', align: 'right', width: 70 },
        { key: 'cost', label: 'Maliyet', format: 'currency', align: 'right', width: 110 },
        { key: 'price', label: 'Satış', format: 'currency', align: 'right', width: 110 },
        { key: 'value', label: 'Stok Değeri', format: 'currency', align: 'right', width: 130 },
      ],
      rows,
      totalRows: data.rows.length,
      totals: {
        stock: data.totalUnits,
        value: round2(data.totalValue),
      },
    };
  }

  private async buildInventoryValue(
    format: BusinessReportFormat,
  ): Promise<BuiltReport> {
    const data = await this.collectInventoryValue();

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Toptan Budur';

    const summary = wb.addWorksheet('Özet');
    summary.columns = [
      { header: 'Metrik', key: 'metric', width: 30 },
      { header: 'Değer', key: 'value', width: 28 },
    ];
    summary.addRows([
      { metric: 'Rapor', value: REPORT_LABELS.inventory_value },
      { metric: 'Tarih', value: trTodayKey() },
      { metric: 'Aktif Ürün Sayısı', value: data.rows.length },
      { metric: 'Toplam Stok Adedi', value: data.totalUnits },
      { metric: 'Toplam Stok Değeri (TRY)', value: round2(data.totalValue) },
      { metric: 'Potansiyel Ciro (TRY)', value: round2(data.totalPotential) },
    ]);
    styleHeader(summary);

    // Tedarikçi kırılımı
    const bySupplier = new Map<
      string,
      { supplier: string; units: number; value: number; potential: number }
    >();
    for (const r of data.rows) {
      const key = r.supplier;
      const cur = bySupplier.get(key);
      if (cur) {
        cur.units += r.stock;
        cur.value += r.value;
        cur.potential += r.potential;
      } else {
        bySupplier.set(key, {
          supplier: r.supplier,
          units: r.stock,
          value: r.value,
          potential: r.potential,
        });
      }
    }
    const supplierSheet = wb.addWorksheet('Tedarikçi Kırılımı');
    supplierSheet.columns = [
      { header: 'Tedarikçi', key: 'supplier', width: 28 },
      { header: 'Stok Adedi', key: 'units', width: 14 },
      { header: 'Stok Değeri (TRY)', key: 'value', width: 18 },
      { header: 'Potansiyel Ciro', key: 'potential', width: 18 },
    ];
    Array.from(bySupplier.values())
      .sort((a, b) => b.value - a.value)
      .forEach((r) =>
        supplierSheet.addRow({
          supplier: r.supplier,
          units: r.units,
          value: round2(r.value),
          potential: round2(r.potential),
        }),
      );
    styleHeader(supplierSheet);

    const detail = wb.addWorksheet('Ürün Detay');
    detail.columns = [
      { header: 'Tedarikçi', key: 'supplier', width: 22 },
      { header: 'SKU', key: 'sku', width: 18 },
      { header: 'Ürün', key: 'name', width: 40 },
      { header: 'Stok', key: 'stock', width: 10 },
      { header: 'Maliyet', key: 'cost', width: 14 },
      { header: 'Satış Fiyatı', key: 'price', width: 14 },
      { header: 'Stok Değeri', key: 'value', width: 16 },
      { header: 'Potansiyel', key: 'potential', width: 16 },
    ];
    for (const r of data.rows) {
      detail.addRow({
        supplier: r.supplier,
        sku: r.sku,
        name: r.name,
        stock: r.stock,
        cost: round2(r.cost),
        price: round2(r.price),
        value: round2(r.value),
        potential: round2(r.potential),
      });
    }
    styleHeader(detail);

    const range = { from: new Date(), to: new Date() };
    const buffer = await this.workbookBuffer(wb);
    return {
      filename: this.filename('stok-degeri', range, format),
      contentType: this.mime(format),
      buffer,
      summary: {
        type: 'inventory_value',
        rowCount: data.rows.length,
        rangeFrom: range.from.toISOString(),
        rangeTo: range.to.toISOString(),
        totalAmount: round2(data.totalValue),
      },
    };
  }

  // ───────────────────── supplier_profit ─────────────────────

  private async collectSupplierProfit(range: Range, supplierFilter?: string) {
    const where: Prisma.OrderItemWhereInput = {
      order: {
        createdAt: { gte: range.from, lte: range.to },
        status: { notIn: ['cancelled', 'refunded', 'awaiting_payment'] },
      },
    };
    if (supplierFilter) {
      // Çözümleme önceliğini BİREBİR yansıt: override → snapshot → product.
      where.OR = supplierMatchOr(supplierFilter);
    }

    const items = await this.prisma.orderItem.findMany({
      where,
      select: {
        qty: true,
        unitPrice: true,
        costPriceSnapshot: true,
        productName: true,
        supplierIdOverride: true,
        supplierIdSnapshot: true,
        supplierNameSnapshot: true,
        supplierOverride: { select: { id: true, name: true } },
        order: { select: { createdAt: true } },
        product: {
          select: {
            id: true,
            name: true,
            supplierId: true,
            costPrice: true,
            supplier: { select: { id: true, name: true } },
          },
        },
      },
    });

    const supplierMap = new Map<
      string,
      {
        supplierId: string;
        name: string;
        units: number;
        revenue: number;
        cost: number;
        orderCount: Set<string>;
      }
    >();

    interface ProductRow {
      supplier: string;
      productName: string;
      units: number;
      revenue: number;
      cost: number;
    }
    const productMap = new Map<string, ProductRow>();

    for (const it of items) {
      // Çözümleme önceliği: override → snapshot → product (TEK KAYNAK). id ve ad
      // TEK çözümlemeyle gelir → daima uyumlu. Silinmiş ürünler snapshot dalıyla
      // doğru tedarikçiye atfedilir; atfı kaybolanlar paylaşılan "Ürün Silinmiş"
      // kovasına düşer (diğer raporlarla aynı kimlik).
      const { id: resolvedId, name: resolvedName } = resolveSupplier(
        it,
        'Bilinmeyen',
      );
      const sId = resolvedId ?? DELETED_SUPPLIER_ID;
      const name = resolvedId ? resolvedName : DELETED_SUPPLIER_NAME;
      const unitPrice = Number(it.unitPrice);
      // costPriceSnapshot eski (snapshot öncesi) siparişlerde null olabilir →
      // 0 yazmak kârı şişirir. Ürünün güncel costPrice'ına düş (fallback).
      const cost =
        it.costPriceSnapshot != null
          ? Number(it.costPriceSnapshot)
          : it.product?.costPrice != null
            ? Number(it.product.costPrice)
            : 0;
      const revenue = unitPrice * it.qty;
      const totalCost = cost * it.qty;

      const prev = supplierMap.get(sId);
      if (prev) {
        prev.units += it.qty;
        prev.revenue += revenue;
        prev.cost += totalCost;
      } else {
        supplierMap.set(sId, {
          supplierId: sId,
          name,
          units: it.qty,
          revenue,
          cost: totalCost,
          orderCount: new Set<string>(),
        });
      }

      const pKey = `${sId}::${it.product?.id ?? it.productName}`;
      const pPrev = productMap.get(pKey);
      if (pPrev) {
        pPrev.units += it.qty;
        pPrev.revenue += revenue;
        pPrev.cost += totalCost;
      } else {
        productMap.set(pKey, {
          supplier: name,
          productName: it.product?.name ?? it.productName,
          units: it.qty,
          revenue,
          cost: totalCost,
        });
      }
    }

    const supplierRows = Array.from(supplierMap.values())
      .map((r) => ({
        ...r,
        profit: r.revenue - r.cost,
        margin: r.revenue > 0 ? ((r.revenue - r.cost) / r.revenue) * 100 : 0,
      }))
      .sort((a, b) => b.profit - a.profit);

    const productRows = Array.from(productMap.values())
      .map((r) => ({
        ...r,
        profit: r.revenue - r.cost,
        margin: r.revenue > 0 ? ((r.revenue - r.cost) / r.revenue) * 100 : 0,
      }))
      .sort((a, b) => b.profit - a.profit);

    const totalProfit = supplierRows.reduce((acc, r) => acc + r.profit, 0);
    const totalRevenue = supplierRows.reduce((acc, r) => acc + r.revenue, 0);
    const totalCost = supplierRows.reduce((acc, r) => acc + r.cost, 0);

    return { supplierRows, productRows, totalProfit, totalRevenue, totalCost };
  }

  private async previewSupplierProfit(
    range: Range,
    supplierFilter?: string,
  ): Promise<BusinessReportPreview> {
    const data = await this.collectSupplierProfit(range, supplierFilter);
    const rows = data.supplierRows.slice(0, PREVIEW_ROW_LIMIT).map((r) => ({
      name: r.name,
      units: r.units,
      revenue: round2(r.revenue),
      cost: round2(r.cost),
      profit: round2(r.profit),
      margin: round2(r.margin),
    }));
    return {
      summary: {
        type: 'supplier_profit',
        rowCount: data.supplierRows.length,
        rangeFrom: range.from.toISOString(),
        rangeTo: range.to.toISOString(),
        totalAmount: round2(data.totalProfit),
        metrics: {
          'Ciro': round2(data.totalRevenue),
          'Maliyet': round2(data.totalCost),
          'Brüt kar': round2(data.totalProfit),
        },
      },
      columns: [
        { key: 'name', label: 'Tedarikçi', width: 220 },
        { key: 'units', label: 'Adet', format: 'number', align: 'right', width: 80 },
        { key: 'revenue', label: 'Ciro', format: 'currency', align: 'right', width: 130 },
        { key: 'cost', label: 'Maliyet', format: 'currency', align: 'right', width: 130 },
        { key: 'profit', label: 'Kar', format: 'currency', align: 'right', width: 130 },
        { key: 'margin', label: 'Marj', format: 'percent', align: 'right', width: 80 },
      ],
      rows,
      totalRows: data.supplierRows.length,
      totals: {
        revenue: round2(data.totalRevenue),
        cost: round2(data.totalCost),
        profit: round2(data.totalProfit),
      },
    };
  }

  private async buildSupplierProfit(
    range: Range,
    format: BusinessReportFormat,
    supplierFilter?: string,
  ): Promise<BuiltReport> {
    const data = await this.collectSupplierProfit(range, supplierFilter);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Toptan Budur';

    const summary = wb.addWorksheet('Özet');
    summary.columns = [
      { header: 'Metrik', key: 'metric', width: 30 },
      { header: 'Değer', key: 'value', width: 28 },
    ];
    summary.addRows([
      { metric: 'Rapor', value: REPORT_LABELS.supplier_profit },
      {
        metric: 'Dönem',
        value: `${trDateKey(range.from)} → ${trDateKey(range.to)}`,
      },
      { metric: 'Tedarikçi Sayısı', value: data.supplierRows.length },
      { metric: 'Toplam Ciro (TRY)', value: round2(data.totalRevenue) },
      { metric: 'Toplam Maliyet (TRY)', value: round2(data.totalCost) },
      { metric: 'Brüt Kar (TRY)', value: round2(data.totalProfit) },
      {
        metric: 'Ortalama Marj (%)',
        value: data.totalRevenue
          ? round2((data.totalProfit / data.totalRevenue) * 100)
          : 0,
      },
    ]);
    styleHeader(summary);

    const sheet = wb.addWorksheet('Tedarikçi Karlılığı');
    sheet.columns = [
      { header: 'Tedarikçi', key: 'name', width: 28 },
      { header: 'Adet', key: 'units', width: 10 },
      { header: 'Ciro (TRY)', key: 'revenue', width: 16 },
      { header: 'Maliyet (TRY)', key: 'cost', width: 16 },
      { header: 'Kar (TRY)', key: 'profit', width: 16 },
      { header: 'Marj (%)', key: 'margin', width: 12 },
    ];
    for (const r of data.supplierRows) {
      sheet.addRow({
        name: r.name,
        units: r.units,
        revenue: round2(r.revenue),
        cost: round2(r.cost),
        profit: round2(r.profit),
        margin: round2(r.margin),
      });
    }
    styleHeader(sheet);

    const productSheet = wb.addWorksheet('Ürün Bazlı Karlılık');
    productSheet.columns = [
      { header: 'Tedarikçi', key: 'supplier', width: 24 },
      { header: 'Ürün', key: 'productName', width: 42 },
      { header: 'Adet', key: 'units', width: 10 },
      { header: 'Ciro (TRY)', key: 'revenue', width: 16 },
      { header: 'Maliyet (TRY)', key: 'cost', width: 16 },
      { header: 'Kar (TRY)', key: 'profit', width: 16 },
      { header: 'Marj (%)', key: 'margin', width: 12 },
    ];
    for (const r of data.productRows) {
      productSheet.addRow({
        supplier: r.supplier,
        productName: r.productName,
        units: r.units,
        revenue: round2(r.revenue),
        cost: round2(r.cost),
        profit: round2(r.profit),
        margin: round2(r.margin),
      });
    }
    styleHeader(productSheet);

    const buffer = await this.workbookBuffer(wb);
    return {
      filename: this.filename('tedarikci-karlilik', range, format),
      contentType: this.mime(format),
      buffer,
      summary: {
        type: 'supplier_profit',
        rowCount: data.supplierRows.length,
        rangeFrom: range.from.toISOString(),
        rangeTo: range.to.toISOString(),
        totalAmount: round2(data.totalProfit),
      },
    };
  }

  private async workbookBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
    const arr = await wb.xlsx.writeBuffer();
    return Buffer.from(arr as ArrayBuffer);
  }

  private mime(_format: BusinessReportFormat): string {
    // PDF formatı şu an XLSX'e fallback. Mime tipi gerçek üretilene göre döner.
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }

  private filename(
    base: string,
    range: Range,
    _format: BusinessReportFormat,
  ): string {
    const f = trDateKey(range.from);
    const t = trDateKey(range.to);
    return `${base}_${f}_${t}.xlsx`;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function styleHeader(sheet: ExcelJS.Worksheet): void {
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4F46E5' },
  };
  header.alignment = { vertical: 'middle', horizontal: 'center' };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

const CHANNEL_LABELS: Record<string, string> = {
  website: 'Web Sitesi',
  self: 'Kendim İçin',
  other: 'Diğer Satış Kanalı',
};

function formatChannel(raw: string): string {
  const key = raw.toLowerCase();
  if (CHANNEL_LABELS[key]) return CHANNEL_LABELS[key];
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}
