import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SecretsService } from '../../secrets/secrets.service';
import { PaytrClient } from '../../payments/paytr/paytr.client';
import { PaytrService } from '../../payments/paytr/paytr.service';
import { ToslaClient } from '../../payments/tosla/tosla.client';
import { ToslaService } from '../../payments/tosla/tosla.service';
import {
  PAYMENT_REPORT_MAX_DAYS,
  PAYTR_PROVIDER_KEY,
  PAYTR_SECRET_KEYS,
  TRANSACTION_REPORT_MAX_DAYS,
} from '../../payments/paytr/paytr.constants';
import {
  TOSLA_PROVIDER_KEY,
  TOSLA_SECRET_KEYS,
  toslaBaseUrl,
} from '../../payments/tosla/tosla.constants';
import { PosProviderCreateDto, PosProviderUpdateDto } from './dto/pos-provider.dto';

/**
 * Sanal POS sağlayıcı yönetimi.
 *
 * - Aynı anda yalnızca BİR sağlayıcı aktif olur (activate transaction'ı
 *   önce hepsini pasifler, sonra hedefi aktifler).
 * - Çekim istatistikleri PaymentTransaction(success) kayıtlarından gelir;
 *   kartlı tahsilatı PayTR callback'i onaylar (paytr.service).
 * - PayTR rapor araçları (durum sorgu, işlem dökümü, ödeme dökümü) yalnızca
 *   görüntülemedir; İADE API'Sİ YOKTUR — iade her zaman cari bakiyeye yapılır.
 */
@Injectable()
export class AdminPosService {
  private readonly logger = new Logger(AdminPosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretsService,
    private readonly paytrClient: PaytrClient,
    private readonly paytr: PaytrService,
    private readonly toslaClient: ToslaClient,
    private readonly tosla: ToslaService,
  ) {}

  async list(tenantId: string) {
    const providers = await this.prisma.posProvider.findMany({
      orderBy: [{ active: 'desc' }, { createdAt: 'asc' }],
    });

    const stats = await this.prisma.paymentTransaction.groupBy({
      by: ['providerKey'],
      where: { tenantId, status: 'success' },
      _sum: { totalAmount: true },
      _count: { _all: true },
      _max: { callbackAt: true },
    });
    const byKey = new Map(stats.map((s) => [s.providerKey, s]));

    // §orta — İPTAL/İADE düşülen: order'ı cancelled/refunded olan başarılı
    // çekimler. "Toplam Çekim" BRÜTtür (iptaller dahil); net ciro için bunlar
    // düşülür. Operatör net ciroyu brüt sanmasın diye ayrı gösterilir.
    const cancelledStats = await this.prisma.paymentTransaction.groupBy({
      by: ['providerKey'],
      where: {
        tenantId,
        status: 'success',
        order: { status: { in: ['cancelled', 'refunded'] } },
      },
      _sum: { totalAmount: true },
      _count: { _all: true },
    });
    const cancelledByKey = new Map(cancelledStats.map((s) => [s.providerKey, s]));

    return {
      success: true,
      data: providers.map((p) => {
        const s = byKey.get(p.key);
        const c = cancelledByKey.get(p.key);
        const gross = Number(s?._sum.totalAmount ?? 0);
        const cancelled = Number(c?._sum.totalAmount ?? 0);
        return {
          ...p,
          commissionRate: p.commissionRate?.toString() ?? null,
          customerCommissionRate: p.customerCommissionRate?.toString() ?? null,
          stats: {
            orderCount: s?._count._all ?? 0,
            totalAmount: gross.toFixed(2),
            // İptal/iade edilen siparişlerin başarılı çekim tutarı (bilgi).
            cancelledAmount: cancelled.toFixed(2),
            cancelledCount: c?._count._all ?? 0,
            // Net ciro = brüt çekim − iptal/iade edilen çekimler.
            netAmount: (gross - cancelled).toFixed(2),
            lastPaymentAt: s?._max.callbackAt ?? null,
          },
        };
      }),
    };
  }

