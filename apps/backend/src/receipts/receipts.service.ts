import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PaymentReceipt } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { STORAGE_SERVICE } from '../storage/storage.constants';
import type { IFileStorage } from '../storage/storage.interface';
import { ReceiptNumberService } from './receipt-number.service';
import { BayiNumberService } from './bayi-number.service';
import { CariTopupNumberService } from '../cari-balance/cari-topup-number.service';
import {
  ReceiptPdfService,
  ReceiptKind,
  ReceiptTokens,
} from './receipt-pdf.service';

/** Prisma client (tam) ya da bir transaction client — model erişimleri ortak. */
type Db = PrismaService | Prisma.TransactionClient;

const ORDER_ACIKLAMA = (humanOrderNo: string): string =>
  `${humanOrderNo} numaralı siparişe ait ürün bedeli kredi kartı ile tahsil edilmiştir.`;

const CARI_ACIKLAMA = (tutarLabel: string): string =>
  `Cari hesap bakiyenize kredi kartı ile ${tutarLabel} tutarında yükleme yapılmıştır.`;

const SIGNED_URL_TTL_SEC = 7 * 24 * 60 * 60; // 7 gün — R2 SigV4 üst sınırı.

export interface ReceiptListFilters {
  /** Tenant kapsamı (admin scope). Verilmezse tüm tenantlar. */
  tenantId?: string;
  /** 'order' | 'cari_topup' | undefined (hepsi). */
  kind?: ReceiptKind;
  /** Tek bir bayiye (müşteriye) daralt. */
  customerId?: string;
  /** issuedAt >= from (ISO ya da Date). */
  from?: Date;
  /** issuedAt <= to (ISO ya da Date). */
  to?: Date;
  /** Sayfa boyutu (varsayılan 50, max 200). */
  take?: number;
  /** Atlanacak kayıt (offset). */
  skip?: number;
}

export interface ReceiptDealerOption {
  customerId: string;
  bayiNo: string | null;
  bayiAdi: string;
}

/** Müşteriye dönen makbuz görünümü (PDF signed URL dahil, ham alanlar hariç). */
export interface ReceiptCustomerDto {
  id: string;
  humanReceiptNo: string;
  kind: ReceiptKind;
  amount: number;
  bayiAdi: string;
  bayiId: string;
  kartSahibi: string;
  aciklama: string;
  durum: string;
  posProviderKey: string | null;
  issuedAt: string;
  pdfUrl: string;
}

/**
 * Admin Makbuzlar tablosuna dönen tam satır görünümü. Müşteri DTO'sundan farkı:
 * `customerId`, ilişkili `humanOrderNo`/`humanTopupNo` ve PDF varlığı (`hasPdf`)
 * gibi yönetim alanlarını da içerir. PDF URL'i ayrı `/:id/pdf` endpoint'inden
 * istenir (her satır için signed URL üretmemek adına).
 */
export interface ReceiptAdminDto {
  id: string;
  humanReceiptNo: string;
  kind: ReceiptKind;
  amount: number;
  bayiAdi: string;
  bayiId: string;
  customerId: string;
  kartSahibi: string;
  aciklama: string;
  durum: string;
  posProviderKey: string | null;
  issuedAt: string;
  /** kind === 'order' ise ilişkili siparişin numarası. */
  humanOrderNo: string | null;
  /** kind === 'cari_topup' ise ilişkili yüklemenin numarası. */
  humanTopupNo: string | null;
  /** PDF render edilmiş ve henüz purge edilmemiş mi (lazy üretim göstergesi). */
  hasPdf: boolean;
}

/**
 * Kredi Kartı Tahsilat Makbuzu çekirdek servisi.
 *
 * Sorumluluklar:
 *  - `createForOrder` / `createForTopup`: kart ödemesi onaylanınca (canlı akış)
 *    ya da backfill'de idempotent makbuz satırı üretir. PDF ÜRETMEZ (lazy).
 *  - `ensurePdf`: makbuz PDF'ini ilk istendiğinde üretip storage'a yükler ve
 *    cache'ler (Order pdf pattern); `pdfPurgedAt` set ise yeniden üretir.
 *  - `getByIdForCustomer` / `getForOrderCustomer` / `getForTopupCustomer`:
 *    müşteri-yüzlü erişim (sahiplik kontrolü).
 *  - `list` / `listDealerOptions`: admin Makbuzlar sayfası.
 *
 * EN ÖNEMLİ KURAL: makbuz YALNIZCA kredi kartı işlemlerinde üretilir. Sipariş
 * için `paymentType==='card'`, yükleme için `method==='card'` guard'ı her create
 * yolunda uygulanır — cari/havale işlemlerinde asla makbuz çıkmaz.
 */
