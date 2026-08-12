import { Injectable, Logger } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import type { Browser, LaunchOptions } from 'puppeteer';
import type { AdminFinanceService } from './finance.service';

type MonthlyPanel = Awaited<ReturnType<AdminFinanceService['getMonthlyPanel']>>;

const NUMFMT_TRY = '#,##0.00 "₺"';
const NAVY = 'FF0F2557';
const NAVY_TEXT = 'FFFFFFFF';

function tl(n: number): string {
  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency: 'TRY',
    maximumFractionDigits: 2,
  }).format(n);
}

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Aylık Finans paneli için Excel ve PDF üretimi. Panel verisi
 * AdminFinanceService.getMonthlyPanel'den gelir (tek hesap kaynağı).
 */
@Injectable()
export class FinanceExportService {
  private readonly logger = new Logger(FinanceExportService.name);

  // ── Excel ──────────────────────────────────────────────────────────────────
  async buildExcel(panel: MonthlyPanel): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Toptan Budur';
    wb.created = new Date();

    // 1) Özet
    const s1 = wb.addWorksheet('Özet');
    s1.columns = [
      { header: '', width: 28 },
      { header: 'Gelen', width: 18 },
      { header: 'Giden', width: 18 },
      { header: 'Kâr', width: 18 },
      { header: 'KDV Farkı', width: 18 },
    ];
    this.titleRow(s1, `Aylık Finans Özeti — ${panel.monthLabel}`, 5);
    s1.addRow(['', 'Gelen', 'Giden', 'Kâr', 'KDV Farkı']);
    this.headerRow(s1, s1.lastRow!.number);
    const kpiRow = (label: string, k: MonthlyPanel['toplam']) => {
      const r = s1.addRow([label, k.gelen, k.giden, k.kar, k.kdvFarki]);
      for (let c = 2; c <= 5; c++) r.getCell(c).numFmt = NUMFMT_TRY;
    };
    kpiRow('Toptan Budur', panel.bayi.current);
    kpiRow('Manuel Gelir/Gider', panel.entegrasyon.current);
    kpiRow('TOPLAM', panel.toplam);

    // 2) Masraflar
    const s2 = wb.addWorksheet('Masraflar');
    s2.columns = [
      { header: 'Tür', width: 14 },
      { header: 'Kategori', width: 22 },
      { header: 'Açıklama', width: 30 },
      { header: 'Tutar', width: 16 },
      { header: 'KDV %', width: 10 },
      { header: 'Durum', width: 12 },
      { header: 'Ödeyen', width: 22 },
    ];
    this.headerRow(s2, 1);
    const allExp = [...panel.expenses.recurring, ...panel.expenses.oneTime];
    for (const e of allExp) {
      const r = s2.addRow([
        e.kind === 'RECURRING' ? 'Sürekli' : 'Tek Seferlik',
        e.category,
        e.description,
        e.amount,
        e.kdvRate,
        e.status === 'PAID' ? 'Ödendi' : 'Ödenmedi',
        e.paidByPartnerName ?? '—',
      ]);
      r.getCell(4).numFmt = NUMFMT_TRY;
    }
    const totalRow = s2.addRow(['', '', 'TOPLAM (aktif)', panel.expenses.total, '', '', '']);
    totalRow.getCell(4).numFmt = NUMFMT_TRY;
    totalRow.font = { bold: true };

    // 3) Dağılım
    const s3 = wb.addWorksheet('Dağılım');
    s3.columns = [{ header: '', width: 34 }, { header: '', width: 20 }];
    this.titleRow(s3, `Bakiye Dağılım Hesabı — ${panel.monthLabel}`, 2);
    const line = (label: string, val: number, bold = false) => {
      const r = s3.addRow([label, val]);
      r.getCell(2).numFmt = NUMFMT_TRY;
      if (bold) r.font = { bold: true };
    };
    line('Toplam Gelen', panel.distribution.toplamGelen);
    line('Toplam Giden', panel.distribution.toplamGiden);
    line('Toplam KDV Farkı', panel.distribution.toplamKdvFarki);
    line('Havuz Masraf', panel.distribution.havuzMasraf);
    if (panel.distribution.promo > 0)
      line('Promo/Hediye Bakiye (−)', panel.distribution.promo);
    if (panel.distribution.cardSpread > 0)
      line('Kart Komisyon Farkı (+)', panel.distribution.cardSpread);
    line('Dağıtılabilir Bakiye', panel.distribution.dagitilabilirBakiye, true);
    s3.addRow([]);
    s3.addRow(['Ortak', 'Önerilen Ödeme']);
    this.headerRow(s3, s3.lastRow!.number);
    for (const p of panel.distribution.partners) {
      const r = s3.addRow([`${p.name} (%${p.sharePercent})`, p.onerilen]);
      r.getCell(2).numFmt = NUMFMT_TRY;
    }
    if (panel.distribution.settlement) {
      s3.addRow([]);
      const st = panel.distribution.settlement;
      line(`${st.fromName} → ${st.toName} (dengeleme)`, st.amount, true);
    }

