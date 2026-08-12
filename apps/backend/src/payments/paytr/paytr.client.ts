import { Injectable, Logger } from '@nestjs/common';
import axios, { isAxiosError } from 'axios';
import * as crypto from 'node:crypto';
import { SecretsService } from '../../secrets/secrets.service';
import { PAYTR_SECRET_KEYS, PAYTR_URLS } from './paytr.constants';

/**
 * PayTR HTTP istemcisi — paytr.md dökümanına BİREBİR uyumlu.
 *
 * Tüm istekler application/x-www-form-urlencoded POST'tur ve her servisin
 * kendi paytr_token (HMAC-SHA256, base64) formülü vardır:
 *
 *   get-token     : merchant_id + user_ip + merchant_oid + email +
 *                   payment_amount + user_basket + no_installment +
 *                   max_installment + currency + test_mode + merchant_salt
 *   callback hash : merchant_oid + merchant_salt + status + total_amount
 *   durum-sorgu   : merchant_id + merchant_oid + merchant_salt
 *   islem-dokumu  : merchant_id + start_date + end_date + merchant_salt
 *   odeme-dokumu  : merchant_id + start_date + end_date + merchant_salt
 *
 * HMAC anahtarı her zaman merchant_key'dir; çıktı base64'tür.
 * Kart verisi bu sisteme HİÇBİR ZAMAN girmez — kart formu PayTR iFrame'inde
 * açılır, kart saklama (varsa) yalnızca PayTR tarafındadır.
 */

export interface PaytrCredentials {
  merchantId: string;
  merchantKey: string;
  merchantSalt: string;
}

export interface PaytrGetTokenParams {
  userIp: string;
  merchantOid: string;
  email: string;
  /** Kuruş cinsinden tamsayı: 34.56 TL → 3456 */
  paymentAmount: number;
  /** [ürün adı, "birim fiyat", adet][] — base64(JSON) client içinde yapılır */
  basket: Array<[string, string, number]>;
  noInstallment: 0 | 1;
  maxInstallment: number;
  currency: string;
  testMode: 0 | 1;
  userName: string;
  userAddress: string;
  userPhone: string;
  okUrl: string;
  failUrl: string;
  timeoutLimitMinutes?: number;
  debugOn?: 0 | 1;
  lang?: 'tr' | 'en';
}

export interface PaytrTokenResult {
  ok: boolean;
  token?: string;
  reason?: string;
}

export interface PaytrApiResult {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

@Injectable()
export class PaytrClient {
  private readonly logger = new Logger(PaytrClient.name);

  constructor(private readonly secrets: SecretsService) {}

  async getCredentials(): Promise<PaytrCredentials | null> {
    const [merchantId, merchantKey, merchantSalt] = await Promise.all([
      this.secrets.get(PAYTR_SECRET_KEYS.merchantId),
      this.secrets.get(PAYTR_SECRET_KEYS.merchantKey),
      this.secrets.get(PAYTR_SECRET_KEYS.merchantSalt),
    ]);
    if (!merchantId || !merchantKey || !merchantSalt) return null;
    return { merchantId, merchantKey, merchantSalt };
  }

  /** base64(HMAC-SHA256(data, key=merchant_key)) — dökümandaki ortak formül. */
  private hmac(creds: PaytrCredentials, data: string): string {
    return crypto
      .createHmac('sha256', creds.merchantKey)
      .update(data)
      .digest('base64');
  }

  /**
   * iFrame API 1. Adım — iframe_token alır.
   * POST https://www.paytr.com/odeme/api/get-token
   */
  async getIframeToken(
    creds: PaytrCredentials,
    p: PaytrGetTokenParams,
  ): Promise<PaytrTokenResult> {
    const paymentAmount = String(p.paymentAmount);
    const userBasket = Buffer.from(JSON.stringify(p.basket), 'utf8').toString(
      'base64',
    );
    const noInstallment = String(p.noInstallment);
    const maxInstallment = String(p.maxInstallment);
    const testMode = String(p.testMode);

    // Dökümandaki sıra ile: merchant_id + user_ip + merchant_oid + email +
    // payment_amount + user_basket + no_installment + max_installment +
    // currency + test_mode; ardından + merchant_salt, HMAC key = merchant_key.
    const hashStr =
      creds.merchantId +
      p.userIp +
      p.merchantOid +
      p.email +
      paymentAmount +
      userBasket +
      noInstallment +
      maxInstallment +
      p.currency +
      testMode;
    const paytrToken = this.hmac(creds, hashStr + creds.merchantSalt);

    const form = new URLSearchParams();
    form.set('merchant_id', creds.merchantId);
    form.set('user_ip', p.userIp);
    form.set('merchant_oid', p.merchantOid);
    form.set('email', p.email);
    form.set('payment_amount', paymentAmount);
    form.set('paytr_token', paytrToken);
    form.set('user_basket', userBasket);
    form.set('debug_on', String(p.debugOn ?? 0));
    form.set('no_installment', noInstallment);
    form.set('max_installment', maxInstallment);
    form.set('user_name', p.userName);
    form.set('user_address', p.userAddress);
    form.set('user_phone', p.userPhone);
    form.set('merchant_ok_url', p.okUrl);
    form.set('merchant_fail_url', p.failUrl);
    form.set('timeout_limit', String(p.timeoutLimitMinutes ?? 30));
    form.set('currency', p.currency);
    form.set('test_mode', testMode);
    if (p.lang) form.set('lang', p.lang);

    const result = await this.postForm(PAYTR_URLS.getToken, form, 20_000);
    if (!result.ok || !result.data) {
      return { ok: false, reason: result.error ?? 'PayTR bağlantı hatası' };
    }
    if (result.data.status === 'success' && typeof result.data.token === 'string') {
      return { ok: true, token: result.data.token };
    }
    return {
      ok: false,
      reason:
        typeof result.data.reason === 'string'
          ? result.data.reason
          : 'PayTR token alınamadı',
    };
  }

