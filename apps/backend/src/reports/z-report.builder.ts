/**
 * Z raporu — sunum katmanı.
 *
 * `ZReportData` (saf sayısal veri) → e-posta konusu + HTML gövde + CSV eki.
 * Hiç DB/IO yok; tamamen saf dönüşüm — kolay test edilir.
 */
import { Injectable } from '@nestjs/common';
import {
  renderZReport,
  ZReportBarChart,
  ZReportDelta,
  ZReportHeroCard,
  ZReportRankedTable,
  ZReportRecordCard,
} from '../mail/templates';
import {
  CSV_BOM,
  CSV_SEPARATOR,
  Z_REPORT_TOP_SUPPLIERS,
} from './z-report.constants';
import { weekdayLongTr } from './z-report.date';
import { BuiltZReport, OrderCsvRow, ZReportData } from './z-report.types';

const CURRENCY = 'TRY';
const NAVY = '#0b2545';
const GREEN = '#15803d';
const RED = '#dc2626';

/** tr-TR para biçimi — şablonla aynı kural (2 ondalık). */
function formatMoney(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return `${safe.toLocaleString('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${CURRENCY}`;
}

/** Kısa para biçimi (konu satırı + grafik değerleri) — ondalıksız, ₺. */
function formatMoneyShort(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return `${Math.round(safe).toLocaleString('tr-TR')} ₺`;
}

/**
 * Kıyas rozeti üretir. Baz gün 0/negatifse yüzde anlamsız → nötr "veri yok"
 * rozeti döner.
 */
function deltaOf(current: number, previous: number, caption: string): ZReportDelta {
  if (!Number.isFinite(previous) || previous <= 0) {
    return { text: '—', dir: 'flat', caption };
  }
  const pct = ((current - previous) / previous) * 100;
  const dir: ZReportDelta['dir'] = pct > 0.05 ? 'up' : pct < -0.05 ? 'down' : 'flat';
  const text = `%${Math.abs(pct).toLocaleString('tr-TR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}`;
  return { text: dir === 'flat' ? '%0,0' : text, dir, caption };
}

