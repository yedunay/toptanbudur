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
import { PaytrClient } from './paytr.client';
import { PAYTR_PROVIDER_KEY, PAYTR_URLS } from './paytr.constants';

export interface PaytrCallbackPost {
  merchant_oid?: string;
  status?: string;
  total_amount?: string;
  hash?: string;
  failed_reason_code?: string;
  failed_reason_msg?: string;
  test_mode?: string;
  payment_type?: string;
  currency?: string;
  payment_amount?: string;
}

/**
 * PayTR iFrame ödeme orkestrasyonu.
 *
 * Akış (paytr.md §2 iFrame API):
 *   1. Müşteri /sepet/odeme'de "Kart ile öde" seçer → sipariş
 *      status='awaiting_payment' ile oluşur (OrdersService.create).
 *   2. Frontend kart sayfası buradan iframe token ister → PaymentTransaction
 *      (initiated) açılır, PayTR get-token çağrılır.
 *   3. Müşteri PayTR iFrame'inde kartını girer (kart verisi bize HİÇ gelmez).
 *   4. PayTR, Bildirim URL'mize sonucu POST eder → hash doğrulanır,
 *      merchant_oid ile işlem bulunur, idempotent şekilde sipariş onaylanır
 *      (paid) veya deneme failed işaretlenir. Yanıt DÜZ METİN "OK"tır.
 *
 * İADE KURALI (işletme kararı): Karta iade YAPILMAZ — PayTR İade API'si
 * bilinçli olarak entegre edilmemiştir. Her iptal/iade tutarı müşterinin
 * cari bakiyesine eklenir (admin-orders.service.ts iptal yolu).
 */
