/**
 * Z raporu — veri toplama + gönderim orkestrasyonu.
 *
 * Akış:
 *  1. Dönemi belirle (dün, Europe/Istanbul).
 *  2. `ProfitCalculatorService` ile ciro/maliyet/kâr (iptal/iade hariç).
 *  3. Statü + ödeme tipi kırılımları ve sipariş CSV satırları.
 *  4. `ZReportBuilder` ile HTML + CSV üret.
 *  5. Tenant'ın OWNER/ADMIN kullanıcılarına `MailService` ile gönder.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { CariBalanceService } from '../cari-balance/cari-balance.service';
import { ProfitCalculatorService } from '../profitability/profit-calculator.service';
import { toNum } from '../profitability/profit-calculator.service';
import { Z_REPORT_STATUSES } from '../profitability/profit-calculator.types';
import { ZReportBuilder } from './z-report.builder';
import {
  getYesterdayPeriod,
  shiftPeriod,
  weekdayShortTr,
} from './z-report.date';
import {
  CustomerBreakdownRow,
  DayComparison,
  HourlyRow,
  OrderCsvRow,
  OrderHighlight,
  PaymentTypeBreakdownRow,
  ReportPeriod,
  StatusBreakdownRow,
  TrendDay,
  ZReportData,
} from './z-report.types';

/** İptal/iade — ciroya dahil DEĞİL ama rapora bilgi olarak yazılır. */
const EXCLUDED_STATUSES = ['cancelled', 'refunded'] as const;

export interface ZReportRunResult {
  tenantId: string;
  period: ReportPeriod;
  /** Mail gönderilen alıcı adedi. */
  recipientCount: number;
  orderCount: number;
  totalRevenue: number;
  /** Alıcı bulunamadığı için atlandıysa true. */
  skipped: boolean;
}

@Injectable()
export class ZReportService {
  private readonly logger = new Logger(ZReportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly calculator: ProfitCalculatorService,
    private readonly builder: ZReportBuilder,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly cariBalance: CariBalanceService,
  ) {}

  /**
   * Tüm tenant'lar için dünün Z raporunu üretip gönderir.
   * Bir tenant hata verirse diğerleri etkilenmez.
   */
  async runForAllTenants(now: Date = new Date()): Promise<ZReportRunResult[]> {
    const period = getYesterdayPeriod(now);
    const tenants = await this.prisma.tenant.findMany({
      select: { id: true, name: true },
    });

    const results: ZReportRunResult[] = [];
    const failures: string[] = [];
    for (const tenant of tenants) {
      try {
        results.push(await this.runForTenant(tenant.id, period));
      } catch (err) {
        this.logger.error(
          `Z raporu başarısız — tenant=${tenant.id} (${tenant.name}): ${
            (err as Error).message
          }`,
        );
        failures.push(`${tenant.name}: ${(err as Error).message}`);
      }
    }

    // Herhangi bir tenant başarısızsa hata FIRLATILIR — job failed'e düşer,
    // BullMQ attempts/backoff ile yeniden dener. Retry başarılı tenant'lara
    // mükerrer mail atabilir; tek-tenant üretimde bu risk yok ve mükerrer
    // mail, sessizce hiç gitmeyen maile tercih edilir.
    if (failures.length > 0) {
      throw new Error(
        `Z raporu ${failures.length}/${tenants.length} tenant için gönderilemedi — ${failures.join(' | ')}`,
      );
    }
    return results;
  }

  /** Tek bir tenant için Z raporunu üretip gönderir. */
  async runForTenant(
    tenantId: string,
    period: ReportPeriod = getYesterdayPeriod(),
  ): Promise<ZReportRunResult> {
    const data = await this.collect(tenantId, period);
    const recipients = await this.resolveRecipients(tenantId);

    if (recipients.length === 0) {
      this.logger.warn(
        `Z raporu atlandı — tenant=${tenantId} için OWNER/ADMIN alıcı yok`,
      );
      return {
        tenantId,
        period,
        recipientCount: 0,
        orderCount: data.orderCount,
        totalRevenue: data.totalRevenue,
        skipped: true,
      };
    }

    // Şablon seçimi — varsayılan SADE (lite): kurumsal zengin şablon,
    // relay'in (kurumsaleposta) giden-posta spam filtresinde 2026-07-12'den
    // beri [SSP-02] ile bloklanıyor; sade biçimin geçtiği canlı denemeyle
    // kanıtlandı (2026-07-14). Natro filtreyi düzeltince
    // Z_REPORT_TEMPLATE=rich ile zengin şablona dönülür.
    const templateMode = this.config.get<string>('Z_REPORT_TEMPLATE', 'lite');
    const built =
      templateMode === 'rich'
        ? this.builder.build(data)
        : this.builder.buildLite(data);
    await this.mail.sendZReport({
      to: recipients,
      subject: built.subject,
      html: built.html,
      csv: built.csv,
    });

    this.logger.log(
      `Z raporu gönderildi — tenant=${tenantId} dönem=${period.label} ` +
        `alıcı=${recipients.length} sipariş=${data.orderCount}`,
    );

    return {
      tenantId,
      period,
      recipientCount: recipients.length,
      orderCount: data.orderCount,
      totalRevenue: data.totalRevenue,
      skipped: false,
    };
  }

