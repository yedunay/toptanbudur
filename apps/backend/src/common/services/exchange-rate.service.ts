import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { XMLParser } from 'fast-xml-parser';
import axios from 'axios';

/**
 * TCMB (Türkiye Cumhuriyet Merkez Bankası) günlük döviz kuru servisi.
 *
 * Kaynak: https://www.tcmb.gov.tr/kurlar/today.xml
 * Format: <Tarih_Date><Currency CurrencyCode="USD"><ForexSelling>...</ForexSelling>...
 *
 * Davranış:
 *  - getUsdToTry() son başarılı kuru 1 saat cache'ler.
 *  - Cache miss / cron tetiklendiğinde TCMB'den fetch eder.
 *  - Fetch fail olursa son başarılı değeri döndürür (graceful degradation).
 *  - Hiç başarılı değer yoksa null döndürür (caller fallback'e gitmeli).
 *
 * Güvenlik notları:
 *  - Sadece HTTPS, sabit domain (SSRF riski yok).
 *  - 10sn timeout.
 *  - Maks 1MB response (TCMB feed ~30KB).
 *  - Network/parse hataları log'lanır, exception throw edilmez (servis bootstrap'ı bloklamasın).
 */

const TCMB_FEED_URL = 'https://www.tcmb.gov.tr/kurlar/today.xml';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 saat
const FETCH_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1024 * 1024; // 1MB

export interface ExchangeRateSnapshot {
  rate: number;
  source: 'TCMB';
  fetchedAt: Date;
}

interface TcmbCurrency {
  CurrencyCode?: string;
  ForexSelling?: string | number;
  BanknoteSelling?: string | number;
}

interface TcmbDocument {
  Tarih_Date?: {
    Currency?: TcmbCurrency | TcmbCurrency[];
  };
}

@Injectable()
export class ExchangeRateService implements OnModuleInit {
  private readonly logger = new Logger(ExchangeRateService.name);
  private cached: ExchangeRateSnapshot | null = null;
  /** En son başarılı snapshot — TCMB down olduğunda fallback. */
  private lastSuccess: ExchangeRateSnapshot | null = null;

  async onModuleInit(): Promise<void> {
    // Bootstrap fetch — fire-and-forget, başarısız olursa servis hata vermez
    // (sonraki cron veya getUsdToTry tetiklenince yeniden denenecek).
    void this.refresh().catch((err) => {
      this.logger.warn(
        `bootstrap TCMB fetch failed: ${(err as Error).message}`,
      );
    });
  }

  /**
   * Saat başı TCMB feed'ini yenile. TCMB günde bir kez kur açıkladığı için
   * saatlik frekans gereğinden fazla — ama feed henüz açıklanmamış olabilir
   * (15:30 öncesi yeni kur olmaz), o yüzden saatte bir kontrol mantıklı.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async refresh(): Promise<void> {
    try {
      const snap = await this.fetchFromTcmb();
      this.cached = snap;
      this.lastSuccess = snap;
      this.logger.log(
        `TCMB USD/TRY refreshed: ${snap.rate} (fetchedAt=${snap.fetchedAt.toISOString()})`,
      );
    } catch (err) {
      this.logger.warn(
        `TCMB refresh failed: ${(err as Error).message} — keeping last value`,
      );
    }
  }

  /**
   * USD → TRY kurunu döndür. Cache içindeyse cache'i, değilse fetch eder.
   * Fetch başarısız olursa lastSuccess'i (varsa) döner; yoksa null.
   */
  async getUsdToTry(): Promise<ExchangeRateSnapshot | null> {
    if (this.cached && this.isFresh(this.cached)) {
      return this.cached;
    }
    try {
      const snap = await this.fetchFromTcmb();
      this.cached = snap;
      this.lastSuccess = snap;
      return snap;
    } catch (err) {
      this.logger.warn(
        `getUsdToTry fetch failed: ${(err as Error).message} — returning lastSuccess`,
      );
      return this.lastSuccess;
    }
  }

  /** Cache'in valid olup olmadığını kontrol et (TTL check). */
  private isFresh(snap: ExchangeRateSnapshot): boolean {
    return Date.now() - snap.fetchedAt.getTime() < CACHE_TTL_MS;
  }

  /** Cache'i bypass etmeden snapshot var mı bakar — UI'a "cached" flag göstermek için. */
  hasFreshCache(): boolean {
    return this.cached !== null && this.isFresh(this.cached);
  }

  private async fetchFromTcmb(): Promise<ExchangeRateSnapshot> {
    const resp = await axios.get<string>(TCMB_FEED_URL, {
      timeout: FETCH_TIMEOUT_MS,
      responseType: 'text',
      maxContentLength: MAX_RESPONSE_BYTES,
      maxBodyLength: MAX_RESPONSE_BYTES,
      // Yanıtı text olarak al; default JSON parse devreye girmesin.
      transformResponse: [(d: unknown) => (typeof d === 'string' ? d : String(d))],
      headers: {
        Accept: 'application/xml, text/xml, */*',
        'User-Agent': 'TB-B2B-ExchangeRate/1.0',
      },
    });

    const xml = resp.data;
    if (!xml || typeof xml !== 'string') {
      throw new Error('TCMB feed returned empty body');
    }

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '',
      allowBooleanAttributes: true,
      trimValues: true,
    });
    const doc = parser.parse(xml) as TcmbDocument;

    const currencies = doc.Tarih_Date?.Currency;
    if (!currencies) {
      throw new Error('TCMB feed missing Currency nodes');
    }
    const list: TcmbCurrency[] = Array.isArray(currencies)
      ? currencies
      : [currencies];

    const usd = list.find(
      (c) => (c.CurrencyCode || '').toUpperCase() === 'USD',
    );
    if (!usd) {
      throw new Error('TCMB feed missing USD currency entry');
    }

    // Tercih sırası: ForexSelling (efektif satış) > BanknoteSelling.
    // Banka transferleri için ForexSelling daha yaygın referans.
    const raw = usd.ForexSelling ?? usd.BanknoteSelling;
    if (raw === undefined || raw === null || raw === '') {
      throw new Error('TCMB USD has no ForexSelling/BanknoteSelling');
    }
    const rate = typeof raw === 'number' ? raw : parseFloat(String(raw));
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error(`TCMB USD rate parse failed: ${raw}`);
    }

    return {
      rate: Math.round(rate * 10000) / 10000,
      source: 'TCMB',
      fetchedAt: new Date(),
    };
  }
}
