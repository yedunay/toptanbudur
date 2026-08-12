import { ZReportBuilder } from './z-report.builder';
import { ZReportData } from './z-report.types';

/** Minimal ama gerçekçi bir `ZReportData` üretir; testler alanları override eder. */
function makeData(overrides: Partial<ZReportData> = {}): ZReportData {
  const base: ZReportData = {
    tenantId: 't1',
    period: {
      from: new Date('2026-05-13T21:00:00.000Z'),
      to: new Date('2026-05-14T20:59:59.999Z'),
      label: '14.05.2026',
    },
    totalRevenue: 1200,
    totalCost: 800,
    totalProfit: 400,
    cardCommissionProfit: 5.04,
    margin: 33.3333,
    orderCount: 3,
    itemCount: 7,
    zeroCostItemCount: 0,
    cancelledCount: 1,
    refundedCount: 0,
    statusBreakdown: [
      // `shipped` artık terminal teslimat statüsü (delivered enum'dan kaldırıldı).
      { status: 'shipped', orderCount: 2, revenue: 900 },
      { status: 'paid', orderCount: 1, revenue: 300 },
      { status: 'cancelled', orderCount: 1, revenue: 0 },
    ],
    paymentTypeBreakdown: [
      { paymentType: 'card', orderCount: 2, revenue: 900 },
      { paymentType: 'cari', orderCount: 1, revenue: 300 },
    ],
    bySupplier: [
      {
        supplierId: 's1',
        supplierName: 'Tedarikçi A',
        revenue: 1200,
        cost: 800,
        profit: 400,
        margin: 33.3333,
        orderCount: 3,
        itemCount: 7,
      },
    ],
    avgOrderValue: 400,
    prevDay: {
      label: '13.05.2026',
      revenue: 1000,
      profit: 320,
      orderCount: 4,
    },
    weekAgo: {
      label: '07.05.2026',
      revenue: 1500,
      profit: 500,
      orderCount: 5,
    },
    trend: [
      {
        label: '13.05.2026',
        weekday: 'Çar',
        revenue: 1000,
        orderCount: 4,
        isReportDay: false,
      },
      {
        label: '14.05.2026',
        weekday: 'Per',
        revenue: 1200,
        orderCount: 3,
        isReportDay: true,
      },
    ],
    topCustomers: [
      {
        customerName: 'Ahmet Yılmaz',
        orderCount: 2,
        itemCount: 5,
        revenue: 900,
        profit: 300,
      },
      {
        customerName: 'Mehmet Demir',
        orderCount: 1,
        itemCount: 2,
        revenue: 300,
        profit: 100,
      },
    ],
    hourly: [
      { hour: 10, orderCount: 2, revenue: 900 },
      { hour: 14, orderCount: 1, revenue: 300 },
    ],
    biggestOrder: {
      humanOrderNo: 'YB-1001',
      customerName: 'Ahmet Yılmaz',
      value: 600,
    },
    mostProfitableOrder: {
      humanOrderNo: 'YB-1002',
      customerName: 'Mehmet Demir',
      value: 150,
    },
    orders: [
      {
        humanOrderNo: 'YB-1001',
        createdAt: new Date('2026-05-14T07:15:00.000Z'),
        status: 'shipped',
        customerName: 'Ahmet Yılmaz',
        paymentType: 'card',
        itemCount: 3,
        subtotal: 500,
        kdvAmount: 100,
        total: 600,
        profit: 210.5,
      },
      {
        humanOrderNo: 'YB-1002',
        createdAt: new Date('2026-05-14T11:42:00.000Z'),
        status: 'paid',
        customerName: 'Mehmet; Demir',
        paymentType: 'cari',
        itemCount: 4,
        subtotal: 250,
        kdvAmount: 50,
        total: 300,
        profit: null,
      },
    ],
  };
  return { ...base, ...overrides };
}