    // 4) Döner Sermaye (kümülatif ortak bakiyeleri + kâr avansları)
    const cap = panel.capital;
    const s4 = wb.addWorksheet('Döner Sermaye');
    s4.columns = [
      { header: '', width: 28 },
      { header: '', width: 18 },
      { header: '', width: 18 },
      { header: '', width: 16 },
      { header: '', width: 32 },
    ];
    this.titleRow(
      s4,
      `Ortak Bakiyeleri — ${cap.monthLabel} sonu (kümülatif)`,
      3,
    );
    s4.addRow(['Ortak', 'Net Bakiye']);
    this.headerRow(s4, s4.lastRow!.number);
    for (const p of cap.partners) {
      const r = s4.addRow([`${p.name} (%${p.sharePercent})`, p.netBalance]);
      r.getCell(2).numFmt = NUMFMT_TRY;
    }
    const dsRow = s4.addRow(['TOPTAN BUDUR DÖNER SERMAYE', cap.netTotal]);
    dsRow.getCell(2).numFmt = NUMFMT_TRY;
    dsRow.font = { bold: true };

    if (cap.advances.length > 0) {
      s4.addRow([]);
      this.titleRow(s4, 'Kâr Avansları', 4);
      s4.addRow(['Tarih', 'Ortak', 'Tutar', 'Açıklama']);
      this.headerRow(s4, s4.lastRow!.number);
      for (const a of cap.advances) {
        const r = s4.addRow([
          a.advanceDate.slice(0, 10),
          a.partnerName ?? '—',
          a.netAmount,
          a.description ?? '—',
        ]);
        r.getCell(3).numFmt = NUMFMT_TRY;
      }
    }

