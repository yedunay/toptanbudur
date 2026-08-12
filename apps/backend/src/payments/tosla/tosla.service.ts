import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { OrdersService } from '../../orders/orders.service';
import { CariBalanceService } from '../../cari-balance/cari-balance.service';
import { ToslaClient, type ToslaCallbackPost } from './tosla.client';
import {
  TOSLA_CURRENCY_TRY,
  TOSLA_PROVIDER_KEY,
  toslaBaseUrl,
} from './tosla.constants';

/**
 * TOSLA İşim (AKÖDE) ortak ödeme sayfası orkestrasyonu — PayTR akışının
 * birebir karşılığı (paytr.service.ts), TOSLA API'sine uyarlanmış.
 *
 * Akış:
 *   1. Müşteri kart seçer → sipariş awaiting_payment (OrdersService.create).
 *   2. Frontend kart sayfası generic /payments/card/token ister → aktif sağlayıcı
 *      TOSLA ise burası çalışır: PaymentTransaction (initiated) açılır, TOSLA
 *      threeDPayment çağrılır, ThreeDSessionId döner.
 *   3. Frontend ortak ödeme sayfasını iframe'de gösterir
 *      ({base}threeDSecure/{ThreeDSessionId}). Kart verisi bize HİÇ gelmez.
 *   4. 3D tamamlanınca TOSLA sonucu CallbackUrl'imize POST eder (tarayıcı,
 *      iframe içinde). handleCallback: hash doğrula, merchant_oid ile işlemi bul,
 *      idempotent şekilde onayla (BankResponseCode='00') → iframe'den çıkıp
 *      sonuç sayfasına yönlendiren HTML döner.
 *
 * İADE KURALI (işletme kararı, PayTR ile aynı): karta iade YAPILMAZ; her
 * iptal/iade tutarı cari bakiyeye eklenir (admin-orders.service.ts iptal yolu).
 */