  /** Tenant için Z raporunun tüm sayısal verisini toplar. */
  async collect(tenantId: string, period: ReportPeriod): Promise<ZReportData> {
    const { from, to } = period;

    // Ciro/maliyet/kâr — iptal/iade hariç tüm statüler. Sipariş bazlı
    // kırılım da aynı motordan gelir (bayi analizi + en kârlı sipariş).
    const profit = await this.calculator.calculateWithOrders(
      tenantId,
      from,
      to,
      { statuses: Z_REPORT_STATUSES },
    );

    // Sipariş no → kâr haritası (CSV kolonu + rekor kartı için).
    const profitByOrderNo = new Map(
      profit.byOrder.map((r) => [r.humanOrderNo, r.profit]),
    );

    // Sipariş seviyesi veri — tüm statüler (iptal/iade dahil) çekilir;
    // kırılım ve sayımlar buradan türetilir.
    const orders = await this.prisma.order.findMany({
      where: { tenantId, createdAt: { gte: from, lte: to } },
      select: {
        humanOrderNo: true,
        createdAt: true,
        status: true,
        customerName: true,
        paymentType: true,
        total: true,
        subtotal: true,
        kdvAmount: true,
        // §3.7 — kart komisyon kârı (müşteri %3 − POS ~%2,79) snapshot'ları.
        cardCommissionAmount: true,
        cardCommissionAmountActual: true,
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const includedStatuses = new Set<string>(Z_REPORT_STATUSES);
    const statusMap = new Map<string, StatusBreakdownRow>();
    const paymentMap = new Map<string, PaymentTypeBreakdownRow>();
    const hourlyMap = new Map<number, HourlyRow>();
    const csvRows: OrderCsvRow[] = [];
    let biggestOrder: OrderHighlight | null = null;

    let cancelledCount = 0;
    let refundedCount = 0;
    // §3.7 — kart komisyon kârı (ayrı kalem). Yalnız ciroya dahil kart
    // siparişlerinden ve her iki snapshot'ı dolu olanlardan toplanır (eski,
    // actual snapshot'ı olmayan siparişlerde fazla saymamak için).
    let cardCommissionProfit = 0;

    for (const o of orders) {
      const status = String(o.status);
      const total = toNum(o.total);
      const subtotal = toNum(o.subtotal);
      const kdvAmount = toNum(o.kdvAmount);
      const itemCount = o._count.items;
      const paymentType = o.paymentType ?? 'unknown';

      if (status === 'cancelled') cancelledCount += 1;
      if (status === 'refunded') refundedCount += 1;

      // Statü kırılımı — her statü görünür (iptal/iade dahil), ama ciro
      // yalnız dahil statülerde toplanır.
      const statusRow = statusMap.get(status) ?? {
        status,
        orderCount: 0,
        revenue: 0,
      };
      statusRow.orderCount += 1;
      if (includedStatuses.has(status)) statusRow.revenue += total;
      statusMap.set(status, statusRow);

      // Ödeme tipi kırılımı — yalnız ciroya dahil siparişler.
      if (includedStatuses.has(status)) {
        const payRow = paymentMap.get(paymentType) ?? {
          paymentType,
          orderCount: 0,
          revenue: 0,
        };
        payRow.orderCount += 1;
        payRow.revenue += total;
        paymentMap.set(paymentType, payRow);

        // Saatlik yoğunluk — Istanbul duvar saati (sabit UTC+3).
        const hour = new Date(
          o.createdAt.getTime() + 3 * 60 * 60 * 1000,
        ).getUTCHours();
        const hourRow = hourlyMap.get(hour) ?? {
          hour,
          orderCount: 0,
          revenue: 0,
        };
        hourRow.orderCount += 1;
        hourRow.revenue += total;
        hourlyMap.set(hour, hourRow);

        // Günün en yüksek tutarlı siparişi.
        if (!biggestOrder || total > biggestOrder.value) {
          biggestOrder = {
            humanOrderNo: o.humanOrderNo,
            customerName: o.customerName,
            value: total,
          };
        }

        // §3.7 — kart komisyon kârı: her iki snapshot da doluysa farkı ekle.
        if (
          paymentType === 'card' &&
          o.cardCommissionAmount != null &&
          o.cardCommissionAmountActual != null
        ) {
          cardCommissionProfit +=
            toNum(o.cardCommissionAmount) - toNum(o.cardCommissionAmountActual);
        }
      }

      csvRows.push({
        humanOrderNo: o.humanOrderNo,
        createdAt: o.createdAt,
        status,
        customerName: o.customerName,
        paymentType,
        itemCount,
        subtotal,
        kdvAmount,
        total,
        // İptal/iade satırlarında maliyet hesaplanmaz → kâr boş kalır.
        profit: includedStatuses.has(status)
          ? (profitByOrderNo.get(o.humanOrderNo) ?? null)
          : null,
      });
    }

    // Ciroya dahil siparişlerin `Order.total` toplamı — paid/preparing/shipped
    // dahil, iptal/iade hariç. KDV dahil brüt ciro.
    const grossRevenue = orders
      .filter((o) => includedStatuses.has(String(o.status)))
      .reduce((sum, o) => sum + toNum(o.total), 0);

    // Kısmi iadeler (REFUND ledger) düşülür — sipariş paid/shipped kaldığı için
    // yukarıdaki statü filtresi bunları yakalamaz. İade penceresi siparişin
    // createdAt'ine göre (gross ile aynı [from, to] ekseni). NET = max(0, brüt −
    // iade). Statü/ödeme kırılımları brüt kalır (iade ledger'ı statü kırılımı
    // taşımaz); başlık ciro/kâr/marj NET üzerinden hesaplanır.
    const refund = await this.cariBalance.refundTotalInWindow({
      tenantId,
      orderCreatedFrom: from,
      orderCreatedTo: to,
    });
    const totalRevenue = Math.max(0, grossRevenue - refund);

    const orderCount = orders.filter((o) =>
      includedStatuses.has(String(o.status)),
    ).length;

    const totalCost = profit.totalCost;
    const totalProfit = totalRevenue - totalCost;
    const margin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

    const statusBreakdown = Array.from(statusMap.values()).sort(
      (a, b) => b.revenue - a.revenue,
    );
    const paymentTypeBreakdown = Array.from(paymentMap.values()).sort(
      (a, b) => b.revenue - a.revenue,
    );

    // ── Bayi kırılımı — sipariş bazlı kârdan gruplanır, kısmi iadeler
    // müşteri bazında düşülür (ciro/kâr NET; başlıktaki ciro ile tutarlı).
    const topCustomers = await this.buildTopCustomers(tenantId, period, profit.byOrder);

    // ── Günün en kârlı siparişi.
    const mostProfitableOrder = profit.byOrder.length
      ? profit.byOrder.reduce(
          (best, r) => (r.profit > best.profit ? r : best),
          profit.byOrder[0],
        )
      : null;

    // ── Trend (rapor günü dahil son 8 gün) + dün/geçen hafta kıyası.
    const { trend, prevDay, weekAgo } = await this.buildTrendAndComparisons(
      tenantId,
      period,
      totalRevenue,
      orderCount,
    );

    const hourly = Array.from(hourlyMap.values()).sort(
      (a, b) => a.hour - b.hour,
    );

    return {
      tenantId,
      period,
      totalRevenue,
      totalCost,
      totalProfit,
      cardCommissionProfit: Math.round(cardCommissionProfit * 100) / 100,
      margin,
      orderCount,
      itemCount: profit.itemCount,
      zeroCostItemCount: profit.zeroCostItemCount,
      cancelledCount,
      refundedCount,
      avgOrderValue: orderCount > 0 ? totalRevenue / orderCount : 0,
      prevDay,
      weekAgo,
      trend,
      topCustomers,
      hourly,
      biggestOrder,
      mostProfitableOrder: mostProfitableOrder
        ? {
            humanOrderNo: mostProfitableOrder.humanOrderNo,
            customerName: mostProfitableOrder.customerName,
            value: mostProfitableOrder.profit,
          }
        : null,
      statusBreakdown,
      paymentTypeBreakdown,
      bySupplier: profit.bySupplier,
      orders: csvRows,
    };
  }

  /**
   * Sipariş bazlı kâr satırlarını bayiye göre gruplar; müşteri bazlı kısmi
   * iadeleri (REFUND ledger) hem cirodan hem kârdan düşer. Ciroya göre
   * azalan ilk 5 bayi döner.
   */
  private async buildTopCustomers(
    tenantId: string,
    period: ReportPeriod,
    byOrder: { customerId: string | null; customerName: string; revenue: number; cost: number; itemCount: number }[],
  ): Promise<CustomerBreakdownRow[]> {
    if (byOrder.length === 0) return [];

    const map = new Map<
      string,
      CustomerBreakdownRow & { customerId: string | null }
    >();
    for (const row of byOrder) {
      // customerId yoksa (silinmiş müşteri) isim üzerinden grupla.
      const key = row.customerId ?? `name:${row.customerName}`;
      const entry = map.get(key) ?? {
        customerId: row.customerId,
        customerName: row.customerName,
        orderCount: 0,
        itemCount: 0,
        revenue: 0,
        profit: 0,
      };
      entry.orderCount += 1;
      entry.itemCount += row.itemCount;
      entry.revenue += row.revenue;
      entry.profit += row.revenue - row.cost;
      map.set(key, entry);
    }

    // Kısmi iadeler müşteri bazında düşülür (iade edilen tutar hem ciro
    // hem kâr kaybıdır).
    const refunds = await this.cariBalance.refundTotalsByCustomer({
      tenantId,
      orderCreatedFrom: period.from,
      orderCreatedTo: period.to,
    });
    for (const entry of map.values()) {
      const refund = entry.customerId ? (refunds.get(entry.customerId) ?? 0) : 0;
      entry.revenue -= refund;
      entry.profit -= refund;
    }

    return Array.from(map.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5)
      .map(({ customerId: _customerId, ...row }) => row);
  }

  /**
   * Rapor günü dahil son 8 günün NET ciro/sipariş trendi + "dün" (rapor
   * gününden önceki gün) ve "geçen hafta aynı gün" kâr kıyası.
   */
  private async buildTrendAndComparisons(
    tenantId: string,
    period: ReportPeriod,
    reportDayRevenue: number,
    reportDayOrderCount: number,
  ): Promise<{ trend: TrendDay[]; prevDay: DayComparison; weekAgo: DayComparison }> {
    const trend: TrendDay[] = [];
    let prevDay: DayComparison | null = null;
    let weekAgo: DayComparison | null = null;

    for (let i = 7; i >= 1; i--) {
      const p = shiftPeriod(period, -i);
      const [agg, dayRefund] = await Promise.all([
        this.prisma.order.aggregate({
          where: {
            tenantId,
            createdAt: { gte: p.from, lte: p.to },
            status: { in: [...Z_REPORT_STATUSES] as OrderStatus[] },
          },
          _sum: { total: true },
          _count: { _all: true },
        }),
        this.cariBalance.refundTotalInWindow({
          tenantId,
          orderCreatedFrom: p.from,
          orderCreatedTo: p.to,
        }),
      ]);
      const revenue = Math.max(0, toNum(agg._sum.total) - dayRefund);
      const dayOrderCount = agg._count._all;
      trend.push({
        label: p.label,
        weekday: weekdayShortTr(p),
        revenue,
        orderCount: dayOrderCount,
        isReportDay: false,
      });

      // Kıyas günleri (dün = -1, geçen hafta aynı gün = -7) için kâr da
      // hesaplanır — bir günlük kalem sorgusu, gece koşusunda ucuz.
      if (i === 1 || i === 7) {
        const dayProfit = await this.calculator.calculate(
          tenantId,
          p.from,
          p.to,
          { statuses: Z_REPORT_STATUSES },
        );
        const comparison: DayComparison = {
          label: p.label,
          revenue,
          profit: revenue - dayProfit.totalCost,
          orderCount: dayOrderCount,
        };
        if (i === 1) prevDay = comparison;
        else weekAgo = comparison;
      }
    }

    trend.push({
      label: period.label,
      weekday: weekdayShortTr(period),
      revenue: reportDayRevenue,
      orderCount: reportDayOrderCount,
      isReportDay: true,
    });

    // Döngü i=1 ve i=7'yi her zaman kapsar — null kalamaz.
    return { trend, prevDay: prevDay!, weekAgo: weekAgo! };
  }

  /**
   * Tenant'ın OWNER/ADMIN kullanıcı e-postaları + opsiyonel ekstra alıcılar
   * (`Z_REPORT_EXTRA_RECIPIENTS`, virgülle ayrılır). Tekrarlar elenir.
   */
  private async resolveRecipients(tenantId: string): Promise<string[]> {
    const users = await this.prisma.user.findMany({
      where: { tenantId, role: { in: ['OWNER', 'ADMIN'] } },
      select: { email: true },
    });

    const extra = (this.config.get<string>('Z_REPORT_EXTRA_RECIPIENTS') ?? '')
      .split(',')
      .map((e) => e.trim())
      .filter((e) => e.length > 0);

    const all = [...users.map((u) => u.email), ...extra]
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0);

    return Array.from(new Set(all));
  }
}