    const out = await wb.xlsx.writeBuffer();
    return Buffer.from(out);
  }

  private titleRow(ws: ExcelJS.Worksheet, title: string, span: number) {
    const r = ws.addRow([title]);
    ws.mergeCells(r.number, 1, r.number, span);
    r.getCell(1).font = { bold: true, size: 14, color: { argb: NAVY } };
    ws.addRow([]);
  }

  private headerRow(ws: ExcelJS.Worksheet, rowNumber: number) {
    const r = ws.getRow(rowNumber);
    r.font = { bold: true, color: { argb: NAVY_TEXT } };
    r.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    });
  }

  // ── PDF (puppeteer; receipt-pdf.service ile aynı launch profili) ─────────────
  async buildPdf(panel: MonthlyPanel): Promise<Buffer> {
    const html = this.renderHtml(panel);
    const browser = await this.launchBrowser();
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'load' });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' },
      });
      return Buffer.from(pdf);
    } finally {
      await browser.close().catch(() => undefined);
    }
  }

  private async launchBrowser(): Promise<Browser> {
    const { default: puppeteer } = await import('puppeteer');
    const executablePath =
      process.env.PUPPETEER_EXECUTABLE_PATH?.trim() || undefined;
    const options: LaunchOptions = {
      headless: true,
      executablePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--font-render-hinting=none',
      ],
    };
    this.logger.log(
      `Finans PDF — Puppeteer başlatılıyor (executablePath=${executablePath ?? 'paket-içi'})`,
    );
    return puppeteer.launch(options);
  }

  private renderHtml(panel: MonthlyPanel): string {
    const kpiTable = (title: string, k: MonthlyPanel['toplam']) => `
      <tr><td class="lbl">${esc(title)}</td>
        <td class="num">${tl(k.gelen)}</td>
        <td class="num">${tl(k.giden)}</td>
        <td class="num pos">${tl(k.kar)}</td>
        <td class="num">${tl(k.kdvFarki)}</td></tr>`;

    const expRows = [...panel.expenses.recurring, ...panel.expenses.oneTime]
      .map(
        (e) => `<tr>
          <td>${esc(e.category)}</td>
          <td>${esc(e.description)}</td>
          <td class="num">${tl(e.amount)}</td>
          <td>${e.status === 'PAID' ? 'Ödendi' : 'Ödenmedi'}</td>
          <td>${esc(e.paidByPartnerName ?? '—')}</td></tr>`,
      )
      .join('');

    const partnerRows = panel.distribution.partners
      .map(
        (p) => `<tr>
          <td class="lbl">${esc(p.name)} (%${p.sharePercent})</td>
          <td class="num">${tl(p.share)}</td>
          <td class="num">${tl(p.dengeleme)}</td>
          <td class="num pos">${tl(p.onerilen)}</td></tr>`,
      )
      .join('');

    const cap = panel.capital;
    const capitalRows = cap.partners
      .map(
        (p) => `<tr>
          <td class="lbl">${esc(p.name)} (%${p.sharePercent})</td>
          <td class="num">${tl(p.netBalance)}</td></tr>`,
      )
      .join('');
    const advanceRows = cap.advances
      .map(
        (a) => `<tr>
          <td>${esc(a.advanceDate.slice(0, 10))}</td>
          <td>${esc(a.partnerName ?? '—')}</td>
          <td class="num">${tl(a.netAmount)}</td>
          <td>${esc(a.description ?? '—')}</td></tr>`,
      )
      .join('');

    return `<!doctype html><html lang="tr"><head><meta charset="utf-8"/>
      <style>
        * { box-sizing: border-box; }
        body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #0f2557; margin: 0; }
        .hdr { display:flex; justify-content:space-between; align-items:center; border-bottom:3px solid #1D6FE0; padding-bottom:10px; margin-bottom:16px; }
        .brand { font-size:22px; font-weight:800; } .brand span { color:#1D6FE0; }
        .sub { color:#64748b; font-size:12px; }
        h2 { font-size:13px; text-transform:uppercase; letter-spacing:.5px; color:#1D6FE0; margin:18px 0 6px; }
        table { width:100%; border-collapse:collapse; font-size:11px; }
        th { background:#0f2557; color:#fff; text-align:left; padding:6px 8px; }
        td { padding:6px 8px; border-bottom:1px solid #e5e7eb; }
        .num { text-align:right; font-variant-numeric: tabular-nums; }
        .lbl { font-weight:600; } .pos { color:#059669; }
        .box { background:#0f2557; color:#fff; padding:12px 16px; border-radius:10px; display:inline-block; margin-top:8px; }
        .box b { font-size:18px; }
      </style></head><body>
      <div class="hdr">
        <div><div class="brand">Toptan <span>Budur</span></div>
          <div class="sub">Aylık Finans ve Ortak Dağılım Paneli</div></div>
        <div class="sub"><b>${esc(panel.monthLabel)}</b></div>
      </div>

      <h2>Finans Özeti</h2>
      <table>
        <tr><th></th><th class="num">Gelen</th><th class="num">Giden</th><th class="num">Kâr</th><th class="num">KDV Farkı</th></tr>
        ${kpiTable('Toptan Budur', panel.bayi.current)}
        ${kpiTable('Manuel Gelir/Gider', panel.entegrasyon.current)}
        ${kpiTable('TOPLAM', panel.toplam)}
      </table>

      <h2>Masraflar ve Harcamalar</h2>
      <table>
        <tr><th>Kategori</th><th>Açıklama</th><th class="num">Tutar</th><th>Durum</th><th>Ödeyen</th></tr>
        ${expRows || '<tr><td colspan="5">Kayıt yok.</td></tr>'}
      </table>

      <h2>Bakiye Dağılım Hesabı</h2>
      <div class="box">Dağıtılabilir Bakiye: <b>${tl(panel.distribution.dagitilabilirBakiye)}</b></div>
      ${
        panel.distribution.promo > 0 || panel.distribution.cardSpread > 0
          ? `<p class="sub" style="margin-top:6px">Dahil: Promo/Hediye Bakiye −${tl(
              panel.distribution.promo,
            )} · Kart Komisyon Farkı +${tl(panel.distribution.cardSpread)}</p>`
          : ''
      }
      <table style="margin-top:10px">
        <tr><th>Ortak</th><th class="num">Pay</th><th class="num">Dengeleme</th><th class="num">Önerilen Ödeme</th></tr>
        ${partnerRows}
      </table>
      ${
        panel.distribution.settlement
          ? `<p class="sub" style="margin-top:10px">Ortaklar arası dengeleme: <b>${esc(
              panel.distribution.settlement.fromName,
            )}</b> → <b>${esc(panel.distribution.settlement.toName)}</b> : ${tl(
              panel.distribution.settlement.amount,
            )}</p>`
          : ''
      }

      <h2>Ortak Bakiyeleri ve Döner Sermaye — ${esc(cap.monthLabel)} sonu (kümülatif)</h2>
      <table>
        <tr><th>Ortak</th><th class="num">Net Bakiye</th></tr>
        ${capitalRows}
        <tr style="font-weight:800;background:#f1f5f9">
          <td class="lbl">TOPTAN BUDUR DÖNER SERMAYE</td>
          <td class="num pos">${tl(cap.netTotal)}</td></tr>
      </table>
      <p class="sub" style="margin-top:6px">Tek bakiye (Net) = KDV devlete ayrıldıktan sonra gerçek kalan. Eksi = ortak payından fazla çekmiş.</p>
      ${
        advanceRows
          ? `<h2>Kâr Avansları</h2>
      <table>
        <tr><th>Tarih</th><th>Ortak</th><th class="num">Tutar</th><th>Açıklama</th></tr>
        ${advanceRows}
      </table>`
          : ''
      }
    </body></html>`;
  }
}