@Injectable()
export class ReceiptsService {
  private readonly logger = new Logger(ReceiptsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly receiptNumbers: ReceiptNumberService,
    private readonly bayiNumbers: BayiNumberService,
    private readonly topupNumbers: CariTopupNumberService,
    private readonly pdf: ReceiptPdfService,
    @Inject(STORAGE_SERVICE) private readonly storage: IFileStorage,
  ) {}

  // ─── Create (idempotent) ────────────────────────────────────────────────

  /**
   * Sipariş için makbuz üretir (idempotent). `tx` verilirse o transaction
   * içinde çalışır (canlı ödeme akışı — confirmCardPayment); verilmezse kendi
   * transaction'ını açar (backfill). Zaten makbuz varsa mevcut kaydı döner.
   * Kart dışı / müşterisiz / bulunamayan sipariş → null.
   */
  async createForOrder(
    orderId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<PaymentReceipt | null> {
    if (tx) return this.createForOrderTx(orderId, tx);
    try {
      return await this.prisma.$transaction((t) =>
        this.createForOrderTx(orderId, t),
      );
    } catch (error: unknown) {
      if (this.isUniqueViolation(error)) {
        return this.prisma.paymentReceipt.findUnique({ where: { orderId } });
      }
      throw error;
    }
  }

  /**
   * Kart bakiye yüklemesi için makbuz üretir (idempotent). Davranış
   * `createForOrder` ile aynıdır. Kart dışı / bulunamayan yükleme → null.
   */
  async createForTopup(
    topupId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<PaymentReceipt | null> {
    if (tx) return this.createForTopupTx(topupId, tx);
    try {
      return await this.prisma.$transaction((t) =>
        this.createForTopupTx(topupId, t),
      );
    } catch (error: unknown) {
      if (this.isUniqueViolation(error)) {
        return this.prisma.paymentReceipt.findUnique({ where: { topupId } });
      }
      throw error;
    }
  }

  private async createForOrderTx(
    orderId: string,
    tx: Prisma.TransactionClient,
  ): Promise<PaymentReceipt | null> {
    const existing = await tx.paymentReceipt.findUnique({ where: { orderId } });
    if (existing) return existing;

    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        tenantId: true,
        customerId: true,
        humanOrderNo: true,
        total: true,
        cardCommissionAmount: true,
        posProviderKey: true,
        paymentType: true,
        paidAt: true,
        createdAt: true,
        customer: {
          select: { id: true, name: true, companyTitle: true, bayiNo: true },
        },
        paymentTransactions: {
          where: { kind: 'order', status: 'success' },
          orderBy: { callbackAt: 'desc' },
          take: 1,
          select: {
            totalAmount: true,
            amount: true,
            providerKey: true,
            callbackAt: true,
          },
        },
      },
    });

    if (!order) {
      this.logger.warn(`Makbuz: sipariş bulunamadı (orderId=${orderId})`);
      return null;
    }
    // EN ÖNEMLİ KURAL: yalnızca kredi kartı.
    if (order.paymentType !== 'card') return null;
    if (!order.customerId || !order.customer) {
      this.logger.warn(
        `Makbuz: siparişin müşterisi yok, atlandı (orderId=${orderId})`,
      );
      return null;
    }

    const txn = order.paymentTransactions[0];
    const amount = this.resolveOrderAmount(order);
    // Makbuz tarihi: ödeme anı (paidAt) → POS callback'i (callbackAt) → kayıt
    // tarihi (createdAt). Eski/backfill siparişlerde paidAt NULL ama başarılı POS
    // kaydı olabildiğinden callbackAt güvenilir bir ara fallback'tir.
    const issuedAt =
      order.paidAt ?? txn?.callbackAt ?? order.createdAt ?? new Date();
    const bayiId = await this.ensureBayiNo(order.customer, tx);
    const bayiAdi = this.dealerLabel(order.customer);
    const humanReceiptNo = await this.receiptNumbers.generateHumanReceiptNo(
      this.yearOf(issuedAt),
      tx,
    );

