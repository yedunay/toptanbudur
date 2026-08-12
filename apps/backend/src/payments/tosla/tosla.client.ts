import { Injectable, Logger } from '@nestjs/common';
import axios, { isAxiosError } from 'axios';
import * as crypto from 'node:crypto';
import { SecretsService } from '../../secrets/secrets.service';
import { TOSLA_SECRET_KEYS } from './tosla.constants';

/**
 * TOSLA İşim (AKÖDE) HTTP istemcisi — tosla.md dökümanına BİREBİR uyumlu.
 *
 * Tüm istekler application/json POST'tur. Her istekte ortak zorunlu alanlar:
 *   clientId, apiUser, rnd (≤24), timeSpan (yyyyMMddHHmmss, GMT+3), hash.
 *
 * İstek hash'i (tüm servislerde aynı):
 *   base64( SHA512( apiPass + clientId + apiUser + rnd + timeSpan ) )
 *
 * Callback hash doğrulaması:
 *   base64( SHA512( apiPass + HashParameters ) ) == Hash
 *   (HashParameters TOSLA'nın callback'te döndürdüğü birleştirilmiş string'tir.)
 *
 * Kart verisi bu sisteme HİÇ girmez — kart formu TOSLA ortak ödeme sayfasında
 * (threeDSecure iframe) açılır.
 */

export interface ToslaCredentials {
  clientId: string;
  apiUser: string;
  apiPass: string;
}

export interface ToslaThreeDPaymentParams {
  /** Bizim merchant referansımız (PaymentTransaction.merchantOid). */
  orderId: string;
  /** TOSLA'nın 3D sonucunu POST edeceği bizim callback endpoint'imiz. */
  callbackUrl: string;
  /** Kuruş cinsinden tamsayı: 34.56 TL → 3456 */
  amount: number;
  currency: number;
  installmentCount: number;
  description?: string;
}

export interface ToslaThreeDResult {
  ok: boolean;
  threeDSessionId?: string;
  transactionId?: string;
  code?: number;
  reason?: string;
}

export interface ToslaApiResult {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

/** TOSLA callback'inde dönen alanlar (PascalCase; biz esnek okuruz). */
export interface ToslaCallbackPost {
  Code?: string | number;
  Message?: string;
  OrderId?: string;
  BankResponseCode?: string;
  BankResponseMessage?: string;
  AuthCode?: string;
  HostReferenceNumber?: string;
  TransactionId?: string;
  CardHolderName?: string;
  RequestStatus?: string | number;
  MdStatus?: string | number;
  Hash?: string;
  HashParameters?: string;
  // Olası camelCase varyantları da kabul (TOSLA sürümleri arası fark).
  [key: string]: unknown;
}

@Injectable()
export class ToslaClient {
  private readonly logger = new Logger(ToslaClient.name);

  constructor(private readonly secrets: SecretsService) {}

  async getCredentials(): Promise<ToslaCredentials | null> {
    const [clientId, apiUser, apiPass] = await Promise.all([
      this.secrets.get(TOSLA_SECRET_KEYS.clientId),
      this.secrets.get(TOSLA_SECRET_KEYS.apiUser),
      this.secrets.get(TOSLA_SECRET_KEYS.apiPass),
    ]);
    if (!clientId || !apiUser || !apiPass) return null;
    return {
      clientId: clientId.trim(),
      apiUser: apiUser.trim(),
      apiPass: apiPass.trim(),
    };
  }

  /** İşlem random'ı — ≤24 karakter (doc limiti). */
  private randomString(): string {
    return crypto.randomBytes(10).toString('hex'); // 20 char
  }

  /** GMT+3 (Europe/Istanbul) yyyyMMddHHmmss. */
  private timeSpan(): string {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Istanbul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(new Date());
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
    // en-GB 24h: saat "24" yerine "00" döndürebilir; normalize et.
    const hour = get('hour') === '24' ? '00' : get('hour');
    return `${get('year')}${get('month')}${get('day')}${hour}${get('minute')}${get('second')}`;
  }

  /** base64(SHA512(apiPass + clientId + apiUser + rnd + timeSpan)) */
  private requestHash(
    creds: ToslaCredentials,
    rnd: string,
    timeSpan: string,
  ): string {
    const data = creds.apiPass + creds.clientId + creds.apiUser + rnd + timeSpan;
    return crypto.createHash('sha512').update(data, 'utf8').digest('base64');
  }