describe('ZReportBuilder', () => {
  const builder = new ZReportBuilder();

  describe('build()', () => {
    it('produces a subject with the period label plus revenue and profit', () => {
      const built = builder.build(makeData());
      expect(built.subject).toBe(
        'Z Raporu — 14.05.2026 · Ciro 1.200 ₺ · Kâr 400 ₺',
      );
    });

    it('renders KPI values into the HTML body', () => {
      const built = builder.build(makeData());
      // tr-TR para biçimi: binlik nokta, ondalık virgül.
      expect(built.html).toContain('1.200,00 TRY');
      expect(built.html).toContain('800,00 TRY');
      expect(built.html).toContain('400,00 TRY');
      expect(built.html).toContain('Net Ciro');
      expect(built.html).toContain('Net Kâr');
    });

    it('renders comparison delta chips against prev day and last week', () => {
      const built = builder.build(makeData());
      // Ciro 1200 vs dün 1000 → ▲ %20,0; vs geçen hafta 1500 → ▼ %20,0.
      expect(built.html).toContain('▲ %20,0');
      expect(built.html).toContain('▼ %20,0');
      expect(built.html).toContain('düne göre');
      expect(built.html).toContain('geçen haftaya göre');
    });

    it('renders a neutral chip when the comparison base is zero', () => {
      const built = builder.build(
        makeData({
          prevDay: { label: '13.05.2026', revenue: 0, profit: 0, orderCount: 0 },
        }),
      );
      expect(built.html).toContain('• —');
    });

    it('renders the top customers with rank medals and figures', () => {
      const built = builder.build(makeData());
      expect(built.html).toContain('En Çok Alan Bayiler');
      expect(built.html).toContain('🥇 Ahmet Yılmaz');
      expect(built.html).toContain('🥈 Mehmet Demir');
      expect(built.html).toContain('900,00 TRY');
    });

    it('renders trend and hourly charts plus record cards', () => {
      const built = builder.build(makeData());
      expect(built.html).toContain('Son 8 Gün Ciro Trendi');
      expect(built.html).toContain('Per 14.05');
      expect(built.html).toContain('Saatlik Satış Yoğunluğu');
      expect(built.html).toContain('10:00');
      expect(built.html).toContain('Günün Rekorları');
      expect(built.html).toContain('En Yüksek Sipariş');
      expect(built.html).toContain('#YB-1001 · Ahmet Yılmaz');
      expect(built.html).toContain('En Kârlı Sipariş');
      // En yoğun saat 10:00–11:00 (900 &gt; 300).
      expect(built.html).toContain('10:00–11:00');
    });

    it('shows the zero-cost warning only when there are zero-cost items', () => {
      const withWarning = builder.build(makeData({ zeroCostItemCount: 5 }));
      expect(withWarning.html).toContain('5 kalemin alış maliyeti tanımsız');

      const noWarning = builder.build(makeData({ zeroCostItemCount: 0 }));
      expect(noWarning.html).not.toContain('alış maliyeti tanımsız');
    });

    it('translates status and payment codes to Turkish labels', () => {
      const built = builder.build(makeData());
      expect(built.html).toContain('Kargoya Verildi');
      expect(built.html).toContain('Ödendi');
      expect(built.html).toContain('Kredi / Banka kartı');
      expect(built.html).toContain('Cari bakiye');
    });
  });

  describe('buildLite()', () => {
    it('produces the proven spam-safe subject (ASCII, TL, no special chars)', () => {
      const built = builder.buildLite(makeData());
      expect(built.subject).toBe(
        'Gunluk Satis Ozeti 14.05.2026 - Ciro 1.200 TL',
      );
    });

    it('contains all key figures and sections', () => {
      const built = builder.buildLite(makeData());
      expect(built.html).toContain('1.200,00 TL');
      expect(built.html).toContain('400,00 TL');
      expect(built.html).toContain('En Cok Alan Bayiler');
      expect(built.html).toContain('1. Ahmet Yılmaz');
      expect(built.html).toContain('Son 8 Gun Ciro Trendi');
      expect(built.html).toContain('Gunun Rekorlari');
      expect(built.html).toContain('dune gore +20,0%');
      expect(built.html).toContain('Tedarikci Kari');
    });

    it('avoids the elements the relay filter blocks on', () => {
      const built = builder.buildLite(makeData());
      // Kanıtlı-geçen biçimin kritik özellikleri: gizli metin yok, uzak
      // görsel yok, link yok, kurumsal wrap yok.
      expect(built.html).not.toContain('display:none');
      expect(built.html).not.toContain('<img');
      expect(built.html).not.toContain('https://');
      expect(built.html).not.toContain('<!doctype');
    });

    it('escapes HTML in customer/supplier names', () => {
      const built = builder.buildLite(
        makeData({
          topCustomers: [
            {
              customerName: 'Kötü <script>alert(1)</script> Bayi',
              orderCount: 1,
              itemCount: 1,
              revenue: 100,
              profit: 10,
            },
          ],
        }),
      );
      expect(built.html).not.toContain('<script>');
      expect(built.html).toContain('&lt;script&gt;');
    });

    it('ships the same CSV attachment as the rich build', () => {
      const lite = builder.buildLite(makeData());
      const rich = builder.build(makeData());
      expect(lite.csv.filename).toBe(rich.csv.filename);
      expect(lite.csv.content.toString('utf-8')).toBe(
        rich.csv.content.toString('utf-8'),
      );
    });
  });

  describe('buildCsv via build()', () => {
    it('names the file with dashed period label', () => {
      const built = builder.build(makeData());
      expect(built.csv.filename).toBe('z-raporu-14-05-2026.csv');
    });

    it('prepends a UTF-8 BOM and uses CRLF line endings', () => {
      const built = builder.build(makeData());
      const text = built.csv.content.toString('utf-8');
      expect(text.charCodeAt(0)).toBe(0xfeff);
      expect(text).toContain('\r\n');
    });

    it('writes a header row, one row per order, and a TOPLAM row', () => {
      const built = builder.build(makeData());
      const text = built.csv.content.toString('utf-8');
      const lines = text.replace(/^﻿/, '').trim().split('\r\n');
      // 1 header + 2 orders + 1 total
      expect(lines).toHaveLength(4);
      expect(lines[0]).toContain('Sipariş No');
      expect(lines[1]).toContain('YB-1001');
      expect(lines[2]).toContain('YB-1002');
      expect(lines[3]).toContain('TOPLAM');
    });

    it('quotes cells that contain the separator', () => {
      const built = builder.build(makeData());
      const text = built.csv.content.toString('utf-8');
      // "Mehmet; Demir" ayraç içerdiği için tırnaklanmalı.
      expect(text).toContain('"Mehmet; Demir"');
    });

    it('formats money with a decimal comma in the CSV', () => {
      const built = builder.build(makeData());
      const text = built.csv.content.toString('utf-8');
      // 600 → "600,00"
      expect(text).toContain('600,00');
      // TOPLAM satırı toplam ciroyu yazar.
      expect(text).toContain('1200,00');
    });

    it('writes the per-order profit column, blank when profit is unknown', () => {
      const built = builder.build(makeData());
      const text = built.csv.content.toString('utf-8');
      const lines = text.replace(/^﻿/, '').trim().split('\r\n');
      expect(lines[0]).toContain('Kâr');
      // YB-1001 kârlı satır; YB-1002 profit=null → satır boş kârla biter.
      expect(lines[1]).toContain('210,50');
      expect(lines[2].endsWith(';')).toBe(true);
      // TOPLAM satırı toplam kârı da yazar.
      expect(lines[3]).toContain('400,00');
    });

    it('puts the total revenue and item count on the TOPLAM row', () => {
      const built = builder.build(
        makeData({ totalRevenue: 1500.5, itemCount: 9 }),
      );
      const text = built.csv.content.toString('utf-8');
      const totalLine = text
        .replace(/^﻿/, '')
        .trim()
        .split('\r\n')
        .find((l) => l.startsWith('TOPLAM'));
      expect(totalLine).toBeDefined();
      expect(totalLine).toContain('1500,50');
      expect(totalLine).toContain('9');
    });
  });
});