/** tr-TR yüzde biçimi, ör. "23,40%". */
function formatPercent(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return `%${safe.toLocaleString('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** OrderStatus enum değerini insan-okur Türkçe etikete çevirir. */
const STATUS_LABELS: Record<string, string> = {
  paid: 'Ödendi',
  preparing: 'Hazırlanıyor',
  shipped: 'Kargoya Verildi',
  cancelled: 'İptal',
  refunded: 'İade',
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

const PAYMENT_LABELS: Record<string, string> = {
  card: 'Kredi / Banka kartı',
  cari: 'Cari bakiye',
  unknown: 'Belirtilmemiş',
};

function paymentLabel(paymentType: string): string {
  return PAYMENT_LABELS[paymentType] ?? paymentType;
}

/** CSV hücresini güvene alır — ayraç/tırnak/yeni satır içeren değerleri sarar. */
function csvCell(value: string | number): string {
  const str = String(value ?? '');
  if (
    str.includes(CSV_SEPARATOR) ||
    str.includes('"') ||
    str.includes('\n') ||
    str.includes('\r')
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** Decimal-string güvenli sayı biçimi (CSV için, sembID/binlik yok). */
function csvNumber(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  // Excel-TR ondalık ayıracı virgül bekler.
  return safe.toFixed(2).replace('.', ',');
}

function csvDate(date: Date): string {
  // ISO yerine okunur yerel biçim; Excel string olarak gösterir.
  const d = date;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

@Injectable()
export class ZReportBuilder {
  /**
   * SADE (spam-güvenli) sürüm — 2026-07-14 gecesi Natro giden-posta
   * filtresinden GEÇTİĞİ KANITLANAN biçimin birebiri: kurumsal wrap() yok,
   * gizli preheader yok, logo/link yok, basit tablolar, ASCII başlıklar,
   * "TL" para birimi. Zengin şablon (build) aynı filtrede bloklanıyor;
   * Natro düzeltene kadar gece raporu bu biçimle gönderilir
   * (Z_REPORT_TEMPLATE=rich ile zengin şablona dönülür).
   */
  buildLite(data: ZReportData): BuiltZReport {
    return {
      subject: `Gunluk Satis Ozeti ${data.period.label} - Ciro ${Math.round(
        data.totalRevenue,
      ).toLocaleString('tr-TR')} TL`,
      html: this.buildLiteHtml(data),
      csv: this.buildCsv(data),
    };
  }

  /** `ZReportData` → e-posta konusu + HTML + CSV eki. */
  build(data: ZReportData): BuiltZReport {
    return {
      subject:
        `Z Raporu — ${data.period.label} · ` +
        `Ciro ${formatMoneyShort(data.totalRevenue)} · ` +
        `Kâr ${formatMoneyShort(data.totalProfit)}`,
      html: this.buildHtml(data),
      csv: this.buildCsv(data),
    };
  }

  private buildHtml(data: ZReportData): string {
    const profitAccent =
      data.totalProfit > 0 ? GREEN : data.totalProfit < 0 ? RED : NAVY;

    // ── Üst özet kartları: Net Ciro (lacivert) + Net Kâr, dün/geçen hafta
    // kıyas rozetleriyle.
    const heroes: ZReportHeroCard[] = [
      {
        label: 'Net Ciro',
        value: formatMoney(data.totalRevenue),
        inverse: true,
        deltas: [
          deltaOf(data.totalRevenue, data.prevDay.revenue, 'düne göre'),
          deltaOf(data.totalRevenue, data.weekAgo.revenue, 'geçen haftaya göre'),
        ],
      },
      {
        label: 'Net Kâr (Ürün)',
        value: formatMoney(data.totalProfit),
        accent: profitAccent,
        deltas: [
          deltaOf(data.totalProfit, data.prevDay.profit, 'düne göre'),
          deltaOf(data.totalProfit, data.weekAgo.profit, 'geçen haftaya göre'),
        ],
      },
    ];

    const kpis = [
      { label: 'Toplam Maliyet', value: formatMoney(data.totalCost) },
      {
        label: 'Kâr Marjı',
        value: formatPercent(data.margin),
        accent: profitAccent,
      },
      {
        // §3.7 — kart komisyonundan gelen ek kâr (müşteri %3 − POS ~%2,79).
        label: 'Kart Komisyon Kârı',
        value: formatMoney(data.cardCommissionProfit),
      },
      { label: 'Ortalama Sepet', value: formatMoney(data.avgOrderValue) },
      { label: 'Sipariş Adedi', value: String(data.orderCount) },
      { label: 'Kalem Adedi', value: String(data.itemCount) },
    ];

    // ── Günün rekorları.
    const records: ZReportRecordCard[] = [];
    if (data.biggestOrder) {
      records.push({
        icon: '🏆',
        title: 'En Yüksek Sipariş',
        value: formatMoney(data.biggestOrder.value),
        sub: `#${data.biggestOrder.humanOrderNo} · ${data.biggestOrder.customerName}`,
      });
    }
    if (data.mostProfitableOrder) {
      records.push({
        icon: '💎',
        title: 'En Kârlı Sipariş',
        value: formatMoney(data.mostProfitableOrder.value),
        sub: `#${data.mostProfitableOrder.humanOrderNo} · ${data.mostProfitableOrder.customerName}`,
      });
    }
    const peakHour = data.hourly.length
      ? data.hourly.reduce((best, h) => (h.revenue > best.revenue ? h : best))
      : null;
    if (peakHour) {
      const hh = String(peakHour.hour).padStart(2, '0');
      const hhNext = String((peakHour.hour + 1) % 24).padStart(2, '0');
      records.push({
        icon: '⏰',
        title: 'En Yoğun Saat',
        value: `${hh}:00–${hhNext}:00`,
        sub: `${peakHour.orderCount} sipariş · ${formatMoneyShort(peakHour.revenue)}`,
      });
    }
    if (data.orderCount > 0) {
      records.push({
        icon: '🛒',
        title: 'Ortalama Sepet',
        value: formatMoney(data.avgOrderValue),
        sub: `${data.orderCount} siparişte`,
      });
    }

    // ── Son 8 gün ciro trendi — rapor günü koyu lacivert vurgulu.
    const trendMax = Math.max(...data.trend.map((t) => t.revenue), 1);
    const trendChart: ZReportBarChart = {
      title: '📈 Son 8 Gün Ciro Trendi',
      rows: data.trend.map((t) => ({
        label: `${t.weekday} ${t.label.slice(0, 5)}`,
        sub: `${t.orderCount} sip.`,
        valueText: formatMoneyShort(t.revenue),
        pct: (t.revenue / trendMax) * 100,
        color: t.isReportDay ? NAVY : undefined,
        highlight: t.isReportDay,
      })),
    };

    // ── Saatlik yoğunluk — yalnız sipariş düşen saatler.
    const hourlyMax = Math.max(...data.hourly.map((h) => h.revenue), 1);
    const hourlyChart: ZReportBarChart = {
      title: '🕐 Saatlik Satış Yoğunluğu',
      rows: data.hourly.map((h) => ({
        label: `${String(h.hour).padStart(2, '0')}:00`,
        sub: `${h.orderCount} sip.`,
        valueText: formatMoneyShort(h.revenue),
        pct: (h.revenue / hourlyMax) * 100,
      })),
      emptyText: 'Bu gün sipariş yok',
    };

    // ── En çok alan bayiler — ciro payı çubuğuyla.
    const customerMax = Math.max(...data.topCustomers.map((c) => c.revenue), 1);
    const topCustomers: ZReportRankedTable = {
      title: '👑 En Çok Alan Bayiler',
      headers: ['Bayi', 'Sipariş', 'Ciro', 'Kâr'],
      rows: data.topCustomers.map((c, idx) => ({
        rank: idx + 1,
        name: c.customerName,
        pct: (c.revenue / customerMax) * 100,
        cells: [
          String(c.orderCount),
          formatMoney(c.revenue),
          formatMoney(c.profit),
        ],
      })),
      emptyText: 'Bu gün sipariş yok',
    };

    const statusSection = {
      title: 'Statü Kırılımı',
      headers: ['Statü', 'Sipariş', 'Ciro'],
      rows: data.statusBreakdown.map((r) => ({
        label: statusLabel(r.status),
        cells: [String(r.orderCount), formatMoney(r.revenue)],
      })),
    };

    const paymentSection = {
      title: 'Ödeme Tipi Kırılımı',
      headers: ['Ödeme tipi', 'Sipariş', 'Ciro'],
      rows: data.paymentTypeBreakdown.map((r) => ({
        label: paymentLabel(r.paymentType),
        cells: [String(r.orderCount), formatMoney(r.revenue)],
      })),
    };

    const topSuppliers = data.bySupplier.slice(0, Z_REPORT_TOP_SUPPLIERS);
    const supplierSection = {
      title: `En Çok Kâr — İlk ${topSuppliers.length || Z_REPORT_TOP_SUPPLIERS} Tedarikçi`,
      headers: ['Tedarikçi', 'Ciro', 'Maliyet', 'Kâr', 'Marj'],
      rows: topSuppliers.map((s) => ({
        label: s.supplierName,
        cells: [
          formatMoney(s.revenue),
          formatMoney(s.cost),
          formatMoney(s.profit),
          formatPercent(s.margin),
        ],
      })),
    };

    // İptal/iade bilgi satırı — ciroya dahil değil ama görünür olmalı.
    const exclusionsSection = {
      title: 'Ciro Dışı (Bilgi)',
      headers: ['Durum', 'Sipariş'],
      rows: [
        { label: 'İptal edilen', cells: [String(data.cancelledCount)] },
        { label: 'İade edilen', cells: [String(data.refundedCount)] },
      ],
    };

    const warning =
      data.zeroCostItemCount > 0
        ? `${data.zeroCostItemCount} kalemin alış maliyeti tanımsız — kâr rakamları tahminîdir.`
        : undefined;

    // Gizli önizleme satırı — inbox listesinde konunun yanında görünür.
    const revenueDelta = deltaOf(
      data.totalRevenue,
      data.prevDay.revenue,
      'düne göre',
    );
    const deltaText =
      revenueDelta.dir === 'flat'
        ? ''
        : ` (${revenueDelta.dir === 'up' ? '▲' : '▼'} ${revenueDelta.text} düne göre)`;
    const preheader =
      `Ciro ${formatMoneyShort(data.totalRevenue)}${deltaText} · ` +
      `Kâr ${formatMoneyShort(data.totalProfit)} · ${data.orderCount} sipariş`;

    return renderZReport({
      periodLabel: data.period.label,
      weekdayLabel: weekdayLongTr(data.period),
      currency: CURRENCY,
      heroes,
      kpis,
      records,
      trendChart,
      hourlyChart,
      topCustomers,
      warning,
      sections: [
        statusSection,
        paymentSection,
        supplierSection,
        exclusionsSection,
      ],
      csvRowCount: data.orders.length,
      preheader,
    });
  }

  /**
   * Sade HTML gövde — send-z-lite deneyinin (filtreden geçtiği kanıtlı)
   * birebir yapısı. Bilinçli olarak: tek katman div, basit tablolar,
   * ASCII başlıklar, uzak görsel/link YOK, display:none YOK.
   */
  private buildLiteHtml(d: ZReportData): string {
    const money = (v: number) =>
      `${(Number.isFinite(v) ? v : 0).toLocaleString('tr-TR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })} TL`;
    const bar = (v: number, max: number) =>
      '█'.repeat(Math.max(1, Math.round((v / Math.max(max, 1)) * 18)));
    const delta = (cur: number, prev: number) =>
      prev > 0
        ? `${cur >= prev ? '+' : ''}${(((cur - prev) / prev) * 100)
            .toFixed(1)
            .replace('.', ',')}%`
        : '-';
    const rows = (cells: string[][], head: string[]) => `
  <table cellpadding="6" cellspacing="0" border="0" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px;">
    <tr>${head.map((h) => `<th align="left" style="border-bottom:2px solid #333;">${h}</th>`).join('')}</tr>
    ${cells.map((r) => `<tr>${r.map((c) => `<td style="border-bottom:1px solid #ddd;">${c}</td>`).join('')}</tr>`).join('')}
  </table>`;
    const esc = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const LITE_STATUS: Record<string, string> = {
      paid: 'Odendi',
      preparing: 'Hazirlaniyor',
      shipped: 'Kargoya Verildi',
      cancelled: 'Iptal',
      refunded: 'Iade',
    };
    const litePayment = (p: string) =>
      p === 'card' ? 'Kart' : p === 'cari' ? 'Cari' : p;

    const trendMax = Math.max(...d.trend.map((t) => t.revenue), 1);
    const custMax = Math.max(...d.topCustomers.map((c) => c.revenue), 1);
    const ref = Date.now().toString(36).toUpperCase();

    const records: string[][] = [];
    if (d.biggestOrder) {
      records.push([
        'En Yuksek Siparis',
        money(d.biggestOrder.value),
        `#${esc(d.biggestOrder.humanOrderNo)} - ${esc(d.biggestOrder.customerName)}`,
      ]);
    }
    if (d.mostProfitableOrder) {
      records.push([
        'En Karli Siparis',
        money(d.mostProfitableOrder.value),
        `#${esc(d.mostProfitableOrder.humanOrderNo)} - ${esc(d.mostProfitableOrder.customerName)}`,
      ]);
    }

    return `
<div style="font-family:Arial,sans-serif;color:#222;font-size:14px;line-height:1.5;">
  <h2 style="margin:0 0 4px 0;">Z Raporu - ${d.period.label} (${weekdayLongTr(d.period)})</h2>
  <p style="margin:0 0 14px 0;color:#555;">Toptan Budur gunluk is ozeti</p>

  <h3 style="margin:16px 0 6px 0;">Ozet</h3>
  ${rows(
    [
      [
        'Net Ciro',
        `<b>${money(d.totalRevenue)}</b>`,
        `dune gore ${delta(d.totalRevenue, d.prevDay.revenue)} / gecen haftaya gore ${delta(d.totalRevenue, d.weekAgo.revenue)}`,
      ],
      [
        'Net Kar (Urun)',
        `<b>${money(d.totalProfit)}</b>`,
        `dune gore ${delta(d.totalProfit, d.prevDay.profit)} / gecen haftaya gore ${delta(d.totalProfit, d.weekAgo.profit)}`,
      ],
      ['Toplam Maliyet', money(d.totalCost), ''],
      ['Kar Marji', `%${d.margin.toFixed(2).replace('.', ',')}`, ''],
      ['Kart Komisyon Kari', money(d.cardCommissionProfit), ''],
      [
        'Siparis / Kalem',
        `${d.orderCount} / ${d.itemCount}`,
        `iptal ${d.cancelledCount}, iade ${d.refundedCount}`,
      ],
      ['Ortalama Sepet', money(d.avgOrderValue), ''],
    ],
    ['Gosterge', 'Deger', 'Kiyas'],
  )}
${
  records.length
    ? `
  <h3 style="margin:18px 0 6px 0;">Gunun Rekorlari</h3>
  ${rows(records, ['Rekor', 'Deger', 'Detay'])}`
    : ''
}
  <h3 style="margin:18px 0 6px 0;">En Cok Alan Bayiler</h3>
  ${rows(
    d.topCustomers.map((c, i) => [
      `${i + 1}. ${esc(c.customerName)}`,
      String(c.orderCount),
      money(c.revenue),
      money(c.profit),
      `<span style="color:#2563eb;">${bar(c.revenue, custMax)}</span>`,
    ]),
    ['Bayi', 'Siparis', 'Ciro', 'Kar', 'Pay'],
  )}

  <h3 style="margin:18px 0 6px 0;">Son 8 Gun Ciro Trendi</h3>
  ${rows(
    d.trend.map((t) => [
      `${t.weekday} ${t.label.slice(0, 5)}${t.isReportDay ? ' *' : ''}`,
      String(t.orderCount),
      money(t.revenue),
      `<span style="color:#2563eb;">${bar(t.revenue, trendMax)}</span>`,
    ]),
    ['Gun', 'Siparis', 'Ciro', 'Grafik'],
  )}

  <h3 style="margin:18px 0 6px 0;">Statu / Odeme Kirilimi</h3>
  ${rows(
    [
      ...d.statusBreakdown.map((s) => [
        'Statu: ' + (LITE_STATUS[s.status] ?? s.status),
        String(s.orderCount),
        money(s.revenue),
      ]),
      ...d.paymentTypeBreakdown.map((p) => [
        'Odeme: ' + litePayment(p.paymentType),
        String(p.orderCount),
        money(p.revenue),
      ]),
    ],
    ['Kirilim', 'Siparis', 'Ciro'],
  )}

  <h3 style="margin:18px 0 6px 0;">Tedarikci Kari (ilk ${Math.min(d.bySupplier.length, Z_REPORT_TOP_SUPPLIERS) || Z_REPORT_TOP_SUPPLIERS})</h3>
  ${rows(
    d.bySupplier
      .slice(0, Z_REPORT_TOP_SUPPLIERS)
      .map((s) => [
        esc(s.supplierName),
        money(s.revenue),
        money(s.cost),
        money(s.profit),
        `%${s.margin.toFixed(1).replace('.', ',')}`,
      ]),
    ['Tedarikci', 'Ciro', 'Maliyet', 'Kar', 'Marj'],
  )}
${
  d.zeroCostItemCount > 0
    ? `
  <p style="margin:14px 0 0 0;color:#9a3412;font-size:13px;">Uyari: ${d.zeroCostItemCount} kalemin alis maliyeti tanimsiz - kar rakamlari tahminidir.</p>`
    : ''
}
  <p style="margin:18px 0 0 0;color:#777;font-size:12px;">Siparis detaylari ekteki CSV dosyasindadir (${d.orders.length} satir). Ref: ${ref}</p>
</div>`;
  }

  private buildCsv(data: ZReportData): { filename: string; content: Buffer } {
    const headers = [
      'Sipariş No',
      'Tarih',
      'Statü',
      'Müşteri',
      'Ödeme Tipi',
      'Kalem',
      'Ara Toplam',
      'KDV',
      'Toplam (KDV Dahil)',
      'Kâr',
    ];

    const lines: string[] = [];
    lines.push(headers.map(csvCell).join(CSV_SEPARATOR));

    for (const o of data.orders) {
      lines.push(this.csvRow(o));
    }

    // Toplam satırı — sadece ciroya dahil siparişler.
    lines.push(
      [
        csvCell('TOPLAM'),
        '',
        '',
        '',
        '',
        csvCell(data.itemCount),
        '',
        '',
        csvNumber(data.totalRevenue),
        csvNumber(data.totalProfit),
      ].join(CSV_SEPARATOR),
    );

    const body = CSV_BOM + lines.join('\r\n') + '\r\n';
    const safeLabel = data.period.label.replace(/\./g, '-');
    return {
      filename: `z-raporu-${safeLabel}.csv`,
      content: Buffer.from(body, 'utf-8'),
    };
  }

  private csvRow(o: OrderCsvRow): string {
    return [
      csvCell(o.humanOrderNo),
      csvCell(csvDate(o.createdAt)),
      csvCell(statusLabel(o.status)),
      csvCell(o.customerName),
      csvCell(paymentLabel(o.paymentType)),
      csvCell(o.itemCount),
      csvNumber(o.subtotal),
      csvNumber(o.kdvAmount),
      csvNumber(o.total),
      // İptal/iade satırlarında kâr hesaplanmaz → hücre boş.
      o.profit == null ? '' : csvNumber(o.profit),
    ].join(CSV_SEPARATOR);
  }
}