  /**
   * clientId'yi body'ye sayısal koyarken hassasiyeti koru. Spec clientId'yi
   * long/19 hane tanımlar; JS Number 16 haneden uzun tamsayıda sessizce
   * hassasiyet kaybeder. Hash STRING clientId ile üretildiği için body'deki
   * sayı kayarsa body↔hash tutarsızlaşır ve HER istek hash hatasıyla reddedilir.
   * Bu sessiz para-kesintisi yerine açıkça hata veriyoruz (mevcut/test clientId
   * 1000000494 güvenli aralıkta — pratikte tetiklenmez).
   */
  private clientIdNumber(creds: ToslaCredentials): number {
    const n = Number(creds.clientId);
    if (!Number.isSafeInteger(n)) {
      throw new Error(
        `TOSLA clientId güvenli tamsayı aralığını aşıyor (${creds.clientId}) — string body desteği gerekir`,
      );
    }
    return n;
  }

  /** Ortak istek zarfı (clientId/apiUser/rnd/timeSpan/hash). */
  private envelope(creds: ToslaCredentials): {
    clientId: number;
    apiUser: string;
    rnd: string;
    timeSpan: string;
    hash: string;
  } {
    const rnd = this.randomString();
    const timeSpan = this.timeSpan();
    return {
      clientId: this.clientIdNumber(creds),
      apiUser: creds.apiUser,
      rnd,
      timeSpan,
      hash: this.requestHash(creds, rnd, timeSpan),
    };
  }

  /** Büyük/küçük harf duyarsız okunan değeri güvenli string'e çevir. */
  private str(v: unknown): string {
    return v == null ? '' : String(v);
  }

  /** Yanıttan büyük/küçük harf duyarsız alan okuma (Code/code, ThreeDSessionId/threeDSessionId). */
  private pick(data: Record<string, unknown>, ...keys: string[]): unknown {
    for (const k of keys) {
      if (data[k] !== undefined) return data[k];
      const lower = k.charAt(0).toLowerCase() + k.slice(1);
      if (data[lower] !== undefined) return data[lower];
      const upper = k.charAt(0).toUpperCase() + k.slice(1);
      if (data[upper] !== undefined) return data[upper];
    }
    return undefined;
  }

  /**
   * threeDPayment — 3D session açar, ThreeDSessionId döner.
   * Ortak ödeme sayfası iframe'i bu session ile gösterilir.
   */
  async threeDPayment(
    creds: ToslaCredentials,
    baseUrl: string,
    p: ToslaThreeDPaymentParams,
  ): Promise<ToslaThreeDResult> {
    const body = {
      ...this.envelope(creds),
      callbackUrl: p.callbackUrl,
      orderId: p.orderId,
      amount: p.amount,
      currency: p.currency,
      installmentCount: p.installmentCount,
      ...(p.description ? { description: p.description.slice(0, 256) } : {}),
    };
    const result = await this.postJson(`${baseUrl}threeDPayment`, body, 20_000);
    if (!result.ok || !result.data) {
      return { ok: false, reason: result.error ?? 'TOSLA bağlantı hatası' };
    }
    const code = Number(this.pick(result.data, 'Code'));
    const sessionId = this.pick(result.data, 'ThreeDSessionId');
    const txId = this.pick(result.data, 'TransactionId');
    if (code === 0 && typeof sessionId === 'string' && sessionId.length > 0) {
      return {
        ok: true,
        threeDSessionId: sessionId,
        transactionId: txId != null ? String(txId) : undefined,
        code,
      };
    }
    const msg = this.pick(result.data, 'Message');
    return {
      ok: false,
      code: Number.isFinite(code) ? code : undefined,
      reason: typeof msg === 'string' ? msg : 'TOSLA threeDPayment başarısız',
    };
  }

