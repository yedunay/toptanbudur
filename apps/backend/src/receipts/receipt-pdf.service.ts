import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser, LaunchOptions } from 'puppeteer';

export type ReceiptKind = 'order' | 'cari_topup';

/**
 * Makbuz şablonuna gömülecek tüm token değerleri. Hepsi ham string olarak
 * verilir; HTML escape `render()` içinde uygulanır (XSS / layout kırılması
 * engeli — BAYI_ADI/KART_SAHIBI/ACIKLAMA müşteri kaynaklı veri içerebilir).
 *
 * `TUTAR` değeri "TL" sonekini İÇERMELİDİR (şablonda salt token vardır):
 *   ör. "12.450,00 TL".
 */
export interface ReceiptTokens {
  MAKBUZ_NO: string;
  TARIH: string;
  SAAT: string;
  TUTAR: string;
  BAYI_ADI: string;
  BAYI_ID: string;
  KART_SAHIBI: string;
  DURUM: string;
  ACIKLAMA: string;
  /** Sipariş makbuzunda dolu; cari makbuzunda undefined. */
  SIPARIS_NO?: string;
  /** Cari makbuzunda dolu (= humanTopupNo); sipariş makbuzunda undefined. */
  ISLEM_NO?: string;
}

const TEMPLATE_FILE: Record<ReceiptKind, string> = {
  order: 'siparis.html',
  cari_topup: 'cari.html',
};

/**
 * HTML makbuz şablonunu Puppeteer (headless Chromium) ile A4 PDF'e dönüştürür.
 *
 * - Tarayıcı tek bir singleton olarak lazy açılır ve süreç boyunca paylaşılır;
 *   her render için yalnızca yeni bir `page` açılıp kapanır.
 * - Prod'da Chromium ayrı kurulur ve `PUPPETEER_EXECUTABLE_PATH` ile gösterilir
 *   (Dockerfile'da chromium apt paketi + env). Lokal/dev'de Puppeteer'ın kendi
 *   indirdiği Chromium kullanılır.
 * - Şablonlar build sonrası `dist/`'e kopyalanır (nest-cli.json assets). Çalışma
 *   anında birden çok aday yol denenir; ts-jest (src) ve prod (dist) ikisi de
 *   çalışır.
 *
 * Storage'a yükleme ve DB cache'leme bu servisin sorumluluğunda DEĞİLDİR;
 * burası yalnızca saf bir `Buffer` üretir. Yükleme/cache `ReceiptsService`'te.
 */
@Injectable()
export class ReceiptPdfService implements OnModuleDestroy {
  private readonly logger = new Logger(ReceiptPdfService.name);
  private browserPromise: Promise<Browser> | null = null;
  private readonly templateCache = new Map<string, string>();

  async onModuleDestroy(): Promise<void> {
    if (!this.browserPromise) return;
    try {
      const browser = await this.browserPromise;
      await browser.close();
    } catch (error: unknown) {
      this.logger.warn(
        `Puppeteer tarayıcısı kapatılamadı: ${this.toMessage(error)}`,
      );
    } finally {
      this.browserPromise = null;
    }
  }

  /**
   * Verilen tokenlarla şablonu render edip A4 PDF Buffer döner.
   */
  async renderPdf(kind: ReceiptKind, tokens: ReceiptTokens): Promise<Buffer> {
    const html = this.render(kind, tokens);
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      // Şablon tamamen self-contained (inline CSS + data: URI logo, harici
      // istek yok) — 'load' eventi data-URI görselin decode'unu da bekler.
      await page.setContent(html, { waitUntil: 'load' });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
      });
      return Buffer.from(pdf);
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  // --- internal -----------------------------------------------------------

  private render(kind: ReceiptKind, tokens: ReceiptTokens): string {
    const template = this.loadTemplate(kind);
    const replacements: Record<string, string> = {
      '{{MAKBUZ_NO}}': tokens.MAKBUZ_NO,
      '{{TARIH}}': tokens.TARIH,
      '{{SAAT}}': tokens.SAAT,
      '{{TUTAR}}': tokens.TUTAR,
      '{{BAYI_ADI}}': tokens.BAYI_ADI,
      '{{BAYI_ID}}': tokens.BAYI_ID,
      '{{KART_SAHIBI}}': tokens.KART_SAHIBI,
      '{{DURUM}}': tokens.DURUM,
      '{{ACIKLAMA}}': tokens.ACIKLAMA,
      '{{SIPARIS_NO}}': tokens.SIPARIS_NO ?? '',
      '{{ISLEM_NO}}': tokens.ISLEM_NO ?? '',
    };

    let html = template;
    for (const [token, value] of Object.entries(replacements)) {
      // split/join: global literal replace, regex-meta güvenli.
      html = html.split(token).join(this.escapeHtml(value));
    }
    return html;
  }

  private loadTemplate(kind: ReceiptKind): string {
    const file = TEMPLATE_FILE[kind];
    const cached = this.templateCache.get(file);
    if (cached) return cached;

    const candidates = [
      // dist/src/receipts/templates (prod) ya da src/receipts/templates (ts-jest)
      join(__dirname, 'templates', file),
      join(process.cwd(), 'dist', 'src', 'receipts', 'templates', file),
      join(process.cwd(), 'src', 'receipts', 'templates', file),
    ];

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        const html = readFileSync(candidate, 'utf8');
        this.templateCache.set(file, html);
        return html;
      }
    }

    throw new Error(
      `Makbuz şablonu bulunamadı: ${file} (denenen yollar: ${candidates.join(' | ')})`,
    );
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browserPromise) {
      try {
        const browser = await this.browserPromise;
        if (browser.connected) return browser;
      } catch {
        // Açılış başarısızsa aşağıda yeniden denenir.
      }
      this.browserPromise = null;
    }
    this.browserPromise = this.launchBrowser();
    try {
      return await this.browserPromise;
    } catch (error: unknown) {
      // Başarısız promise'i tutma; sonraki çağrı tekrar denesin.
      this.browserPromise = null;
      throw error;
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
      `Puppeteer başlatılıyor (executablePath=${executablePath ?? 'paket-içi'})`,
    );
    return puppeteer.launch(options);
  }

  private escapeHtml(value: string): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private toMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