  /**
   * Detay: sağlayıcı + istatistik + son işlemler + (paytr için) API
   * bilgilerinin tanımlı olup olmadığı (maskeli durum — düz değer asla dönmez).
   */
  async detail(tenantId: string, key: string) {
    const provider = await this.prisma.posProvider.findUnique({ where: { key } });
    if (!provider) throw new NotFoundException(`POS sağlayıcı bulunamadı: ${key}`);

    const [agg, monthAgg, recent] = await Promise.all([
      this.prisma.paymentTransaction.aggregate({
        where: { tenantId, providerKey: key, status: 'success' },
        _sum: { totalAmount: true },
        _count: { _all: true },
        _max: { callbackAt: true },
      }),
      this.prisma.paymentTransaction.aggregate({
        where: {
          tenantId,
          providerKey: key,
          status: 'success',
          callbackAt: {
            gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
          },
        },
        _sum: { totalAmount: true },
        _count: { _all: true },
      }),
      this.prisma.paymentTransaction.findMany({
        where: { tenantId, providerKey: key, status: { not: 'initiated' } },
        orderBy: { callbackAt: 'desc' },
        take: 25,
        select: {
          id: true,
          merchantOid: true,
          status: true,
          amount: true,
          totalAmount: true,
          currency: true,
          paymentType: true,
          failedReasonCode: true,
          failedReasonMsg: true,
          testMode: true,
          callbackAt: true,
          order: {
            select: {
              id: true,
              humanOrderNo: true,
              customerName: true,
              // İptal/iade edilen siparişin çekimini operatör detayda görebilsin.
              status: true,
            },
          },
          // Cari topup (kartla bakiye yükleme) işlemlerinde order YOK; müşteri
          // adı + topup numarası buradan gelir. Aksi halde POS hareketlerinde
          // bayi ismi "—" görünür (kind='cari_topup' satırları).
          topup: {
            select: {
              id: true,
              humanTopupNo: true,
              customer: { select: { name: true } },
            },
          },
        },
      }),
    ]);

    // §orta — net ciro için iptal/iade edilen başarılı çekimler (tüm zaman).
    const cancelledAgg = await this.prisma.paymentTransaction.aggregate({
      where: {
        tenantId,
        providerKey: key,
        status: 'success',
        order: { status: { in: ['cancelled', 'refunded'] } },
      },
      _sum: { totalAmount: true },
      _count: { _all: true },
    });

    // Sağlayıcıya özel maskeli kredensiyaller (alan adı → maskeli değer). Düz
    // değer ASLA dönmez. Frontend CRED_FIELDS bu alan adlarıyla eşleşir.
    let credentials: Record<string, string | null> | null = null;
    if (key === PAYTR_PROVIDER_KEY) {
      const [id, k, s] = await Promise.all([
        this.secrets.getMasked(PAYTR_SECRET_KEYS.merchantId),
        this.secrets.getMasked(PAYTR_SECRET_KEYS.merchantKey),
        this.secrets.getMasked(PAYTR_SECRET_KEYS.merchantSalt),
      ]);
      credentials = { merchantId: id, merchantKey: k, merchantSalt: s };
    } else if (key === TOSLA_PROVIDER_KEY) {
      const [cid, user, pass] = await Promise.all([
        this.secrets.getMasked(TOSLA_SECRET_KEYS.clientId),
        this.secrets.getMasked(TOSLA_SECRET_KEYS.apiUser),
        this.secrets.getMasked(TOSLA_SECRET_KEYS.apiPass),
      ]);
      credentials = { clientId: cid, apiUser: user, apiPass: pass };
    }

    return {
      success: true,
      data: {
        provider: {
          ...provider,
          commissionRate: provider.commissionRate?.toString() ?? null,
          customerCommissionRate:
            provider.customerCommissionRate?.toString() ?? null,
        },
        stats: {
          orderCount: agg._count._all,
          totalAmount: Number(agg._sum.totalAmount ?? 0).toFixed(2),
          // İptal/iade edilen siparişlerin başarılı çekim tutarı + net ciro.
          cancelledAmount: Number(cancelledAgg._sum.totalAmount ?? 0).toFixed(2),
          cancelledCount: cancelledAgg._count._all,
          netAmount: (
            Number(agg._sum.totalAmount ?? 0) -
            Number(cancelledAgg._sum.totalAmount ?? 0)
          ).toFixed(2),
          lastPaymentAt: agg._max.callbackAt ?? null,
          monthOrderCount: monthAgg._count._all,
          monthTotalAmount: Number(monthAgg._sum.totalAmount ?? 0).toFixed(2),
        },
        recentTransactions: recent.map((t) => ({
          ...t,
          amount: t.amount.toString(),
          totalAmount: t.totalAmount?.toString() ?? null,
        })),
        credentials,
      },
    };
  }