  /**
   * Callback hash doğrulaması. tosla.md iki YORUMA da açık (callback POST
   * tablosunda Hash/HashParameters listelenmemiş, ama hash-doğrulama bölümü
   * ikisini de ima ediyor). Maddi güvenlik kritik olduğundan, dökümante edilen
   * HER İKİ yorumu da deniyoruz; biri sabit-zamanda eşleşirse kabul:
   *
   *  (1) TOSLA hazır birleşik 'HashParameters' alanı gönderiyorsa:
   *      base64(SHA512(apiPass + HashParameters)) == Hash
   *  (2) Göndermiyorsa, .Net örneğindeki alan sırasıyla biz birleştiririz:
   *      base64(SHA512(apiPass + ClientId + ApiUser + OrderId + MdStatus +
   *      BankResponseCode + BankResponseMessage + RequestStatus)) == Hash
   *
   * GÜVENLİK: her iki yorum da gizli apiPass'i gerektirir → apiPass'i bilmeyen
   * saldırgan hiçbir yorumda geçerli hash üretemez; iki yorumu denemek güvenliği
   * ZAYIFLATMAZ. Hiçbiri tutmazsa ONAY YOK + kalibrasyon için ayrıntılı log
   * (gelen alan adları + her adayın beklenen hash başı; apiPass loglanmaz).
   * Kesin alan sırası TOSLA test ortamına karşı bu logla kalibre edilir.
   */
  verifyCallbackHash(creds: ToslaCredentials, post: ToslaCallbackPost): boolean {
    const data = post as Record<string, unknown>;
    const orderId = this.str(this.pick(data, 'OrderId'));
    const receivedHash = this.str(this.pick(data, 'Hash'));
    if (!receivedHash) {
      this.logger.error(
        `TOSLA callback hash doğrulanamadı — Hash alanı boş (orderId=${orderId || '-'}, ` +
          `gelen alanlar: ${Object.keys(data).join(',')})`,
      );
      return false;
    }

    const candidates: Array<{ label: string; input: string }> = [];
    const hashParameters = this.str(this.pick(data, 'HashParameters'));
    if (hashParameters) {
      candidates.push({ label: 'HashParameters', input: hashParameters });
    }
    // (2) Alan-birleştirme yorumu (.Net örneği sırası).
    candidates.push({
      label: 'fieldConcat',
      input:
        creds.clientId +
        creds.apiUser +
        orderId +
        this.str(this.pick(data, 'MdStatus')) +
        this.str(this.pick(data, 'BankResponseCode')) +
        this.str(this.pick(data, 'BankResponseMessage')) +
        this.str(this.pick(data, 'RequestStatus')),
    });

    const received = Buffer.from(receivedHash);
    const expectedOf = (input: string): string =>
      crypto.createHash('sha512').update(creds.apiPass + input, 'utf8').digest('base64');

    for (const c of candidates) {
      const exp = Buffer.from(expectedOf(c.input));
      if (exp.length === received.length && crypto.timingSafeEqual(exp, received)) {
        return true;
      }
    }

    // Hiçbir yorum tutmadı → reddet + kalibrasyon logu.
    this.logger.error(
      `TOSLA callback BAD HASH (orderId=${orderId || '-'}): gelen=${receivedHash.slice(0, 16)}… ` +
        candidates
          .map(
            (c) =>
              `[${c.label}] beklenen=${expectedOf(c.input).slice(0, 16)}… girdi="${c.input.slice(0, 100)}"`,
          )
          .join(' ') +
        ` | gelen alanlar: ${Object.keys(data).join(',')}`,
    );
    return false;
  }

  /** Ödeme Sorgulama (inquiry) — orderId ile işlem detayı. */
  async inquiry(
    creds: ToslaCredentials,
    baseUrl: string,
    orderId: string,
  ): Promise<ToslaApiResult> {
    return this.postJson(
      `${baseUrl}inquiry`,
      { ...this.envelope(creds), orderId },
      30_000,
    );
  }

  /** İptal (void) — gün sonu öncesi. */
  async voidPayment(
    creds: ToslaCredentials,
    baseUrl: string,
    orderId: string,
  ): Promise<ToslaApiResult> {
    return this.postJson(
      `${baseUrl}void`,
      { ...this.envelope(creds), orderId },
      30_000,
    );
  }

  /** İade (refund) — gün sonu sonrası, kuruş cinsinden tutar (kısmi/tam). */
  async refund(
    creds: ToslaCredentials,
    baseUrl: string,
    orderId: string,
    amountKurus: number,
  ): Promise<ToslaApiResult> {
    return this.postJson(
      `${baseUrl}refund`,
      { ...this.envelope(creds), orderId, amount: amountKurus },
      30_000,
    );
  }

  private async postJson(
    url: string,
    body: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<ToslaApiResult> {
    try {
      const resp = await axios.post<unknown>(url, body, {
        headers: { 'Content-Type': 'application/json' },
        timeout: timeoutMs,
        validateStatus: () => true,
      });
      const data = resp.data;
      if (data && typeof data === 'object') {
        return { ok: true, data: data as Record<string, unknown> };
      }
      this.logger.warn(
        `TOSLA non-JSON response from ${url}: ${String(data).slice(0, 200)}`,
      );
      return { ok: false, error: String(data).slice(0, 200) };
    } catch (error: unknown) {
      const msg = isAxiosError(error)
        ? error.message
        : error instanceof Error
          ? error.message
          : 'unknown transport error';
      this.logger.error(`TOSLA request failed (${url}): ${msg}`);
      return { ok: false, error: msg };
    }
  }
}