@Injectable()
export class ToslaService {
  private readonly logger = new Logger(ToslaService.name);
  /** reconcile cron'unun kendi kendine üst üste binmesini önleyen bayrak. */
  private reconciling = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: ToslaClient,
    private readonly orders: OrdersService,
    private readonly cariBalance: CariBalanceService,
    private readonly config: ConfigService,
  ) {}

  private storefrontBase(): string {
    return (
      this.config.get<string>('STOREFRONT_URL') ?? 'http://localhost:3001'
    ).replace(/\/+$/, '');
  }

  /** TOSLA'nın 3D sonucunu POST edeceği bizim public callback URL'imiz. */
  private callbackUrl(): string {
    const explicit = this.config.get<string>('PUBLIC_API_URL');
    const base = explicit
      ? explicit.replace(/\/+$/, '')
      : (() => {
          // STOREFRONT_URL origin'i + /api (prod nginx /api → backend).
          try {
            const u = new URL(this.storefrontBase());
            return `${u.protocol}//${u.host}/api`;
          } catch {
            return 'https://toptanbudur.com/api';
          }
        })();
    return `${base}/payments/tosla/callback`;
  }

  /** merchant_oid: alfanumerik, TOSLA orderId ≤20 → slice güvenliği. */
  private buildOid(prefix: string, core: string, attempt: number): string {
    const tail = `T${attempt}`;
    const room = 20 - prefix.length - tail.length;
    const safeCore = core.replace(/[^a-zA-Z0-9]/g, '').slice(0, Math.max(0, room));
    return `${prefix}${safeCore}${tail}`;
  }

  /**
   * PaymentTransaction (initiated) yazar; merchantOid'i benzersiz üretir.
   * İki eşzamanlı istek (çift tık / iki sekme) aynı attemptCount'u okuyup aynı
   * oid üretirse merchantOid @unique ihlali (P2002) olur — sayacı kaydırıp
   * tekrar dener. HAPPY-PATH TEK denemede biter; mevcut davranış DEĞİŞMEZ.
   * En çok 4 deneme; hepsi çakışırsa hata fırlatır (TOSLA'ya hiç gidilmeden).
   */
  private async persistInitiatedTx(
    countWhere: Prisma.PaymentTransactionWhereInput,
    buildOid: (n: number) => string,
    data: Omit<Prisma.PaymentTransactionUncheckedCreateInput, 'merchantOid' | 'status'>,
  ): Promise<string> {
    for (let attempt = 0; ; attempt++) {
      const count = await this.prisma.paymentTransaction.count({ where: countWhere });
      const merchantOid = buildOid(count + 1 + attempt);
      try {
        await this.prisma.paymentTransaction.create({
          data: { ...data, merchantOid, status: 'initiated' },
        });
        return merchantOid;
      } catch (err) {
        if (
          attempt < 3 &&
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          continue;
        }
        throw err;
      }
    }
  }

  /**
   * ADMIN TEST ÇEKİMİ — müşterinin gördüğü ortak ödeme sayfasının AYNISINI
   * (threeDSecure iframe) üretir, ama gerçek sipariş/müşteri akışına HİÇ
   * dokunmadan: ne Order ne PaymentTransaction yaratılır. Test merchantOid
   * callback'te BULUNAMAZ → hiçbir sipariş onaylanmaz, POS istatistikleri
   * kirlenmez (handleCallback fallbackUrl'e döner). Kart verisi yine TOSLA
   * ortak sayfasında girilir, bize HİÇ gelmez. testMode sağlayıcının kendi
   * testMode'udur (CANLI iken gerçek ~tutar çekimi; UI uyarır).
   */
  async createTestCardSession(params: { amountTl: number }) {
    const provider = await this.prisma.posProvider.findUnique({
      where: { key: TOSLA_PROVIDER_KEY },
    });
    if (!provider) throw new NotFoundException('TOSLA sağlayıcı tanımlı değil');
    const creds = await this.client.getCredentials();
    if (!creds) {
      throw new ServiceUnavailableException(
        'TOSLA API bilgileri eksik — önce kredensiyalleri girin.',
      );
    }
    const amount = Math.min(1000, Math.max(1, Math.round(params.amountTl * 100) / 100));
    const merchantOid = `TEST${Date.now()}`.slice(0, 20);
    const result = await this.client.threeDPayment(
      creds,
      toslaBaseUrl(provider.testMode),
      {
        orderId: merchantOid,
        callbackUrl: this.callbackUrl(),
        amount: Math.round(amount * 100),
        currency: TOSLA_CURRENCY_TRY,
        installmentCount: 0,
        description: 'POS Test Çekimi',
      },
    );
    if (!result.ok || !result.threeDSessionId) {
      throw new ServiceUnavailableException(
        result.reason ?? 'TOSLA test oturumu açılamadı',
      );
    }
    return {
      provider: TOSLA_PROVIDER_KEY,
      iframeUrl: `${toslaBaseUrl(provider.testMode)}threeDSecure/${result.threeDSessionId}`,
      merchantOid,
      amount,
      testMode: provider.testMode,
    };
  }

  /**
   * Sipariş kart ödemesi için 3D session açar. Auth: girişli müşteri sipariş
   * sahibi olmalı; misafir akışında sipariş makbuz token'ı (receiptToken).
   * Dönüş PayTR ile aynı şekildedir (+ provider:'tosla').
   */
  async createOrderCardSession(params: {
    orderId: string;
    receiptToken?: string;
    customerId?: string;
    userIp?: string;
  }) {
    const order = await this.prisma.order.findUnique({
      where: { id: params.orderId },
      select: {
        id: true,
        customerId: true,
        paymentType: true,
        status: true,
        paidAt: true,
        humanOrderNo: true,
        total: true,
        cardCommissionAmount: true,
        tenantId: true,
      },
    });
    if (!order) throw new NotFoundException('Sipariş bulunamadı');

    const ownsByCustomer =
      !!params.customerId && order.customerId === params.customerId;
    const ownsByToken =
      !!params.receiptToken &&
      this.orders.verifyReceiptToken(order.id, params.receiptToken);
    if (!ownsByCustomer && !ownsByToken) {
      throw new ForbiddenException('Bu sipariş için yetkiniz yok');
    }
    if (order.paymentType !== 'card') {
      throw new BadRequestException('Bu sipariş kartlı ödeme siparişi değil');
    }
    if (order.status === 'paid' || order.paidAt) {
      throw new BadRequestException('Bu siparişin ödemesi zaten alınmış');
    }
    if (order.status !== 'awaiting_payment') {
      throw new BadRequestException(
        'Sipariş ödeme bekleyen durumda değil (iptal edilmiş olabilir)',
      );
    }

    const provider = await this.prisma.posProvider.findFirst({
      where: { active: true },
    });
    if (!provider || provider.key !== TOSLA_PROVIDER_KEY) {
      throw new ServiceUnavailableException(
        'Kartlı ödeme şu anda kullanılamıyor — lütfen daha sonra tekrar deneyin.',
      );
    }
    const creds = await this.client.getCredentials();
    if (!creds) {
      this.logger.error(
        'TOSLA API bilgileri eksik (tosla.clientId/apiUser/apiPass) — admin Secrets',
      );
      throw new ServiceUnavailableException(
        'Kartlı ödeme şu anda kullanılamıyor — lütfen daha sonra tekrar deneyin.',
      );
    }

    const commission = order.cardCommissionAmount
      ? new Prisma.Decimal(order.cardCommissionAmount)
      : new Prisma.Decimal(0);
    const chargedTotal = new Prisma.Decimal(order.total).add(commission);
    const totalNumber = Number(chargedTotal);
    const amountKurus = Math.round(totalNumber * 100);

    const merchantOid = await this.persistInitiatedTx(
      { orderId: order.id },
      (n) => this.buildOid('AB', order.humanOrderNo, n),
      {
        tenantId: order.tenantId,
        kind: 'order',
        orderId: order.id,
        providerKey: provider.key,
        amount: chargedTotal,
        currency: 'TL',
        testMode: provider.testMode,
      },
    );

    const result = await this.client.threeDPayment(creds, toslaBaseUrl(provider.testMode), {
      orderId: merchantOid,
      callbackUrl: this.callbackUrl(),
      amount: amountKurus,
      currency: TOSLA_CURRENCY_TRY,
      installmentCount: 0,
      description: `Sipariş #${order.humanOrderNo}`,
    });
    if (!result.ok || !result.threeDSessionId) {
      this.logger.error(
        `TOSLA threeDPayment failed (order=${order.humanOrderNo}): code=${result.code ?? '-'} ${result.reason}`,
      );
      throw new ServiceUnavailableException(
        'Ödeme sayfası başlatılamadı — lütfen tekrar deneyin.',
      );
    }

    return {
      success: true,
      data: {
        token: result.threeDSessionId,
        iframeUrl: `${toslaBaseUrl(provider.testMode)}threeDSecure/${result.threeDSessionId}`,
        merchantOid,
        orderId: order.id,
        humanOrderNo: order.humanOrderNo,
        amount: totalNumber,
        provider: TOSLA_PROVIDER_KEY,
      },
    };
  }

  /**
   * Kart ile cari yükleme için 3D session. Yalnızca girişli müşteri, kendi
   * PENDING 'card' topup'ı için. Çekilen tutar topup.chargedAmount.
   */
  async createTopupCardSession(params: {
    topupId: string;
    customerId: string;
    userIp?: string;
  }) {
    const topup = await this.prisma.cariTopup.findUnique({
      where: { id: params.topupId },
      select: {
        id: true,
        customerId: true,
        method: true,
        status: true,
        humanTopupNo: true,
        amount: true,
        chargedAmount: true,
        commissionAmount: true,
      },
    });
    if (!topup) throw new NotFoundException('Yükleme talebi bulunamadı');
    if (topup.customerId !== params.customerId) {
      throw new ForbiddenException('Bu yükleme talebi için yetkiniz yok');
    }
    if (topup.method !== 'card') {
      throw new BadRequestException('Bu talep kartlı yükleme talebi değil');
    }
    if (topup.status !== 'PENDING') {
      throw new BadRequestException('Bu yükleme talebi zaten sonuçlanmış');
    }

    const provider = await this.prisma.posProvider.findFirst({
      where: { active: true },
    });
    if (!provider || provider.key !== TOSLA_PROVIDER_KEY) {
      throw new ServiceUnavailableException(
        'Kart ile yükleme şu anda kullanılamıyor — lütfen daha sonra tekrar deneyin.',
      );
    }
    const creds = await this.client.getCredentials();
    if (!creds) {
      this.logger.error('TOSLA API bilgileri eksik (topup session isteği)');
      throw new ServiceUnavailableException(
        'Kart ile yükleme şu anda kullanılamıyor — lütfen daha sonra tekrar deneyin.',
      );
    }

    const oidBase = topup.humanTopupNo ?? topup.id;
    const charged = new Prisma.Decimal(topup.chargedAmount ?? topup.amount);
    const commission = new Prisma.Decimal(topup.commissionAmount ?? 0);
    const amountKurus = Math.round(Number(charged) * 100);
    const tenantId =
      (await this.prisma.tenant.findFirst({ select: { id: true } }))?.id ??
      'default';

    const merchantOid = await this.persistInitiatedTx(
      { topupId: topup.id },
      (n) => this.buildOid('CT', oidBase, n),
      {
        tenantId,
        kind: 'cari_topup',
        topupId: topup.id,
        providerKey: provider.key,
        amount: charged,
        currency: 'TL',
        testMode: provider.testMode,
      },
    );

    const result = await this.client.threeDPayment(creds, toslaBaseUrl(provider.testMode), {
      orderId: merchantOid,
      callbackUrl: this.callbackUrl(),
      amount: amountKurus,
      currency: TOSLA_CURRENCY_TRY,
      installmentCount: 0,
      description: `Cari yükleme #${topup.humanTopupNo ?? topup.id}`,
    });
    if (!result.ok || !result.threeDSessionId) {
      this.logger.error(
        `TOSLA topup threeDPayment failed (topup=${topup.humanTopupNo}): code=${result.code ?? '-'} ${result.reason}`,
      );
      throw new ServiceUnavailableException(
        'Ödeme sayfası başlatılamadı — lütfen tekrar deneyin.',
      );
    }

    return {
      success: true,
      data: {
        token: result.threeDSessionId,
        iframeUrl: `${toslaBaseUrl(provider.testMode)}threeDSecure/${result.threeDSessionId}`,
        merchantOid,
        topupId: topup.id,
        humanTopupNo: topup.humanTopupNo,
        amount: Number(topup.amount),
        commissionAmount: Number(commission),
        chargedAmount: Number(charged),
        provider: TOSLA_PROVIDER_KEY,
      },
    };
  }

  /**
   * Callback işleyici. TOSLA 3D sonucunu (tarayıcı, iframe içinde) CallbackUrl'e
   * POST eder. Hash doğrula → merchant_oid (= bizim gönderdiğimiz orderId) ile
   * işlemi bul → BankResponseCode='00' ise idempotent onayla. Tarayıcıyı
   * iframe'den çıkarıp yönlendireceğimiz sonuç sayfası URL'ini döner.
   */
  async handleCallback(
    post: ToslaCallbackPost,
  ): Promise<{ redirectUrl: string }> {
    const merchantOid = String(post.OrderId ?? post['orderId'] ?? '');
    const bankCode = String(post.BankResponseCode ?? post['bankResponseCode'] ?? '');
    const isBankApproved = bankCode === '00';

    const fallbackUrl = `${this.storefrontBase()}/`;

    const creds = await this.client.getCredentials();
    if (!creds) {
      this.logger.error('TOSLA callback geldi ama API bilgileri tanımlı değil');
      return { redirectUrl: fallbackUrl };
    }

    const hashOk = this.client.verifyCallbackHash(creds, post);

    const txRow = merchantOid
      ? await this.prisma.paymentTransaction.findUnique({
          where: { merchantOid },
          include: {
            order: { select: { id: true, status: true, humanOrderNo: true } },
            topup: { select: { id: true, status: true, humanTopupNo: true } },
          },
        })
      : null;

    // Sonuç sayfası URL'i (hash kötü olsa bile kullanıcıyı iframe'den çıkar).
    const resultUrl = (success: boolean): string => {
      if (txRow?.kind === 'cari_topup' && txRow.topupId) {
        return `${this.storefrontBase()}/hesabim/bakiyem/kart/${txRow.topupId}/sonuc?x=1${success ? '' : '&fail=1'}`;
      }
      if (txRow?.orderId) {
        const receipt = this.orders.signReceiptToken(txRow.orderId);
        return `${this.storefrontBase()}/sepet/odeme/sonuc/${txRow.orderId}?t=${encodeURIComponent(receipt)}${success ? '' : '&fail=1'}`;
      }
      return fallbackUrl;
    };

    if (!hashOk) {
      // Hash doğrulanamadı → ONAY YOK (maddi güvenlik). Kullanıcıyı sonuç
      // sayfasına fail ile gönder; mutabakat inquiry ile yapılır.
      this.logger.error(
        `TOSLA callback BAD HASH (orderId=${merchantOid}) — işlem onaylanmadı`,
      );
      return { redirectUrl: resultUrl(false) };
    }

    if (!txRow) {
      this.logger.error(
        `TOSLA callback: merchant_oid bulunamadı (${merchantOid}) — manuel kontrol gerekli`,
      );
      return { redirectUrl: fallbackUrl };
    }

    const refLabel =
      txRow.kind === 'cari_topup'
        ? `topup=#${txRow.topup?.humanTopupNo}`
        : `order=#${txRow.order?.humanOrderNo}`;

    // Tekrarlayan bildirim / öz-iyileşme (PayTR ile aynı desen).
    if (txRow.status !== 'initiated') {
      if (txRow.status === 'success') {
        try {
          if (
            txRow.kind === 'order' &&
            txRow.orderId &&
            txRow.order?.status === 'awaiting_payment'
          ) {
            await this.orders.confirmCardPayment({
              orderId: txRow.orderId,
              providerKey: txRow.providerKey,
            });
          } else if (
            txRow.kind === 'cari_topup' &&
            txRow.topupId &&
            txRow.topup?.status === 'PENDING'
          ) {
            await this.cariBalance.systemApproveCardTopup(txRow.topupId);
          }
        } catch (err) {
          this.logger.error(
            `TOSLA retry onayı başarısız (${refLabel}): ${(err as Error).message}`,
          );
        }
      }
      return { redirectUrl: resultUrl(txRow.status === 'success') };
    }

    await this.prisma.paymentTransaction.update({
      where: { merchantOid },
      data: {
        status: isBankApproved ? 'success' : 'failed',
        // Karttan ÇEKİLEN tutar. TOSLA callback'i tutar alanı döndürmediği için
        // (spec POST tablosunda amount yok) create'te yazdığımız amount'u
        // (=sipariş/topup + komisyon) totalAmount'a kopyalıyoruz. Bu alan
        // KRİTİK: iptal/iade akışı cariye geri yüklenecek tutarı
        // _sum(totalAmount)'tan hesaplar (admin-orders.service) ve admin POS
        // ciro istatistikleri bunu kullanır. Yazılmazsa iade=0 TL olur (para
        // kaybı) ve istatistikler 0 görünür. PayTR ile aynı semantik.
        totalAmount: isBankApproved ? txRow.amount : null,
        paymentType: 'card',
        currency: 'TL',
        failedReasonCode: isBankApproved ? null : bankCode || null,
        failedReasonMsg: isBankApproved
          ? null
          : String(post.BankResponseMessage ?? post.Message ?? '') || null,
        testMode: txRow.testMode,
        callbackAt: new Date(),
      },
    });

    if (isBankApproved) {
      try {
        if (txRow.kind === 'cari_topup' && txRow.topupId) {
          const approve = await this.cariBalance.systemApproveCardTopup(
            txRow.topupId,
          );
          if (!approve.approved && approve.reason !== undefined) {
            this.logger.error(
              `TOSLA FAZLA TAHSİLAT UYARISI (cari yükleme): başarılı ama onaylanamadı ` +
                `(${refLabel}, merchant_oid=${merchantOid}, sebep=${approve.reason}). Manuel kontrol gerekli!`,
            );
          }
        } else if (txRow.orderId) {
          const confirm = await this.orders.confirmCardPayment({
            orderId: txRow.orderId,
            providerKey: txRow.providerKey,
          });
          if (!confirm.confirmed && confirm.reason !== undefined) {
            this.logger.error(
              `TOSLA FAZLA TAHSİLAT UYARISI: başarılı callback ama sipariş onaylanamadı ` +
                `(${refLabel}, merchant_oid=${merchantOid}, sebep=${confirm.reason}). ` +
                `Tutar müşterinin CARİ bakiyesine eklenmeli!`,
            );
            // §orta — admine bildirim (geç/çift TOSLA tahsilatı). OTO cari iade
            // YOK; admin elle karar verir.
            void this.prisma.notification
              .create({
                data: {
                  role: 'ADMIN',
                  type: 'system',
                  severity: 'error',
                  title: 'Geç/çift kart tahsilatı (TOSLA) — önlem alın',
                  body:
                    `${refLabel} için başarılı TOSLA çekimi geldi ama sipariş ` +
                    `onaylanamadı (sebep: ${confirm.reason}). Karta iade YAPILMAZ; ` +
                    `tutar gerekirse müşterinin cari bakiyesine ELLE eklenmeli. ` +
                    `merchant_oid=${merchantOid}`,
                  link: txRow.orderId ? `/orders/${txRow.orderId}` : null,
                },
              })
              .catch(() => undefined);
          }
        }
      } catch (err) {
        this.logger.error(
          `TOSLA başarılı ama onay başarısız (${refLabel}): ${(err as Error).message}`,
        );
      }
    } else {
      this.logger.warn(
        `TOSLA ödeme başarısız (${refLabel}, bankCode=${bankCode}): ${String(post.BankResponseMessage ?? '')}`,
      );
    }

    // §orta — yalnız BAŞARILI işlemde: TOSLA'dan ÇEKİLEN gerçek tutarı sorgula
    // (callback tutar döndürmüyor). Fire-and-forget; callback akışını bloklamaz.
    if (isBankApproved) {
      void this.reconcileRealAmount(merchantOid, txRow).catch(() => undefined);
    }

    return { redirectUrl: resultUrl(isBankApproved) };
  }

  /**
   * §orta — TOSLA GERÇEK-TUTAR MUTABAKATI (fire-and-forget). TOSLA başarı
   * callback'i çekilen tutarı döndürmediği için inquiry (Durum Sorgu) ile
   * gerçek tutarı çeker; beklenenden (kuruş/TL normalize edilerek) FARKLI ise
   * admine UYARI bildirimi atar. totalAmount KÖR EZİLMEZ (yanlış parse riskine
   * karşı) — yalnız bildirim; admin iade/mutabakat öncesi kontrol eder. Hata
   * olursa sessiz (callback'i asla bozmaz). PayTR'de bu sorun yok (gerçek tutar
   * callback'te gelir).
   */
  private async reconcileRealAmount(
    merchantOid: string,
    txRow: { amount: unknown; testMode: boolean | null; orderId: string | null },
  ): Promise<void> {
    try {
      const creds = await this.client.getCredentials();
      if (!creds) return;
      const result = await this.client.inquiry(
        creds,
        toslaBaseUrl(txRow.testMode ?? true),
        merchantOid,
      );
      if (!result.ok || !result.data) return;
      const d = result.data as Record<string, unknown>;
      const raw =
        d.Amount ?? d.amount ?? d.TransactionAmount ?? d.transactionAmount;
      let real = Number(raw);
      if (!Number.isFinite(real) || real <= 0) return;
      const expected = Number(txRow.amount);
      if (!Number.isFinite(expected) || expected <= 0) return;
      // Kuruş→TL: tam sayı ve /100'ü beklenene daha yakınsa kuruş kabul et.
      if (
        Number.isInteger(real) &&
        Math.abs(real / 100 - expected) < Math.abs(real - expected)
      ) {
        real = real / 100;
      }
      if (Math.abs(real - expected) <= 0.01) return; // uyumlu → no-op
      await this.prisma.notification.create({
        data: {
          role: 'ADMIN',
          type: 'system',
          severity: 'warning',
          title: 'TOSLA tutar uyuşmazlığı — mutabakat kontrol',
          body:
            `TOSLA işlemi ${merchantOid}: beklenen ₺${expected.toFixed(2)}, ` +
            `çekilen ₺${real.toFixed(2)} (taksit vade farkı olabilir). ` +
            `totalAmount değiştirilmedi; iade/mutabakat öncesi kontrol edin.`,
          link: txRow.orderId ? `/orders/${txRow.orderId}` : '/cari',
        },
      });
    } catch {
      /* sessiz: callback akışını asla bozma */
    }
  }

  /**
   * §KRİTİK — SESSİZ TAHSİLAT MUTABAKATI (callback gelmeyen çekimleri yakalar).
   *
   * TOSLA 3D sonucunu tarayıcı (iframe içinde) callback URL'imize POST eder.
   * Banka kartı çektiği HÂLDE bu POST bize hiç ulaşmazsa (müşteri sekmeyi
   * kapatır, bağlantı kopar) PaymentTransaction 'initiated'ta kalır → sipariş
   * ödenmemiş görünür, para SESSİZCE çekilmiş olur ve stale-sweep siparişi
   * iptal eder. Admin bunu ancak TOSLA panelini elle kıyaslayınca fark eder.
   *
   * Bu cron, 'initiated'ta takılı TOSLA işlemlerini TOSLA'nın kendi inquiry
   * (Durum Sorgu) servisiyle kontrol eder; banka gerçekten çekmişse
   * (BankResponseCode='00', RequestStatus=1, iade/void EDİLMEMİŞ) ve ÇEKİLEN
   * TUTAR beklenenle (±1 kuruş) uyuşuyorsa siparişi/işlemi OTOMATİK TAMAMLAR —
   * kaybolan onay callback'ini telafi eder (KULLANICI KARARI 2026-07-30).
   *
   * OTO-TAMAMLAMA = callback başarı yolunun (handleCallback) BİREBİR YANSIMASI:
   * tx→success (+totalAmount) + kind'e göre confirmCardPayment /
   * systemApproveCardTopup / recordCardPayment. Güvenli çünkü onay TOSLA'nın
   * kendi API'sinden gelir (tahmin değil). İdempotent: settle tx'i 'success'
   * yapar → sonraki turlar (status='initiated' filtresi) görmez; confirmCardPayment
   * de paid/cancelled durumunu korur (çift-settle yok).
   *
   * OTO-TAMAMLAMA YAPILMAYAN HALLER (admin'e UYARI, karta iade YOK):
   *  - Çekilen tutar beklenenden farklı → elle kontrol.
   *  - Settle başarısız (ör. sipariş iptal edilmiş) → tutar gerekirse cariye elle.
   */
  @Cron('0 */15 * * * *', { name: 'tosla-initiated-capture-reconcile' })
  async reconcileInitiatedToslaCaptures(): Promise<void> {
    if (this.reconciling) return;
    this.reconciling = true;
    try {
      const creds = await this.client.getCredentials();
      if (!creds) return;

      const now = Date.now();
      // Aktif müşteriyle yarışmamak için ≥20 dk yaşındaki denemeler; eskiyi
      // sonsuz sorgulamamak için ≤24 saat penceresi.
      const candidates = await this.prisma.paymentTransaction.findMany({
        where: {
          providerKey: TOSLA_PROVIDER_KEY,
          status: 'initiated',
          createdAt: {
            gte: new Date(now - 24 * 3_600_000),
            lte: new Date(now - 20 * 60_000),
          },
        },
        orderBy: { createdAt: 'asc' },
        take: 25,
        select: {
          merchantOid: true,
          kind: true,
          amount: true,
          testMode: true,
          orderId: true,
          topupId: true,
          customerId: true,
          order: { select: { humanOrderNo: true, customerName: true, status: true } },
          topup: {
            select: {
              humanTopupNo: true,
              customer: { select: { name: true } },
            },
          },
        },
      });
      if (candidates.length === 0) return;

      for (const tx of candidates) {
        try {
          // İdempotency STATÜ-tabanlı: settle tx'i 'success' yapar → sonraki
          // turlar (status='initiated' filtresi) bu tx'i HİÇ görmez. Eski
          // "already notified → atla" KALDIRILDI (yoksa eski davranışta uyarısı
          // gitmiş takılı siparişler oto-tamamlanamazdı).
          const result = await this.client.inquiry(
            creds,
            toslaBaseUrl(tx.testMode ?? true),
            tx.merchantOid,
          );
          if (!result.ok || !result.data) continue;

          const d = result.data as Record<string, unknown>;
          const read = (k: string): unknown =>
            d[k] ?? d[k.charAt(0).toLowerCase() + k.slice(1)];
          const bankCode = String(read('BankResponseCode') ?? '');
          const reqStatus = Number(read('RequestStatus'));
          const amountKurus = Number(read('Amount'));
          const refundedKurus = Number(read('RefundedAmount')) || 0;

          // Banka çekmiş VE iade/void edilmemiş mi?
          const captured =
            bankCode === '00' &&
            reqStatus === 1 &&
            Number.isFinite(amountKurus) &&
            amountKurus > 0 &&
            refundedKurus < amountKurus;
          if (!captured) continue;

          const refLabel =
            tx.kind === 'cari_topup'
              ? `cari yükleme #${tx.topup?.humanTopupNo ?? tx.topupId ?? '-'}`
              : `sipariş #${tx.order?.humanOrderNo ?? tx.orderId ?? '-'}`;
          const who =
            tx.order?.customerName ?? tx.topup?.customer?.name ?? '';
          const link = tx.orderId ? `/orders/${tx.orderId}` : '/cari';
          const expected = Number(tx.amount);
          // TOSLA 'Amount' birimi BELİRSİZ (kuruş/TL olabilir). reconcileRealAmount
          // ile AYNI sezgi: tam sayı VE /100'ü beklenene daha yakınsa kuruş kabul
          // et → TL'ye çevir. Böylece tutar kapısı birime bağlı kalmaz.
          let capturedTl = amountKurus;
          if (
            Number.isInteger(capturedTl) &&
            Math.abs(capturedTl / 100 - expected) <
              Math.abs(capturedTl - expected)
          ) {
            capturedTl = capturedTl / 100;
          }

          // TUTAR KAPISI — çekilen tutar beklenenle (±1 kuruş) uyuşmuyorsa
          // OTO-TAMAMLAMA YAPMA; insan kontrolü için (bir kez) uyar.
          const amountMatches = Math.abs(capturedTl - expected) <= 0.01;
          if (!amountMatches) {
            const already = await this.prisma.notification.count({
              where: { type: 'system', body: { contains: tx.merchantOid } },
            });
            if (already > 0) continue;
            this.logger.error(
              `TOSLA TUTAR FARKI: ${refLabel} çekilen ₺${capturedTl.toFixed(2)} ≠ ` +
                `beklenen ₺${expected.toFixed(2)} (merchant_oid=${tx.merchantOid}) — ` +
                `oto-tamamlama YAPILMADI, admin kontrolü gerekli.`,
            );
            await this.prisma.notification.create({
              data: {
                role: 'ADMIN',
                type: 'system',
                severity: 'error',
                title: 'TOSLA çekim var ama tutar farklı — kontrol edin',
                body:
                  `${refLabel}${who ? ` (${who})` : ''}: TOSLA'da ₺${capturedTl.toFixed(2)} ` +
                  `çekilmiş ama beklenen ₺${expected.toFixed(2)} ile uyuşmuyor; otomatik ` +
                  `tamamlanmadı. Elle kontrol edin. merchant_oid=${tx.merchantOid}`,
                link,
                data: { merchantOid: tx.merchantOid, kind: tx.kind, orderId: tx.orderId },
              },
            });
            continue;
          }

          // ── OTOMATİK TAMAMLA — callback başarı yolunun (handleCallback) BİREBİR
          // YANSIMASI. Callback'e DOKUNMUYORUZ (test yok, canlı yol); AYNI settle
          // çağrıları burada. Settle mantığı değişirse İKİSİNİ birlikte güncelle.
          // 1) tx → success + totalAmount (KRİTİK: iade/istatistik bu alanı kullanır).
          await this.prisma.paymentTransaction.update({
            where: { merchantOid: tx.merchantOid },
            data: {
              status: 'success',
              totalAmount: tx.amount,
              paymentType: 'card',
              currency: 'TL',
              testMode: tx.testMode ?? true,
              callbackAt: new Date(),
            },
          });
          // 2) kind'e göre settle (idempotent — confirmCardPayment paid/cancelled'ı korur).
          let settleReason: string | undefined;
          if (tx.kind === 'cari_topup' && tx.topupId) {
            const approve = await this.cariBalance.systemApproveCardTopup(
              tx.topupId,
            );
            if (!approve.approved && approve.reason !== undefined)
              settleReason = approve.reason;
          } else if (tx.orderId) {
            const confirm = await this.orders.confirmCardPayment({
              orderId: tx.orderId,
              providerKey: TOSLA_PROVIDER_KEY,
            });
            if (!confirm.confirmed && confirm.reason !== undefined)
              settleReason = confirm.reason;
          }

          if (settleReason) {
            // Çekim doğrulandı ama settle olmadı (ör. sipariş iptal). Karta iade
            // YOK; admin elle cariye ekler (callback ile aynı uyarı).
            this.logger.error(
              `TOSLA OTO-TAMAMLAMA settle başarısız: ${refLabel} çekim doğrulandı ` +
                `ama tamamlanamadı (sebep: ${settleReason}, merchant_oid=${tx.merchantOid}). ` +
                `Tutar gerekirse cariye ELLE eklenmeli.`,
            );
            await this.prisma.notification.create({
              data: {
                role: 'ADMIN',
                type: 'system',
                severity: 'error',
                title: 'TOSLA çekim doğrulandı ama tamamlanamadı — önlem alın',
                body:
                  `${refLabel}${who ? ` (${who})` : ''}: TOSLA'da ₺${expected.toFixed(2)} çekilmiş, ` +
                  `otomatik tamamlanmaya çalışıldı ama olmadı (sebep: ${settleReason}). Karta iade ` +
                  `YAPILMAZ; tutar gerekirse cariye ELLE eklenmeli. merchant_oid=${tx.merchantOid}`,
                link,
                data: { merchantOid: tx.merchantOid, kind: tx.kind, orderId: tx.orderId },
              },
            });
          } else {
            this.logger.log(
              `TOSLA OTO-TAMAMLANDI: ${refLabel} (₺${expected.toFixed(2)}, ` +
                `merchant_oid=${tx.merchantOid}) — kaybolan callback telafi edildi.`,
            );
            await this.prisma.notification.create({
              data: {
                role: 'ADMIN',
                type: 'system',
                severity: 'info',
                title: 'TOSLA ödeme otomatik tamamlandı',
                body:
                  `${refLabel}${who ? ` (${who})` : ''}: TOSLA'da ₺${expected.toFixed(2)} çekilmişti ` +
                  `ama onay callback'i gelmemişti; sistem doğrulayıp OTOMATİK tamamladı. İşlem ` +
                  `gerektirmez. merchant_oid=${tx.merchantOid}`,
                link,
                data: { merchantOid: tx.merchantOid, kind: tx.kind, orderId: tx.orderId },
              },
            });
          }
        } catch (err) {
          // Tek işlem hatası tüm cron'u bozmasın.
          this.logger.warn(
            `TOSLA reconcile (${tx.merchantOid}) atlandı: ${(err as Error).message}`,
          );
        }
      }
    } catch (err) {
      this.logger.error(
        `TOSLA reconcile cron hatası: ${(err as Error).message}`,
      );
    } finally {
      this.reconciling = false;
    }
  }
}