    return tx.paymentReceipt.create({
      data: {
        tenantId: order.tenantId,
        humanReceiptNo,
        kind: 'order',
        orderId: order.id,
        customerId: order.customerId,
        amount,
        posProviderKey: order.posProviderKey ?? txn?.providerKey ?? null,
        bayiAdi,
        bayiId,
        kartSahibi: bayiAdi,
        aciklama: ORDER_ACIKLAMA(order.humanOrderNo),
        durum: 'Onaylandı',
        issuedAt,
      },
    });
  }

  private async createForTopupTx(
    topupId: string,
    tx: Prisma.TransactionClient,
  ): Promise<PaymentReceipt | null> {
    const existing = await tx.paymentReceipt.findUnique({ where: { topupId } });
    if (existing) return existing;

    const topup = await tx.cariTopup.findUnique({
      where: { id: topupId },
      select: {
        id: true,
        customerId: true,
        amount: true,
        method: true,
        chargedAmount: true,
        commissionAmount: true,
        humanTopupNo: true,
        decidedAt: true,
        createdAt: true,
        customer: {
          select: { id: true, name: true, companyTitle: true, bayiNo: true },
        },
        paymentTransactions: {
          where: { kind: 'cari_topup', status: 'success' },
          orderBy: { callbackAt: 'desc' },
          take: 1,
          select: {
            totalAmount: true,
            amount: true,
            providerKey: true,
            tenantId: true,
            callbackAt: true,
          },
        },
      },
    });

    if (!topup) {
      this.logger.warn(`Makbuz: yükleme bulunamadı (topupId=${topupId})`);
      return null;
    }
    // EN ÖNEMLİ KURAL: yalnızca kredi kartı yüklemesi.
    if (topup.method !== 'card') return null;
    if (!topup.customer) {
      this.logger.warn(
        `Makbuz: yüklemenin müşterisi yok, atlandı (topupId=${topupId})`,
      );
      return null;
    }

    const txn = topup.paymentTransactions[0];
    const tenantId = txn?.tenantId ?? (await this.resolveDefaultTenantId(tx));
    if (!tenantId) {
      this.logger.warn(
        `Makbuz: yükleme için tenant çözülemedi, atlandı (topupId=${topupId})`,
      );
      return null;
    }

    const amount = this.resolveTopupAmount(topup);
    // Makbuz tarihi: onay anı (decidedAt) → POS callback'i (callbackAt) → kayıt
    // tarihi (createdAt). Eski/backfill yüklemelerde decidedAt NULL olabilir.
    const issuedAt =
      topup.decidedAt ?? txn?.callbackAt ?? topup.createdAt ?? new Date();
    // ISLEM_NO kalıcı olarak CariTopup.humanTopupNo'da tutulur; eski kart
    // yüklemelerinde NULL olabilir, burada idempotent şekilde garanti edilir.
    await this.ensureTopupNo(topup, tx);
    const bayiId = await this.ensureBayiNo(topup.customer, tx);
    const bayiAdi = this.dealerLabel(topup.customer);
    const humanReceiptNo = await this.receiptNumbers.generateHumanReceiptNo(
      this.yearOf(issuedAt),
      tx,
    );

    return tx.paymentReceipt.create({
      data: {
        tenantId,
        humanReceiptNo,
        kind: 'cari_topup',
        topupId: topup.id,
        customerId: topup.customerId,
        amount,
        posProviderKey: txn?.providerKey ?? null,
        bayiAdi,
        bayiId,
        kartSahibi: bayiAdi,
        aciklama: CARI_ACIKLAMA(this.formatTutar(amount)),
        durum: 'Onaylandı',
        issuedAt,
      },
    });
  }

  // ─── PDF (lazy üretim + cache) ──────────────────────────────────────────

  /**
   * Makbuzun PDF'ini garanti eder ve indirilebilir signed URL döner. PDF daha
   * önce üretilmişse (pdfKey dolu, pdfPurgedAt boş) taze signed URL üretir;
   * yoksa şablondan render eder, storage'a yükler, cache'ler.
   */
  async ensurePdf(receiptId: string): Promise<{ url: string; key: string }> {
    const receipt = await this.prisma.paymentReceipt.findUnique({
      where: { id: receiptId },
      include: {
        order: { select: { humanOrderNo: true } },
        topup: { select: { humanTopupNo: true } },
      },
    });
    if (!receipt) {
      throw new Error(`Makbuz bulunamadı (id=${receiptId})`);
    }

    const needsRender = !receipt.pdfKey || receipt.pdfPurgedAt !== null;
    if (!needsRender && receipt.pdfKey) {
      const url = await this.storage.getSignedUrl(
        receipt.pdfKey,
        SIGNED_URL_TTL_SEC,
      );
      return { url, key: receipt.pdfKey };
    }

    const kind: ReceiptKind = receipt.kind === 'cari_topup' ? 'cari_topup' : 'order';
    const tokens = this.buildTokens(receipt, kind);
    const buffer = await this.pdf.renderPdf(kind, tokens);

    const key = this.pdfKeyFor(receipt.humanReceiptNo, receipt.issuedAt);
    const uploaded = await this.storage.upload(key, buffer, 'application/pdf');

    await this.prisma.paymentReceipt.update({
      where: { id: receipt.id },
      data: { pdfKey: uploaded.key, pdfUrl: uploaded.url, pdfPurgedAt: null },
    });

    const url = await this.storage.getSignedUrl(uploaded.key, SIGNED_URL_TTL_SEC);
    return { url, key: uploaded.key };
  }

  /**
   * Admin PDF erişimi — `ensurePdf` ile aynı işi yapar ama önce makbuzun
   * admin'in tenant'ına ait olduğunu doğrular (tenant izolasyonu). Başka bir
   * tenant'ın makbuzu istenirse hata fırlatır.
   */
  async ensurePdfForAdmin(
    receiptId: string,
    tenantId: string,
  ): Promise<{ url: string; key: string }> {
    const receipt = await this.prisma.paymentReceipt.findUnique({
      where: { id: receiptId },
      select: { id: true, tenantId: true },
    });
    if (!receipt || receipt.tenantId !== tenantId) {
      throw new NotFoundException('Makbuz bulunamadı');
    }
    return this.ensurePdf(receiptId);
  }

  // ─── Müşteri-yüzlü erişim ───────────────────────────────────────────────

  /** Bir müşterinin sahip olduğu makbuzu id ile getirir (sahiplik kontrollü). */
  async getByIdForCustomer(
    receiptId: string,
    customerId: string,
  ): Promise<PaymentReceipt | null> {
    const receipt = await this.prisma.paymentReceipt.findUnique({
      where: { id: receiptId },
    });
    if (!receipt || receipt.customerId !== customerId) return null;
    return receipt;
  }

  /** Bir siparişe ait makbuzu, müşteri sahipliğini doğrulayarak getirir. */
  async getForOrderCustomer(
    orderId: string,
    customerId: string,
  ): Promise<PaymentReceipt | null> {
    const receipt = await this.prisma.paymentReceipt.findUnique({
      where: { orderId },
    });
    if (!receipt || receipt.customerId !== customerId) return null;
    return receipt;
  }

  /** Bir yüklemeye ait makbuzu, müşteri sahipliğini doğrulayarak getirir. */
  async getForTopupCustomer(
    topupId: string,
    customerId: string,
  ): Promise<PaymentReceipt | null> {
    const receipt = await this.prisma.paymentReceipt.findUnique({
      where: { topupId },
    });
    if (!receipt || receipt.customerId !== customerId) return null;
    return receipt;
  }

  /**
   * Verilen sipariş id kümesinden hangilerinin makbuzu olduğunu döner
   * (sipariş listesi ikonu için — N+1 önler).
   */
  async orderIdsWithReceipt(orderIds: string[]): Promise<Set<string>> {
    if (orderIds.length === 0) return new Set();
    const rows = await this.prisma.paymentReceipt.findMany({
      where: { orderId: { in: orderIds } },
      select: { orderId: true },
    });
    return new Set(rows.map((r) => r.orderId).filter((id): id is string => !!id));
  }

  /**
   * Verilen yükleme id kümesinden hangilerinin makbuzu olduğunu döner
   * (cari geçmiş / yükleme listesi ikonu için — N+1 önler).
   */
  async topupIdsWithReceipt(topupIds: string[]): Promise<Set<string>> {
    if (topupIds.length === 0) return new Set();
    const rows = await this.prisma.paymentReceipt.findMany({
      where: { topupId: { in: topupIds } },
      select: { topupId: true },
    });
    return new Set(rows.map((r) => r.topupId).filter((id): id is string => !!id));
  }

  /**
   * Müşteri-yüzlü makbuz DTO'su — sahiplik doğrulanmış bir kayıt + taze signed
   * URL'den serileştirir. Müşteriye ham tenant/pdfKey alanları sızdırılmaz.
   */
  serializeForCustomer(
    receipt: PaymentReceipt,
    pdfUrl: string,
  ): ReceiptCustomerDto {
    return {
      id: receipt.id,
      humanReceiptNo: receipt.humanReceiptNo,
      kind: receipt.kind === 'cari_topup' ? 'cari_topup' : 'order',
      amount: this.toNumber(receipt.amount),
      bayiAdi: receipt.bayiAdi,
      bayiId: receipt.bayiId,
      kartSahibi: receipt.kartSahibi,
      aciklama: receipt.aciklama,
      durum: receipt.durum,
      posProviderKey: receipt.posProviderKey,
      issuedAt: receipt.issuedAt.toISOString(),
      pdfUrl,
    };
  }

  // ─── Admin liste ────────────────────────────────────────────────────────

  /** Admin Makbuzlar tablosu — filtreli, sayfalı liste + toplam. */
  async list(
    filters: ReceiptListFilters,
  ): Promise<{ items: PaymentReceipt[]; total: number }> {
    const where = this.buildWhere(filters);
    const take = Math.min(Math.max(filters.take ?? 50, 1), 200);
    const skip = Math.max(filters.skip ?? 0, 0);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.paymentReceipt.findMany({
        where,
        orderBy: { issuedAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.paymentReceipt.count({ where }),
    ]);
    return { items, total };
  }

  /**
   * Makbuzu olan bayilerin dropdown listesi (admin filtre). Yalnızca en az bir
   * makbuzu bulunan müşteriler döner; tenant scope opsiyonel.
   */
  async listDealerOptions(tenantId?: string): Promise<ReceiptDealerOption[]> {
    const grouped = await this.prisma.paymentReceipt.groupBy({
      by: ['customerId'],
      where: tenantId ? { tenantId } : undefined,
    });
    const customerIds = grouped.map((g) => g.customerId);
    if (customerIds.length === 0) return [];
    const customers = await this.prisma.customer.findMany({
      where: { id: { in: customerIds } },
      select: { id: true, name: true, companyTitle: true, bayiNo: true },
    });
    return customers
      .map((c) => ({
        customerId: c.id,
        bayiNo: c.bayiNo,
        bayiAdi: this.dealerLabel(c),
      }))
      .sort((a, b) => a.bayiAdi.localeCompare(b.bayiAdi, 'tr'));
  }

  /**
   * Admin Makbuzlar tablosu — `list` ile aynı filtreyi kullanır ama satırları
   * ilişkili sipariş/yükleme numaralarıyla birlikte `ReceiptAdminDto`'ya
   * serileştirir. Tablo tüm sütunları gösterebilsin diye relation'lar dahil.
   */
  async listForAdmin(
    filters: ReceiptListFilters,
  ): Promise<{ items: ReceiptAdminDto[]; total: number }> {
    const where = this.buildWhere(filters);
    const take = Math.min(Math.max(filters.take ?? 50, 1), 200);
    const skip = Math.max(filters.skip ?? 0, 0);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.paymentReceipt.findMany({
        where,
        orderBy: { issuedAt: 'desc' },
        take,
        skip,
        include: {
          order: { select: { humanOrderNo: true } },
          topup: { select: { humanTopupNo: true } },
        },
      }),
      this.prisma.paymentReceipt.count({ where }),
    ]);
    return { items: rows.map((r) => this.serializeForAdmin(r)), total };
  }

  /** Admin tablo satırı — ham PaymentReceipt + relation'lardan DTO üretir. */
  serializeForAdmin(
    receipt: PaymentReceipt & {
      order: { humanOrderNo: string } | null;
      topup: { humanTopupNo: string | null } | null;
    },
  ): ReceiptAdminDto {
    return {
      id: receipt.id,
      humanReceiptNo: receipt.humanReceiptNo,
      kind: receipt.kind === 'cari_topup' ? 'cari_topup' : 'order',
      amount: this.toNumber(receipt.amount),
      bayiAdi: receipt.bayiAdi,
      bayiId: receipt.bayiId,
      customerId: receipt.customerId,
      kartSahibi: receipt.kartSahibi,
      aciklama: receipt.aciklama,
      durum: receipt.durum,
      posProviderKey: receipt.posProviderKey,
      issuedAt: receipt.issuedAt.toISOString(),
      humanOrderNo: receipt.order?.humanOrderNo ?? null,
      humanTopupNo: receipt.topup?.humanTopupNo ?? null,
      hasPdf: receipt.pdfKey != null && receipt.pdfPurgedAt == null,
    };
  }

  private buildWhere(
    filters: ReceiptListFilters,
  ): Prisma.PaymentReceiptWhereInput {
    const where: Prisma.PaymentReceiptWhereInput = {};
    if (filters.tenantId) where.tenantId = filters.tenantId;
    if (filters.kind) where.kind = filters.kind;
    if (filters.customerId) where.customerId = filters.customerId;
    if (filters.from || filters.to) {
      where.issuedAt = {};
      if (filters.from) where.issuedAt.gte = filters.from;
      if (filters.to) where.issuedAt.lte = filters.to;
    }
    return where;
  }

  // ─── Token / PDF anahtarı ───────────────────────────────────────────────

  private buildTokens(
    receipt: PaymentReceipt & {
      order: { humanOrderNo: string } | null;
      topup: { humanTopupNo: string | null } | null;
    },
    kind: ReceiptKind,
  ): ReceiptTokens {
    const base: ReceiptTokens = {
      MAKBUZ_NO: receipt.humanReceiptNo,
      TARIH: this.formatDate(receipt.issuedAt),
      SAAT: this.formatTime(receipt.issuedAt),
      TUTAR: this.formatTutar(receipt.amount),
      BAYI_ADI: receipt.bayiAdi,
      BAYI_ID: receipt.bayiId,
      KART_SAHIBI: receipt.kartSahibi,
      DURUM: receipt.durum,
      ACIKLAMA: receipt.aciklama,
    };
    if (kind === 'order') {
      return { ...base, SIPARIS_NO: receipt.order?.humanOrderNo ?? '' };
    }
    return { ...base, ISLEM_NO: receipt.topup?.humanTopupNo ?? '' };
  }

  private pdfKeyFor(humanReceiptNo: string, issuedAt: Date): string {
    const year = this.yearOf(issuedAt);
    const safe = humanReceiptNo.replace(/[^A-Za-z0-9._-]/g, '_');
    return `receipts/${year}/${safe}.pdf`;
  }

  // ─── Tutar / firma / numara yardımcıları ────────────────────────────────

  private resolveOrderAmount(order: {
    humanOrderNo: string | null;
    total: Prisma.Decimal | null;
    cardCommissionAmount: Prisma.Decimal | null;
    paymentTransactions: { totalAmount: Prisma.Decimal | null; amount: Prisma.Decimal | null }[];
  }): Prisma.Decimal {
    const txn = order.paymentTransactions[0];
    if (txn?.totalAmount != null) return new Prisma.Decimal(txn.totalAmount);
    if (txn?.amount != null) return new Prisma.Decimal(txn.amount);
    const total = new Prisma.Decimal(order.total ?? 0);
    // Komisyon-dahil otorite (POS kaydı) yok. cardCommissionAmount da NULL ise
    // komisyon DOĞRULANAMAZ → EN ÖNEMLİ KURAL (makbuz = komisyon dahil) riske
    // girer. Tutarı DEĞİŞTİRMEDEN (total gerçekten komisyonsuz olabilir) sesli
    // uyar; denetimde fark edilebilsin.
    if (order.cardCommissionAmount == null) {
      this.logger.warn(
        `Makbuz tutarı: sipariş ${order.humanOrderNo ?? '—'} için komisyon ` +
          `doğrulanamadı (POS kaydı + cardCommissionAmount yok); tutar=` +
          `${total.toString()} (yalnızca sipariş toplamı, komisyon hariç).`,
      );
      return total;
    }
    return total.plus(new Prisma.Decimal(order.cardCommissionAmount));
  }

  private resolveTopupAmount(topup: {
    humanTopupNo: string | null;
    amount: Prisma.Decimal | null;
    chargedAmount: Prisma.Decimal | null;
    commissionAmount: Prisma.Decimal | null;
    paymentTransactions: { totalAmount: Prisma.Decimal | null; amount: Prisma.Decimal | null }[];
  }): Prisma.Decimal {
    if (topup.chargedAmount != null) return new Prisma.Decimal(topup.chargedAmount);
    if (topup.amount != null) {
      const base = new Prisma.Decimal(topup.amount);
      const comm =
        topup.commissionAmount != null
          ? new Prisma.Decimal(topup.commissionAmount)
          : new Prisma.Decimal(0);
      return base.plus(comm);
    }
    const txn = topup.paymentTransactions[0];
    if (txn?.totalAmount != null) return new Prisma.Decimal(txn.totalAmount);
    if (txn?.amount != null) return new Prisma.Decimal(txn.amount);
    // Hiçbir tutar kaynağı yok → 0. Sıfır tutarlı makbuz neredeyse kesin
    // hatadır; idempotency için kayıt yine de kesilir ama sesli uyarılır.
    this.logger.warn(
      `Makbuz tutarı: yükleme ${topup.humanTopupNo ?? '—'} için tutar ` +
        `çözülemedi (chargedAmount/amount/POS kaydı yok); tutar=0 kesiliyor.`,
    );
    return new Prisma.Decimal(0);
  }

  private dealerLabel(customer: {
    name: string;
    companyTitle: string | null;
  }): string {
    const company = customer.companyTitle?.trim();
    return company && company.length > 0 ? company : customer.name;
  }

  private async ensureBayiNo(
    customer: { id: string; bayiNo: string | null },
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    if (customer.bayiNo) return customer.bayiNo;
    const bayiNo = await this.bayiNumbers.generateBayiNo(tx);
    await tx.customer.update({ where: { id: customer.id }, data: { bayiNo } });
    return bayiNo;
  }

  private async ensureTopupNo(
    topup: { id: string; humanTopupNo: string | null },
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    if (topup.humanTopupNo) return topup.humanTopupNo;
    const humanTopupNo = await this.topupNumbers.generateHumanTopupNo(tx);
    await tx.cariTopup.update({
      where: { id: topup.id },
      data: { humanTopupNo },
    });
    return humanTopupNo;
  }

  private async resolveDefaultTenantId(client: Db): Promise<string | null> {
    const slug = process.env.DEFAULT_TENANT_SLUG ?? 'acme';
    const bySlug = await client.tenant.findFirst({
      where: { slug },
      select: { id: true },
    });
    if (bySlug) return bySlug.id;
    const first = await client.tenant.findFirst({ select: { id: true } });
    return first?.id ?? null;
  }

  // ─── Biçimlendirme ──────────────────────────────────────────────────────

  private formatTutar(value: Prisma.Decimal | number | null): string {
    const formatted = new Intl.NumberFormat('tr-TR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(this.toNumber(value));
    return `${formatted} TL`;
  }

  private formatDate(date: Date): string {
    return new Intl.DateTimeFormat('tr-TR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'Europe/Istanbul',
    }).format(date);
  }

  private formatTime(date: Date): string {
    return new Intl.DateTimeFormat('tr-TR', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Europe/Istanbul',
    }).format(date);
  }

  private yearOf(date: Date): number {
    const s = new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      timeZone: 'Europe/Istanbul',
    }).format(date);
    const n = Number(s);
    return Number.isFinite(n) && n > 0 ? n : new Date().getFullYear();
  }

  private toNumber(value: Prisma.Decimal | number | string | null | undefined): number {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'number') return value;
    const n = Number(value.toString());
    return Number.isFinite(n) ? n : 0;
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }
}