  async activate(key: string) {
    const provider = await this.prisma.posProvider.findUnique({ where: { key } });
    if (!provider) throw new NotFoundException(`POS sağlayıcı bulunamadı: ${key}`);

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.posProvider.updateMany({
        where: { active: true, key: { not: key } },
        data: { active: false },
      });
      return tx.posProvider.update({ where: { key }, data: { active: true } });
    });

    // Değişiklik müşteri tarafına (sepet/bakiyem card-fee) anında yansısın.
    this.paytr.invalidateCardFeeCache();
    this.logger.log(`Aktif POS sağlayıcı değişti → ${key}`);
    return { success: true, data: updated };
  }

  /**
   * Aktif POS sağlayıcıyı DEVRE DIŞI bırakır (active=false) → hiç aktif POS
   * kalmaz → sitede kartlı ödeme tamamen kapanır (sepet/bakiyem "DEVRE DIŞI",
   * backend kart siparişini reddeder). Idempotent: zaten pasifse no-op.
   * Tekrar açmak için activate(key) yeterli.
   */
  async deactivate(key: string) {
    const provider = await this.prisma.posProvider.findUnique({ where: { key } });
    if (!provider) throw new NotFoundException(`POS sağlayıcı bulunamadı: ${key}`);

    if (!provider.active) {
      return { success: true, data: provider };
    }

    const updated = await this.prisma.posProvider.update({
      where: { key },
      data: { active: false },
    });

    this.paytr.invalidateCardFeeCache();
    this.logger.log(`POS sağlayıcı devre dışı bırakıldı → ${key} (kartlı ödeme kapalı)`);
    return { success: true, data: updated };
  }

  async create(dto: PosProviderCreateDto) {
    const key = dto.key.toLowerCase();
    const existing = await this.prisma.posProvider.findUnique({ where: { key } });
    if (existing) throw new ConflictException(`Bu key zaten kayıtlı: ${key}`);

    const created = await this.prisma.posProvider.create({
      data: {
        key,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        // Yeni sağlayıcı pasif başlar; geçiş bilinçli olarak activate ile yapılır.
        active: false,
      },
    });
    return { success: true, data: created };
  }

  async update(key: string, dto: PosProviderUpdateDto) {
    const provider = await this.prisma.posProvider.findUnique({ where: { key } });
    if (!provider) throw new NotFoundException(`POS sağlayıcı bulunamadı: ${key}`);

    if (dto.active === true) {
      await this.activate(key);
    } else if (dto.active === false && provider.active) {
      throw new BadRequestException(
        'Aktif sağlayıcı doğrudan pasiflenemez — önce başka bir sağlayıcıyı aktif yapın.',
      );
    }

    const updated = await this.prisma.posProvider.update({
      where: { key },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description.trim() || null }
          : {}),
        ...(dto.commissionRate !== undefined
          ? {
              commissionRate:
                dto.commissionRate === null
                  ? null
                  : new Prisma.Decimal(dto.commissionRate),
            }
          : {}),
        ...(dto.customerCommissionRate !== undefined
          ? {
              customerCommissionRate:
                dto.customerCommissionRate === null
                  ? null
                  : new Prisma.Decimal(dto.customerCommissionRate),
            }
          : {}),
        ...(dto.valorDays !== undefined ? { valorDays: dto.valorDays } : {}),
        ...(dto.testMode !== undefined ? { testMode: dto.testMode } : {}),
        ...(dto.noInstallment !== undefined
          ? { noInstallment: dto.noInstallment }
          : {}),
        ...(dto.maxInstallment !== undefined
          ? { maxInstallment: dto.maxInstallment }
          : {}),
      },
    });
    return {
      success: true,
      data: {
        ...updated,
        commissionRate: updated.commissionRate?.toString() ?? null,
        customerCommissionRate:
          updated.customerCommissionRate?.toString() ?? null,
      },
    };
  }

  async remove(key: string) {
    const provider = await this.prisma.posProvider.findUnique({ where: { key } });
    if (!provider) throw new NotFoundException(`POS sağlayıcı bulunamadı: ${key}`);
    if (provider.active) {
      throw new BadRequestException(
        'Aktif sağlayıcı silinemez — önce başka bir sağlayıcıyı aktif yapın.',
      );
    }
    await this.prisma.posProvider.delete({ where: { key } });
    return { success: true, data: { key } };
  }

  // ─── PayTR API araçları (yalnızca okuma/raporlama) ───────────────────────

  private async paytrCreds() {
    const creds = await this.paytrClient.getCredentials();
    if (!creds) {
      throw new ServiceUnavailableException(
        'PayTR API bilgileri tanımlı değil — detay sayfasındaki API Bilgileri bölümünden girin.',
      );
    }
    return creds;
  }

  /** Durum Sorgu — merchant_oid ile PayTR'dan işlem durumu/kesinti çeker. */
  async paytrStatusQuery(merchantOid: string) {
    const creds = await this.paytrCreds();
    const result = await this.paytrClient.statusQuery(creds, merchantOid.trim());
    if (!result.ok) {
      throw new ServiceUnavailableException(result.error ?? 'PayTR yanıt vermedi');
    }
    return { success: true, data: result.data };
  }

  /** Satış/İade işlem dökümü — en fazla 3 günlük aralık (doc §13). */
  async paytrTransactionReport(startDate: string, endDate: string) {
    this.assertRange(startDate, endDate, TRANSACTION_REPORT_MAX_DAYS);
    const creds = await this.paytrCreds();
    const result = await this.paytrClient.transactionReport(
      creds,
      startDate,
      endDate,
    );
    if (!result.ok) {
      throw new ServiceUnavailableException(result.error ?? 'PayTR yanıt vermedi');
    }
    return { success: true, data: result.data };
  }

  /** Ödeme dökümü (hesaba geçen/geçecek tutarlar — valör takibi), ≤31 gün. */
  async paytrPaymentReport(startDate: string, endDate: string) {
    this.assertRange(startDate, endDate, PAYMENT_REPORT_MAX_DAYS);
    const creds = await this.paytrCreds();
    const result = await this.paytrClient.paymentReport(creds, startDate, endDate);
    if (!result.ok) {
      throw new ServiceUnavailableException(result.error ?? 'PayTR yanıt vermedi');
    }
    return { success: true, data: result.data };
  }

  private assertRange(start: string, end: string, maxDays: number): void {
    const s = new Date(start.slice(0, 10));
    const e = new Date(end.slice(0, 10));
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e < s) {
      throw new BadRequestException('Geçersiz tarih aralığı');
    }
    const days = (e.getTime() - s.getTime()) / 86_400_000 + 1;
    if (days > maxDays) {
      throw new BadRequestException(
        `PayTR bu rapor için en fazla ${maxDays} günlük aralık kabul eder`,
      );
    }
  }

  private async toslaCreds() {
    const creds = await this.toslaClient.getCredentials();
    if (!creds) {
      throw new ServiceUnavailableException(
        'TOSLA API bilgileri tanımlı değil — detay sayfasındaki API Bilgileri bölümünden girin.',
      );
    }
    return creds;
  }

  /**
   * TOSLA Durum Sorgu (inquiry) — merchantOid (=bizim gönderdiğimiz orderId)
   * ile TOSLA'dan işlem durumunu/tutarını çeker. Yalnızca SALT-OKUMA mutabakat
   * aracıdır: bad-hash/limbo'da kalmış işlemleri (para çekilmiş ama onay
   * düşmemiş) elle doğrulamak için. İADE/İPTAL (void/refund) BİLİNÇLİ olarak
   * admin'e bağlanmamıştır — iade DAİMA cari bakiyeye yapılır, karta değil.
   * baseUrl için testMode'u işlemden, yoksa aktif TOSLA sağlayıcısından çözer.
   */
  async toslaStatusQuery(merchantOid: string) {
    const oid = merchantOid.trim();
    const creds = await this.toslaCreds();
    const tx = await this.prisma.paymentTransaction.findUnique({
      where: { merchantOid: oid },
      select: { testMode: true },
    });
    let testMode = tx?.testMode;
    if (testMode === undefined) {
      const provider = await this.prisma.posProvider.findUnique({
        where: { key: TOSLA_PROVIDER_KEY },
        select: { testMode: true },
      });
      testMode = provider?.testMode ?? true;
    }
    const result = await this.toslaClient.inquiry(creds, toslaBaseUrl(testMode), oid);
    if (!result.ok) {
      throw new ServiceUnavailableException(result.error ?? 'TOSLA yanıt vermedi');
    }
    return { success: true, data: result.data };
  }

  /**
   * TEST ÇEKİMİ — sağlayıcıya göre, müşterinin gördüğü ödeme ekranının aynısını
   * (iframe URL) üretir; gerçek sipariş/işlem yaratmaz (callback no-op). Yeni bir
   * POS eklendiğinde buraya yeni bir dal eklenerek kural sürdürülür.
   */
  async testPayment(key: string, amountTl?: number) {
    const amount =
      typeof amountTl === 'number' && Number.isFinite(amountTl) && amountTl > 0
        ? amountTl
        : 1;
    if (key === PAYTR_PROVIDER_KEY) {
      return { success: true, data: await this.paytr.createTestIframe({ amountTl: amount }) };
    }
    if (key === TOSLA_PROVIDER_KEY) {
      return { success: true, data: await this.tosla.createTestCardSession({ amountTl: amount }) };
    }
    throw new BadRequestException(
      'Test çekimi yalnızca kart sağlayıcıları (PayTR/TOSLA) için kullanılabilir.',
    );
  }
}