  /**
   * iFrame API 2. Adım — Bildirim URL hash doğrulaması.
   * hash = base64(HMAC-SHA256(merchant_oid + merchant_salt + status + total_amount, merchant_key))
   * Karşılaştırma timing-safe yapılır; bu kontrol atlanırsa maddi kayıp olasıdır (doc uyarısı).
   */
  verifyCallbackHash(
    creds: PaytrCredentials,
    post: { merchant_oid: string; status: string; total_amount: string; hash: string },
  ): boolean {
    const expected = this.hmac(
      creds,
      post.merchant_oid + creds.merchantSalt + post.status + post.total_amount,
    );
    const a = Buffer.from(expected);
    const b = Buffer.from(post.hash ?? '');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  /**
   * Durum Sorgu — POST https://www.paytr.com/odeme/durum-sorgu
   * paytr_token = base64(HMAC(merchant_id + merchant_oid + merchant_salt))
   */
  async statusQuery(
    creds: PaytrCredentials,
    merchantOid: string,
  ): Promise<PaytrApiResult> {
    const paytrToken = this.hmac(
      creds,
      creds.merchantId + merchantOid + creds.merchantSalt,
    );
    const form = new URLSearchParams();
    form.set('merchant_id', creds.merchantId);
    form.set('merchant_oid', merchantOid);
    form.set('paytr_token', paytrToken);
    return this.postForm(PAYTR_URLS.statusQuery, form, 30_000);
  }

  /**
   * Satış ve İade İşlem Dökümü — POST https://www.paytr.com/rapor/islem-dokumu
   * Tarih formatı: YYYY-MM-DD hh:mm:ss · en fazla 3 günlük aralık.
   * paytr_token = base64(HMAC(merchant_id + start_date + end_date + merchant_salt))
   */
  async transactionReport(
    creds: PaytrCredentials,
    startDate: string,
    endDate: string,
  ): Promise<PaytrApiResult> {
    const paytrToken = this.hmac(
      creds,
      creds.merchantId + startDate + endDate + creds.merchantSalt,
    );
    const form = new URLSearchParams();
    form.set('merchant_id', creds.merchantId);
    form.set('start_date', startDate);
    form.set('end_date', endDate);
    form.set('paytr_token', paytrToken);
    return this.postForm(PAYTR_URLS.transactionReport, form, 90_000);
  }

  /**
   * Ödeme Rapor Servisi (hesaba aktarılan/aktarılacak tutarlar — valör takibi).
   * POST https://www.paytr.com/rapor/odeme-dokumu — tarih formatı YYYY-MM-DD,
   * en fazla 31 günlük aralık. Token formülü işlem dökümü ile aynıdır.
   */
  async paymentReport(
    creds: PaytrCredentials,
    startDate: string,
    endDate: string,
  ): Promise<PaytrApiResult> {
    const paytrToken = this.hmac(
      creds,
      creds.merchantId + startDate + endDate + creds.merchantSalt,
    );
    const form = new URLSearchParams();
    form.set('merchant_id', creds.merchantId);
    form.set('start_date', startDate);
    form.set('end_date', endDate);
    form.set('paytr_token', paytrToken);
    return this.postForm(PAYTR_URLS.paymentReport, form, 90_000);
  }

  private async postForm(
    url: string,
    form: URLSearchParams,
    timeoutMs: number,
  ): Promise<PaytrApiResult> {
    try {
      const resp = await axios.post<unknown>(url, form.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: timeoutMs,
        validateStatus: () => true,
      });
      const body = resp.data;
      if (body && typeof body === 'object') {
        return { ok: true, data: body as Record<string, unknown> };
      }
      // PayTR bazı hata durumlarında düz metin dönebilir
      this.logger.warn(
        `PayTR non-JSON response from ${url}: ${String(body).slice(0, 200)}`,
      );
      return { ok: false, error: String(body).slice(0, 200) };
    } catch (error: unknown) {
      const msg = isAxiosError(error)
        ? error.message
        : error instanceof Error
          ? error.message
          : 'unknown transport error';
      this.logger.error(`PayTR request failed (${url}): ${msg}`);
      return { ok: false, error: msg };
    }
  }
}