@Injectable()
export class PaytrService {
  private readonly logger = new Logger(PaytrService.name);
  /** capture-reconcile cron'unun kendi üstüne binmesini önleyen bayrak. */
  private reconcilingCaptures = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: PaytrClient,
    private readonly orders: OrdersService,
    private readonly cariBalance: CariBalanceService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Müşteriye yansıtılan kart komisyon oranı (aktif POS'un SİTE oranı).
   * Sepet sayfası canlı komisyon satırı için kullanır; 60 sn cache'lenir.
   */
  private cardFeeCache: {
    value: { available: boolean; ratePercent: number | null };
    until: number;
  } | null = null;

  /**
   * available=false → sitede KART İLE ÖDEME KAPALI: sepette ve bakiyem'de
   * kart seçenekleri gri/tıklanamaz "DEVRE DIŞI" olarak gösterilir.
   * Admin → POS'tan sağlayıcı "Aktif Yap"/"Devre Dışı Bırak" yapılınca
   * invalidateCardFeeCache() ile ANINDA yansır (cache temizlenir).
   */
  async getCardFee(): Promise<{ available: boolean; ratePercent: number | null }> {
    const now = Date.now();
    if (this.cardFeeCache && this.cardFeeCache.until > now) {
      return this.cardFeeCache.value;
    }
    const provider = await this.prisma.posProvider.findFirst({
      where: { active: true },
      select: { customerCommissionRate: true },
    });
    const value = {
      available: !!provider,
      ratePercent: provider?.customerCommissionRate
        ? Number(provider.customerCommissionRate)
        : null,
    };
    this.cardFeeCache = { value, until: now + 60_000 };
    return value;
  }

  /**
   * card-fee cache'ini anında geçersiz kılar. Admin POS sağlayıcıyı aktif/pasif
   * yapınca çağrılır → değişiklik müşteri tarafına (sepet/bakiyem) 60 sn
   * beklemeden yansır.
   */
  invalidateCardFeeCache(): void {
    this.cardFeeCache = null;
  }

  private storefrontBase(): string {
    return (
      this.config.get<string>('STOREFRONT_URL') ?? 'http://localhost:3001'
    ).replace(/\/+$/, '');
  }

  /**
   * ADMIN TEST ÇEKİMİ — müşterinin gördüğü ÖDEME EKRANININ AYNISINI üretir,
   * ama gerçek sipariş/müşteri akışına HİÇ dokunmadan: ne Order ne
   * PaymentTransaction yaratılır. Bu yüzden test merchant_oid callback'te
   * BULUNAMAZ → hiçbir sipariş onaylanmaz, POS istatistikleri kirlenmez
   * (handleCallback "merchant_oid bulunamadı" deyip no-op döner).
   *
   * testMode: PayTR sağlayıcısının kendi testMode'u kullanılır. Sağlayıcı CANLI
   * iken bu GERÇEK bir çekimdir (girilen kart gerçekten ~tutar kadar çekilir);
   * test modunda sanal karttır. Admin UI bunu açıkça uyarır.
   */
  async createTestIframe(params: { amountTl: number; userIp?: string }) {
    const provider = await this.prisma.posProvider.findUnique({
      where: { key: PAYTR_PROVIDER_KEY },
    });
    if (!provider) throw new NotFoundException('PayTR sağlayıcı tanımlı değil');
    const creds = await this.client.getCredentials();
    if (!creds) {
      throw new ServiceUnavailableException(
        'PayTR API bilgileri eksik — önce kredensiyalleri girin.',
      );
    }
    // 1–1000 TL arası küçük test tutarı.
    const amount = Math.min(1000, Math.max(1, Math.round(params.amountTl * 100) / 100));
    const paymentAmount = Math.round(amount * 100);
    // Gerçek sipariş oid'leriyle (AB/CT) çakışmaz, PaymentTransaction'da YOK.
    const merchantOid = `TEST${Date.now()}`;
    const resultBase = `${this.storefrontBase()}/`;
    const tokenResult = await this.client.getIframeToken(creds, {
      userIp: params.userIp || '127.0.0.1',
      merchantOid,
      email: 'pos-test@toptanbudur.com',
      paymentAmount,
      basket: [['POS Test Çekimi', amount.toFixed(2), 1]],
      noInstallment: provider.noInstallment ? 1 : 0,
      maxInstallment: provider.maxInstallment,
      currency: 'TL',
      testMode: provider.testMode ? 1 : 0,
      userName: 'POS Test',
      userAddress: 'POS Test',
      userPhone: '05000000000',
      okUrl: resultBase,
      failUrl: `${resultBase}?postest=fail`,
      timeoutLimitMinutes: 30,
      debugOn: provider.testMode ? 1 : 0,
      lang: 'tr',
    });
    if (!tokenResult.ok || !tokenResult.token) {
      throw new ServiceUnavailableException(
        tokenResult.reason ?? 'PayTR test token alınamadı',
      );
    }
    return {
      provider: PAYTR_PROVIDER_KEY,
      iframeUrl: `${PAYTR_URLS.iframeBase}/${tokenResult.token}`,
      merchantOid,
      amount,
      testMode: provider.testMode,
    };
  }

  /**
   * PaymentTransaction (initiated) yazar; merchantOid'i benzersiz üretir.
   * İki eşzamanlı istek (çift tık / iki sekme) aynı attemptCount'u okuyup aynı
   * oid üretirse merchantOid @unique ihlali (P2002) olur — sayacı kaydırıp
   * tekrar dener. HAPPY-PATH TEK denemede biter; mevcut davranış DEĞİŞMEZ.
   * En çok 4 deneme; hepsi çakışırsa hata fırlatır (PayTR'a hiç gidilmeden).
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
   * iFrame token üretir. Auth: girişli müşteri (customerId) siparişin sahibi
   * olmalı; misafir akışında sipariş makbuz token'ı (t) doğrulanır.
   */
  async createIframeToken(params: {
    orderId: string;
    receiptToken?: string;
    customerId?: string;
    userIp: string;
  }) {
    const order = await this.prisma.order.findUnique({
      where: { id: params.orderId },
      include: {
        items: { select: { productName: true, unitPrice: true, qty: true } },
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
    if (!provider || provider.key !== PAYTR_PROVIDER_KEY) {
      throw new ServiceUnavailableException(
        'Kartlı ödeme şu anda kullanılamıyor — lütfen daha sonra tekrar deneyin.',
      );
    }
    const creds = await this.client.getCredentials();
    if (!creds) {
      this.logger.error(
        'PayTR API bilgileri eksik (paytr.merchantId/Key/Salt) — admin Secrets',
      );
      throw new ServiceUnavailableException(
        'Kartlı ödeme şu anda kullanılamıyor — lütfen daha sonra tekrar deneyin.',
      );
    }

    // Karttan çekilecek tutar = sipariş toplamı + kart komisyonu (snapshot).
    const commission = order.cardCommissionAmount
      ? new Prisma.Decimal(order.cardCommissionAmount)
      : new Prisma.Decimal(0);
    const chargedTotal = new Prisma.Decimal(order.total).add(commission);
    const totalNumber = Number(chargedTotal);
    const paymentAmount = Math.round(totalNumber * 100);

    // merchant_oid: alfanumerik, ≤64 — "AB{humanOrderNo}T{deneme}"; her yeni
    // deneme yeni benzersiz oid alır (PayTR her işlemde benzersiz ister).
    const merchantOid = await this.persistInitiatedTx(
      { orderId: order.id },
      (n) => `AB${order.humanOrderNo}T${n}`,
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

    // Sepet (sadece PayTR ödeme ekranında bilgi amaçlı gösterilir).
    // Toplamın payment_amount ile tutması için KDV, paketleme ve kart
    // komisyonu ayrı satırdır (müşteri komisyonu sepette zaten görmüştür).
    const basket: Array<[string, string, number]> = order.items.map((i) => [
      i.productName.slice(0, 100),
      Number(i.unitPrice).toFixed(2),
      i.qty,
    ]);
    const kdv = Number(order.kdvAmount ?? 0);
    if (kdv > 0) basket.push(['KDV', kdv.toFixed(2), 1]);
    const packaging = Number(order.packagingCost ?? 0);
    if (packaging > 0) basket.push(['Koruyucu Paketleme', packaging.toFixed(2), 1]);
    if (commission.greaterThan(0)) {
      basket.push(['Kart Komisyonu', Number(commission).toFixed(2), 1]);
    }

    const receipt = this.orders.signReceiptToken(order.id);
    const resultBase = `${this.storefrontBase()}/sepet/odeme/sonuc/${order.id}?t=${encodeURIComponent(receipt)}`;

    const tokenResult = await this.client.getIframeToken(creds, {
      userIp: params.userIp,
      merchantOid,
      // PayTR limiti: email ≤100 karakter (user_name/address/phone gibi kırpılır).
      email: (order.customerEmail ?? '').slice(0, 100),
      paymentAmount,
      basket,
      noInstallment: provider.noInstallment ? 1 : 0,
      maxInstallment: provider.maxInstallment,
      currency: 'TL',
      testMode: provider.testMode ? 1 : 0,
      userName: (order.customerName ?? '').slice(0, 60),
      userAddress: [order.addressLine1, order.addressCity]
        .filter(Boolean)
        .join(' ')
        .slice(0, 400),
      userPhone: (order.customerPhone ?? '').slice(0, 20),
      // ok_url SADECE bilgilendirme sayfasıdır; sipariş onayı YALNIZCA
      // Bildirim URL callback'inde yapılır (paytr.md 1. Adım ÖNEMLİ UYARI).
      okUrl: resultBase,
      failUrl: `${resultBase}&fail=1`,
      timeoutLimitMinutes: 30,
      debugOn: provider.testMode ? 1 : 0,
      lang: 'tr',
    });

    if (!tokenResult.ok || !tokenResult.token) {
      this.logger.error(
        `PayTR get-token failed (order=${order.humanOrderNo}): ${tokenResult.reason}`,
      );
      throw new ServiceUnavailableException(
        'Ödeme sayfası başlatılamadı — lütfen tekrar deneyin.',
      );
    }

    return {
      success: true,
      data: {
        token: tokenResult.token,
        iframeUrl: `${PAYTR_URLS.iframeBase}/${tokenResult.token}`,
        merchantOid,
        orderId: order.id,
        humanOrderNo: order.humanOrderNo,
        amount: totalNumber,
        provider: PAYTR_PROVIDER_KEY,
      },
    };
  }

  /**
   * KART İLE CARİ YÜKLEME için iFrame token. Yalnızca girişli müşteri,
   * yalnızca kendi PENDING 'card' topup'ı için. Çekilen tutar
   * topup.chargedAmount'tır (= cariye eklenecek + komisyon); success
   * callback'inde systemApproveCardTopup cariye NET tutarı ekler.
   */
  async createTopupIframeToken(params: {
    topupId: string;
    customerId: string;
    userIp: string;
  }) {
    const topup = await this.prisma.cariTopup.findUnique({
      where: { id: params.topupId },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            companyAddress: true,
          },
        },
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
    if (!provider || provider.key !== PAYTR_PROVIDER_KEY) {
      throw new ServiceUnavailableException(
        'Kart ile yükleme şu anda kullanılamıyor — lütfen daha sonra tekrar deneyin.',
      );
    }
    const creds = await this.client.getCredentials();
    if (!creds) {
      this.logger.error('PayTR API bilgileri eksik (topup token isteği)');
      throw new ServiceUnavailableException(
        'Kart ile yükleme şu anda kullanılamıyor — lütfen daha sonra tekrar deneyin.',
      );
    }

    const oidBase = topup.humanTopupNo ?? topup.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 20);
    const charged = new Prisma.Decimal(topup.chargedAmount ?? topup.amount);
    const commission = new Prisma.Decimal(topup.commissionAmount ?? 0);
    const paymentAmount = Math.round(Number(charged) * 100);
    // CariTopup tenant taşımıyor (tek tenant kurulum) — sipariş
    // istatistikleriyle aynı havuzda görünsün diye aktif tenant'a yazılır.
    const tenantId =
      (await this.prisma.tenant.findFirst({ select: { id: true } }))?.id ??
      'default';

    const merchantOid = await this.persistInitiatedTx(
      { topupId: topup.id },
      (n) => `CT${oidBase}T${n}`,
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

    const basket: Array<[string, string, number]> = [
      ['Cari Bakiye Yükleme', Number(topup.amount).toFixed(2), 1],
    ];
    if (commission.greaterThan(0)) {
      basket.push(['Kart Komisyonu', Number(commission).toFixed(2), 1]);
    }

    const resultBase = `${this.storefrontBase()}/hesabim/bakiyem/kart/${topup.id}/sonuc?x=1`;

    const tokenResult = await this.client.getIframeToken(creds, {
      userIp: params.userIp,
      merchantOid,
      email: (topup.customer.email ?? '').slice(0, 100),
      paymentAmount,
      basket,
      noInstallment: provider.noInstallment ? 1 : 0,
      maxInstallment: provider.maxInstallment,
      currency: 'TL',
      testMode: provider.testMode ? 1 : 0,
      userName: (topup.customer.name ?? '').slice(0, 60),
      userAddress: (topup.customer.companyAddress ?? 'Türkiye').slice(0, 400),
      userPhone: (topup.customer.phone ?? '').slice(0, 20),
      okUrl: resultBase,
      failUrl: `${resultBase}&fail=1`,
      timeoutLimitMinutes: 30,
      debugOn: provider.testMode ? 1 : 0,
      lang: 'tr',
    });

    if (!tokenResult.ok || !tokenResult.token) {
      this.logger.error(
        `PayTR topup get-token failed (topup=${topup.humanTopupNo}): ${tokenResult.reason}`,
      );
      throw new ServiceUnavailableException(
        'Ödeme sayfası başlatılamadı — lütfen tekrar deneyin.',
      );
    }

    return {
      success: true,
      data: {
        token: tokenResult.token,
        iframeUrl: `${PAYTR_URLS.iframeBase}/${tokenResult.token}`,
        merchantOid,
        topupId: topup.id,
        humanTopupNo: topup.humanTopupNo,
        amount: Number(topup.amount),
        commissionAmount: Number(commission),
        chargedAmount: Number(charged),
        provider: PAYTR_PROVIDER_KEY,
      },
    };
  }

  /**
   * Bildirim URL işleyici (paytr.md 2. Adım — birebir):
   *  - hash doğrulanmadan HİÇBİR işlem yapılmaz (maddi kayıp uyarısı),
   *  - merchant_oid ile işlem bulunur; tekrarlanan bildirimlerde yalnızca
   *    "OK" dönülür, sipariş İKİNCİ kez işlenmez,
   *  - success → sipariş onaylanır (awaiting_payment → paid), müşteri
   *    bilgilendirme maili bu aşamada gönderilir,
   *  - failed → deneme failed işaretlenir, sipariş retry için
   *    awaiting_payment'ta kalır.
   * Dönüş: 'ok' → controller düz metin "OK" basar.
   */
  async handleCallback(post: PaytrCallbackPost): Promise<'ok' | 'bad-hash'> {
    const merchantOid = post.merchant_oid ?? '';
    const status = post.status ?? '';
    const totalAmount = post.total_amount ?? '';

    const creds = await this.client.getCredentials();
    if (!creds) {
      // OK dönmezsek PayTR bildirimi tekrar dener — kredensiyaller girilince
      // bekleyen bildirimler işlenebilir.
      this.logger.error('PayTR callback geldi ama API bilgileri tanımlı değil');
      return 'bad-hash';
    }

    if (
      !this.client.verifyCallbackHash(creds, {
        merchant_oid: merchantOid,
        status,
        total_amount: totalAmount,
        hash: post.hash ?? '',
      })
    ) {
      this.logger.error(
        `PayTR callback BAD HASH (merchant_oid=${merchantOid}) — istek işlenmedi`,
      );
      return 'bad-hash';
    }

    const txRow = await this.prisma.paymentTransaction.findUnique({
      where: { merchantOid },
      include: {
        order: { select: { id: true, status: true, humanOrderNo: true } },
        topup: { select: { id: true, status: true, humanTopupNo: true } },
      },
    });
    if (!txRow) {
      // Hash doğru ama kayıt yok (ör. veri kaybı) — tekrar denemenin faydası
      // yok; loglayıp OK dönüyoruz, mutabakat Durum Sorgu/İşlem Dökümü ile yapılır.
      this.logger.error(
        `PayTR callback: merchant_oid bulunamadı (${merchantOid}) — manuel kontrol gerekli`,
      );
      return 'ok';
    }

    // Tekrarlayan bildirim: ilk bildirim esas alınır (doc 2. Adım uyarısı).
    if (txRow.status !== 'initiated') {
      // Öz-iyileşme: işlem success yazılmış ama onay (geçici DB hatası vb.)
      // yarım kalmışsa, PayTR'ın tekrar bildirimi onayı yeniden dener.
      if (txRow.status === 'success') {
        if (
          txRow.kind === 'order' &&
          txRow.orderId &&
          txRow.order?.status === 'awaiting_payment'
        ) {
          try {
            await this.orders.confirmCardPayment({
              orderId: txRow.orderId,
              providerKey: txRow.providerKey,
            });
          } catch (err) {
            this.logger.error(
              `PayTR retry: sipariş onayı yine başarısız (order=${txRow.order?.humanOrderNo}): ${(err as Error).message}`,
            );
          }
        } else if (
          txRow.kind === 'cari_topup' &&
          txRow.topupId &&
          txRow.topup?.status === 'PENDING'
        ) {
          try {
            await this.cariBalance.systemApproveCardTopup(txRow.topupId);
          } catch (err) {
            this.logger.error(
              `PayTR retry: topup onayı yine başarısız (topup=${txRow.topup?.humanTopupNo}): ${(err as Error).message}`,
            );
          }
        }
      }
      return 'ok';
    }

    const isSuccess = status === 'success';
    const capturedTotal = totalAmount
      ? new Prisma.Decimal(totalAmount).div(100)
      : null;

    await this.prisma.paymentTransaction.update({
      where: { merchantOid },
      data: {
        status: isSuccess ? 'success' : 'failed',
        totalAmount: capturedTotal,
        paymentType: post.payment_type ?? null,
        currency: post.currency ?? 'TL',
        failedReasonCode: isSuccess ? null : (post.failed_reason_code ?? null),
        failedReasonMsg: isSuccess ? null : (post.failed_reason_msg ?? null),
        testMode: post.test_mode === '1',
        callbackAt: new Date(),
      },
    });

    const refLabel =
      txRow.kind === 'cari_topup'
        ? `topup=#${txRow.topup?.humanTopupNo}`
        : `order=#${txRow.order?.humanOrderNo}`;

    if (isSuccess) {
      try {
        if (txRow.kind === 'cari_topup' && txRow.topupId) {
          const approve = await this.cariBalance.systemApproveCardTopup(
            txRow.topupId,
          );
          if (!approve.approved && approve.reason !== undefined) {
            this.logger.error(
              `PayTR FAZLA TAHSİLAT UYARISI (cari yükleme): success geldi ama onaylanamadı ` +
                `(${refLabel}, merchant_oid=${merchantOid}, sebep=${approve.reason}, ` +
                `tutar=${capturedTotal?.toString() ?? totalAmount}). Manuel kontrol gerekli!`,
            );
            // §orta — admine bildirim (geç/çift cari yükleme tahsilatı).
            void this.prisma.notification
              .create({
                data: {
                  role: 'ADMIN',
                  type: 'system',
                  severity: 'error',
                  title: 'Geç/çift kart tahsilatı (cari yükleme) — önlem alın',
                  body:
                    `${refLabel} için başarılı kart çekimi geldi ama cari yükleme ` +
                    `onaylanamadı (sebep: ${approve.reason}, tutar: ` +
                    `${capturedTotal?.toString() ?? totalAmount}). Manuel kontrol ` +
                    `gerekli. merchant_oid=${merchantOid}`,
                  link: '/cari',
                },
              })
              .catch(() => undefined);
          }
        } else if (txRow.orderId) {
          const confirm = await this.orders.confirmCardPayment({
            orderId: txRow.orderId,
            providerKey: txRow.providerKey,
          });
          // ÇİFTE TAHSİLAT / iptal-sonrası tahsilat tespiti: sipariş zaten
          // paid (ikinci sekmeden ikinci ödeme) ya da cancelled (sweep
          // yarışı) iken success geldiyse para fazladan çekilmiştir. Karta
          // iade YAPILMADIĞI için tutar admin tarafından müşterinin cari
          // bakiyesine eklenmelidir — yüksek sesle logla.
          if (!confirm.confirmed && confirm.reason !== undefined) {
            this.logger.error(
              `PayTR FAZLA TAHSİLAT UYARISI: success callback geldi ama sipariş onaylanamadı ` +
                `(${refLabel}, merchant_oid=${merchantOid}, sebep=${confirm.reason}, ` +
                `tutar=${capturedTotal?.toString() ?? totalAmount}). Tutar müşterinin CARİ bakiyesine eklenmeli!`,
            );
            // §orta — Kullanıcı kararı: OTOMATİK cari iadesi YAPMA; admine
            // BİLDİRİM ver ("tutar geç çekildi, önlem alın"). Admin elle karar
            // verir. Fire-and-forget; callback akışını bloklamaz.
            void this.prisma.notification
              .create({
                data: {
                  role: 'ADMIN',
                  type: 'system',
                  severity: 'error',
                  title: 'Geç/çift kart tahsilatı — önlem alın',
                  body:
                    `${refLabel} için başarılı kart çekimi geldi ama sipariş ` +
                    `onaylanamadı (sebep: ${confirm.reason}, tutar: ` +
                    `${capturedTotal?.toString() ?? totalAmount}). Karta iade ` +
                    `YAPILMAZ; tutar gerekirse müşterinin cari bakiyesine ELLE ` +
                    `eklenmeli. merchant_oid=${merchantOid}`,
                  link: txRow.orderId ? `/orders/${txRow.orderId}` : null,
                },
              })
              .catch(() => undefined);
          }
        }
      } catch (err) {
        // Onay başarısız olsa bile parayı PayTR tahsil etti; OK dönüp
        // durumu loglarız — PayTR bildirimi yinelerse öz-iyileşme dalı
        // onayı yeniden dener.
        this.logger.error(
          `PayTR success ama onay başarısız (${refLabel}): ${(err as Error).message}`,
        );
      }
    } else {
      this.logger.warn(
        `PayTR ödeme başarısız (${refLabel}, code=${post.failed_reason_code}): ${post.failed_reason_msg}`,
      );
    }

    return 'ok';
  }

  /**
   * Terk edilmiş kart siparişi süpürücüsü — yarım saatte bir.
   *
   * Kart siparişi stoğu yaratılışta düşürür; ödeme hiç gelmezse stok kilitli
   * kalır. PayTR işlem süresi 30 dk (timeout_limit) olduğundan 2 saatten
   * eski, başarılı tahsilatı olmayan awaiting_payment siparişleri iptal edip
   * ürün stoklarını geri ekler. (Geç gelen bir success callback'i
   * confirmCardPayment'ta 'unexpected-status' loguna düşer ve iade kuralı
   * gereği tutar admin tarafından cari bakiyeye eklenir.)
   */
  @Cron('0 */30 * * * *', { name: 'paytr-stale-awaiting-payment-sweep' })
  async sweepStaleAwaitingPayments(): Promise<void> {
    const now = Date.now();
    const cutoff = new Date(now - 2 * 3_600_000);
    // PayTR iFrame timeout'u 30 dk — son 45 dk içinde AÇILMIŞ bir deneme
    // varsa müşteri hâlâ ödüyor olabilir; bu siparişe DOKUNMA (sweep'in
    // iptal ettiği siparişe geç success gelmesi yarışını kapatır).
    const activeAttemptCutoff = new Date(now - 45 * 60_000);
    const stale = await this.prisma.order.findMany({
      where: {
        status: 'awaiting_payment',
        paymentType: 'card',
        createdAt: { lt: cutoff },
        paymentTransactions: {
          none: {
            OR: [
              { status: 'success' },
              { createdAt: { gt: activeAttemptCutoff } },
            ],
          },
        },
      },
      select: {
        id: true,
        tenantId: true,
        humanOrderNo: true,
        items: { select: { productId: true, qty: true } },
      },
      take: 50,
    });

    // Öz-iyileşme: success işlemi olduğu hâlde awaiting_payment'ta takılı
    // kalmış siparişlerin onayını yeniden dene (callback retry'ı gelmediyse).
    const stuck = await this.prisma.order.findMany({
      where: {
        status: 'awaiting_payment',
        paymentType: 'card',
        paymentTransactions: { some: { status: 'success' } },
      },
      select: {
        id: true,
        humanOrderNo: true,
        paymentTransactions: {
          where: { status: 'success' },
          take: 1,
          select: { providerKey: true },
        },
      },
      take: 20,
    });
    for (const order of stuck) {
      try {
        await this.orders.confirmCardPayment({
          orderId: order.id,
          providerKey: order.paymentTransactions[0]?.providerKey ?? PAYTR_PROVIDER_KEY,
        });
        this.logger.warn(
          `Takılı kalmış ödenmiş sipariş onaylandı (reconcile): #${order.humanOrderNo}`,
        );
      } catch (err) {
        this.logger.error(
          `reconcile confirm failed (#${order.humanOrderNo}): ${(err as Error).message}`,
        );
      }
    }

    // Kartlı cari yüklemeler: success'i olduğu hâlde PENDING takılanları
    // onayla; 2 saatten eski, denemesi bitmiş ödenmemişleri reddet.
    const stuckTopups = await this.prisma.cariTopup.findMany({
      where: {
        method: 'card',
        status: 'PENDING',
        paymentTransactions: { some: { status: 'success' } },
      },
      select: { id: true, humanTopupNo: true },
      take: 20,
    });
    for (const t of stuckTopups) {
      try {
        await this.cariBalance.systemApproveCardTopup(t.id);
        this.logger.warn(
          `Takılı kalmış ödenmiş cari yükleme onaylandı (reconcile): #${t.humanTopupNo}`,
        );
      } catch (err) {
        this.logger.error(
          `topup reconcile failed (#${t.humanTopupNo}): ${(err as Error).message}`,
        );
      }
    }
    await this.prisma.cariTopup.updateMany({
      where: {
        method: 'card',
        status: 'PENDING',
        requestedAt: { lt: cutoff },
        paymentTransactions: {
          none: {
            OR: [
              { status: 'success' },
              { createdAt: { gt: activeAttemptCutoff } },
            ],
          },
        },
      },
      data: {
        status: 'REJECTED',
        decidedAt: new Date(),
        adminNote: 'Kart ödemesi tamamlanmadı — otomatik kapatıldı',
      },
    });

    if (stale.length === 0) return;

    for (const order of stale) {
      try {
        await this.prisma.$transaction(async (tx) => {
          // Yarış koruması: hâlâ awaiting_payment ise iptal et.
          const updated = await tx.order.updateMany({
            where: { id: order.id, status: 'awaiting_payment' },
            data: { status: 'cancelled', statusChangedAt: new Date() },
          });
          if (updated.count !== 1) return;
          for (const item of order.items) {
            if (!item.productId) continue;
            await tx.product.updateMany({
              where: { id: item.productId, tenantId: order.tenantId },
              data: { stock: { increment: item.qty } },
            });
          }
        });
        this.logger.log(
          `Ödemesi gelmeyen kart siparişi iptal edildi, stok iade: #${order.humanOrderNo}`,
        );
      } catch (err) {
        this.logger.error(
          `stale awaiting_payment sweep failed (#${order.humanOrderNo}): ${(err as Error).message}`,
        );
      }
    }
  }

  /**
   * §KRİTİK — SESSİZ TAHSİLAT MUTABAKATI (callback gelmeyen çekimleri yakalar).
   *
   * PayTR bildirimi sunucu-sunucu gelir (PayTR retry'lar), o yüzden bu durum
   * TOSLA'ya göre nadirdir; ama Bildirim URL'imiz erişilemez/hash tutmazsa ya
   * da tüm retry'lar tükenirse PayTR kartı ÇEKTİĞİ hâlde bizim
   * PaymentTransaction 'initiated'ta kalır → sipariş ödenmemiş görünür,
   * stale-sweep iptal eder, para SESSİZCE çekilmiş olur. (Aynı sınıf hata
   * TOSLA'da yaşandı; bkz. tosla.service reconcile.)
   *
   * Bu cron 'initiated'ta takılı PayTR işlemlerini PayTR'ın kendi Durum Sorgu
   * (durum-sorgu) servisiyle kontrol eder: yanıt status='success' ise (PayTR
   * yalnız GERÇEKLEŞMİŞ ödeme için 'success' döner; aksi 'error/004') ve iade
   * (returns) yoksa siparişi/işlemi OTOMATİK TAMAMLAR — kaybolan bildirimi
   * telafi eder (KULLANICI KARARI 2026-07-30).
   *
   * OTO-TAMAMLAMA = callback başarı yolunun (handleCallback) BİREBİR YANSIMASI:
   * tx→success (+totalAmount) + kind'e göre confirmCardPayment /
   * systemApproveCardTopup / recordCardPayment. PayTR callback'i status='success'te
   * AYRI TUTAR-KAPISI OLMADAN settle eder (durum-sorgu PayTR'nin yetkili onayı);
   * reconcile de aynısını yapar. İdempotent: settle tx'i 'success' yapar →
   * sonraki turlar (status='initiated' filtresi) görmez; confirmCardPayment de
   * paid/cancelled durumunu korur (çift-settle yok). Callback'e DOKUNULMADI.
   *
   * Settle başarısızsa (ör. sipariş iptal): OTO YAPILMAZ, karta iade YAPILMAZ —
   * admin'e uyarı (tutar gerekirse cariye elle).
   */
  @Cron('0 */15 * * * *', { name: 'paytr-initiated-capture-reconcile' })
  async reconcileInitiatedPaytrCaptures(): Promise<void> {
    if (this.reconcilingCaptures) return;
    this.reconcilingCaptures = true;
    try {
      const creds = await this.client.getCredentials();
      if (!creds) return;

      const now = Date.now();
      // Aktif müşteriyle yarışmamak için ≥20 dk yaşındaki denemeler; eskiyi
      // sonsuz sorgulamamak için ≤24 saat penceresi.
      const candidates = await this.prisma.paymentTransaction.findMany({
        where: {
          providerKey: PAYTR_PROVIDER_KEY,
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
          const result = await this.client.statusQuery(creds, tx.merchantOid);
          if (!result.ok || !result.data) continue;

          const d = result.data as Record<string, unknown>;
          // PayTR durum-sorgu: gerçekleşmiş ödeme → status='success'; aksi
          // 'error' (err_no=004 "basarili odeme bulunamadi").
          const captured = d.status === 'success';
          const refunded = Array.isArray(d.returns) && (d.returns as unknown[]).length > 0;
          if (!captured || refunded) continue;

          const refLabel =
            tx.kind === 'cari_topup'
              ? `cari yükleme #${tx.topup?.humanTopupNo ?? tx.topupId ?? '-'}`
              : `sipariş #${tx.order?.humanOrderNo ?? tx.orderId ?? '-'}`;
          const who = tx.order?.customerName ?? tx.topup?.customer?.name ?? '';
          const link = tx.orderId ? `/orders/${tx.orderId}` : '/cari';
          const expected = Number(tx.amount);
          // Çekilen gerçek tutar (durum-sorgu payment_amount/total_amount, kuruş)
          // → TL. Callback 'capturedTotal' semantiğiyle aynı; yoksa beklenene düş.
          const rawCaptured = Number(
            d.payment_amount ?? d.total_amount ?? d.payment_total,
          );
          const capturedTotal =
            Number.isFinite(rawCaptured) && rawCaptured > 0
              ? new Prisma.Decimal(rawCaptured).div(100)
              : new Prisma.Decimal(expected);

          // ── OTOMATİK TAMAMLA — callback başarı yolunun (handleCallback) BİREBİR
          // YANSIMASI. PayTR callback'i status='success'te AMOUNT-KAPISI OLMADAN
          // settle eder (durum-sorgu PayTR'nin yetkili onayı); reconcile de aynısını
          // yapar. Callback'e DOKUNULMADI. Settle değişirse İKİSİNİ birlikte güncelle.
          // 1) tx → success + totalAmount (KRİTİK: iade/istatistik bu alanı kullanır).
          await this.prisma.paymentTransaction.update({
            where: { merchantOid: tx.merchantOid },
            data: {
              status: 'success',
              totalAmount: capturedTotal,
              paymentType: 'card',
              currency: 'TL',
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
              providerKey: PAYTR_PROVIDER_KEY,
            });
            if (!confirm.confirmed && confirm.reason !== undefined)
              settleReason = confirm.reason;
          }

          if (settleReason) {
            // Çekim doğrulandı ama settle olmadı (ör. sipariş iptal). Karta iade
            // YOK; admin elle cariye ekler (callback ile aynı uyarı).
            this.logger.error(
              `PayTR OTO-TAMAMLAMA settle başarısız: ${refLabel} çekim doğrulandı ` +
                `ama tamamlanamadı (sebep: ${settleReason}, merchant_oid=${tx.merchantOid}). ` +
                `Tutar gerekirse cariye ELLE eklenmeli.`,
            );
            await this.prisma.notification.create({
              data: {
                role: 'ADMIN',
                type: 'system',
                severity: 'error',
                title: 'PayTR çekim doğrulandı ama tamamlanamadı — önlem alın',
                body:
                  `${refLabel}${who ? ` (${who})` : ''}: PayTR'da ₺${expected.toFixed(2)} çekilmiş, ` +
                  `otomatik tamamlanmaya çalışıldı ama olmadı (sebep: ${settleReason}). Karta iade ` +
                  `YAPILMAZ; tutar gerekirse cariye ELLE eklenmeli. merchant_oid=${tx.merchantOid}`,
                link,
                data: { merchantOid: tx.merchantOid, kind: tx.kind, orderId: tx.orderId },
              },
            });
          } else {
            this.logger.log(
              `PayTR OTO-TAMAMLANDI: ${refLabel} (₺${expected.toFixed(2)}, ` +
                `merchant_oid=${tx.merchantOid}) — kaybolan bildirim telafi edildi.`,
            );
            await this.prisma.notification.create({
              data: {
                role: 'ADMIN',
                type: 'system',
                severity: 'info',
                title: 'PayTR ödeme otomatik tamamlandı',
                body:
                  `${refLabel}${who ? ` (${who})` : ''}: PayTR'da ₺${expected.toFixed(2)} çekilmişti ` +
                  `ama onay bildirimi gelmemişti; sistem doğrulayıp OTOMATİK tamamladı. İşlem ` +
                  `gerektirmez. merchant_oid=${tx.merchantOid}`,
                link,
                data: { merchantOid: tx.merchantOid, kind: tx.kind, orderId: tx.orderId },
              },
            });
          }
        } catch (err) {
          this.logger.warn(
            `PayTR reconcile (${tx.merchantOid}) atlandı: ${(err as Error).message}`,
          );
        }
      }
    } catch (err) {
      this.logger.error(
        `PayTR reconcile cron hatası: ${(err as Error).message}`,
      );
    } finally {
      this.reconcilingCaptures = false;
    }
  }
}
