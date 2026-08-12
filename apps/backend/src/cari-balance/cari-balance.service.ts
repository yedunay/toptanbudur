import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, CariLedgerType } from '@prisma/client';
import type { Request } from 'express';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import {
  AdminNotifierService,
  OPS_NOTIFY_ROLES,
} from '../mail/admin-notifier.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CariTopupNumberService } from './cari-topup-number.service';
import { ReceiptsService } from '../receipts/receipts.service';
import { BankAccountUpsertDto, BankAccountUpdateDto } from './dto/bank-account.dto';
import { CariStatementQueryDto } from './dto/cari-statement.dto';
import { trDateRange, trTodayKey } from '../common/utils/tr-time';

function formatTry(amount: number): string {
  return new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function customerLabel(c: { name?: string | null; email?: string | null }): string {
  return c.name?.trim() || c.email?.trim() || 'müşteri';
}

const ALLOWED_TOPUP_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
type TopupStatus = (typeof ALLOWED_TOPUP_STATUSES)[number];

const MIN_TOPUP_AMOUNT = 1;
const MAX_TOPUP_AMOUNT = 1_000_000;

// Admin manuel bakiye düzeltmesi sınırları (negatif = borç bakiyesi mümkün).
const MIN_ADJUSTED_BALANCE = -1_000_000;
const MAX_ADJUSTED_BALANCE = 10_000_000;

// Hediye bakiye sınırları — girilen tutar EKLENECEK pozitif hediyedir (mutlak
// bakiye değil). Fat-finger'a karşı üst sınır; kampanyalarda esnek kalsın diye
// yüklemeyle aynı tavan kullanılır.
const MIN_GIFT_AMOUNT = 1;
const MAX_GIFT_AMOUNT = 1_000_000;

/**
 * 2 ondalık basamaklı yuvarlama (Decimal kalıyor — JS Number hassasiyet kaybı yok).
 *
 * ROUND_HALF_UP modunu açıkça geçiyoruz: davranış, decimal.js global rounding
 * varsayılanına (4 = HALF_UP) örtük bağlı kalmak yerine sabitlenir. Çıktı tüm
 * gerçek girdiler için eski `toFixed(2)` ile birebir aynıdır (hesaplanan hiçbir
 * bakiye/komisyon/iade değeri değişmez).
 */
function decimalRound2(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

function normalizeIban(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

@Injectable()
export class CariBalanceService {
  private readonly logger = new Logger(CariBalanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly adminNotifier: AdminNotifierService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly topupNumbers: CariTopupNumberService,
    private readonly receipts: ReceiptsService,
  ) {}

  // ---------- CUSTOMER FACING ----------

  async getBalanceForCustomer(customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, cariBalance: true, name: true, email: true },
    });
    if (!customer) throw new NotFoundException('customer not found');
    return {
      success: true,
      data: {
        balance: Number(customer.cariBalance),
        currency: 'TRY',
      },
    };
  }

  /**
   * Bakiyem sayfası üst metrikleri için tek sorgu kümesi.
   * Aggregation TÜM tablodan yapılır — frontend asla paginated slice üzerinden
   * topla­ma yapmaz (önceki hata: 50 satırlık sayfa üzerinden ay başı topla­ması
   * yanlış sonuç veriyordu).
   *
   * Tüm tarih hesapları Europe/Istanbul TZ varsayımı yerine UTC üzerinden yapılır;
   * "ay başı" = UTC ay başlangıcı, "son 30 gün" = şimdiden 30 gün geriye sayar.
   */
  async getSummaryForCustomer(customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, cariBalance: true },
    });
    if (!customer) throw new NotFoundException('customer not found');

    const now = new Date();
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const last30Start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      monthlyTopupAgg,
      monthlyOrderAgg,
      last30OrderAgg,
      lifetimeTopupAgg,
      lifetimeOrderAgg,
      pendingTopupAgg,
      lastApprovedTopup,
      lastOrderPayment,
      lifetimeOrderCount,
      giftAgg,
      lastGift,
    ] = await Promise.all([
      this.prisma.cariLedger.aggregate({
        where: {
          customerId,
          type: 'TOPUP',
          createdAt: { gte: monthStart },
        },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.cariLedger.aggregate({
        where: {
          customerId,
          type: 'ORDER_PAYMENT',
          createdAt: { gte: monthStart },
        },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.cariLedger.aggregate({
        where: {
          customerId,
          type: 'ORDER_PAYMENT',
          createdAt: { gte: last30Start },
        },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.cariLedger.aggregate({
        where: { customerId, type: 'TOPUP' },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.cariLedger.aggregate({
        where: { customerId, type: 'ORDER_PAYMENT' },
        _sum: { amount: true },
      }),
      this.prisma.cariTopup.aggregate({
        // "Bekleyen yükleme" özeti = yalnız havale/EFT talepleri; kart
        // denemeleri geçici ara durumdur, özet sayaca girmez.
        where: { customerId, status: 'PENDING', method: { not: 'card' } },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.cariLedger.findFirst({
        where: { customerId, type: 'TOPUP' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, amount: true, createdAt: true, description: true },
      }),
      this.prisma.cariLedger.findFirst({
        where: { customerId, type: 'ORDER_PAYMENT' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, amount: true, createdAt: true, description: true },
      }),
      this.prisma.cariLedger.count({
        where: { customerId, type: 'ORDER_PAYMENT' },
      }),
      // HEDİYE BAKİYE — ömür boyu tanımlanan toplam (kampanya rozeti için).
      this.prisma.cariLedger.aggregate({
        where: { customerId, isGift: true, amount: { gt: 0 } },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.cariLedger.findFirst({
        where: { customerId, isGift: true },
        orderBy: { createdAt: 'desc' },
        select: { id: true, amount: true, createdAt: true, description: true },
      }),
    ]);

    const toAbsNumber = (d: Prisma.Decimal | null): number => {
      if (!d) return 0;
      return Math.abs(Number(d));
    };

    return {
      success: true,
      data: {
        balance: Number(customer.cariBalance),
        currency: 'TRY',
        monthly: {
          topupSum: Number(monthlyTopupAgg._sum.amount ?? 0),
          topupCount: monthlyTopupAgg._count._all,
          usageSum: toAbsNumber(monthlyOrderAgg._sum.amount),
          usageCount: monthlyOrderAgg._count._all,
        },
        last30Days: {
          usageSum: toAbsNumber(last30OrderAgg._sum.amount),
          usageCount: last30OrderAgg._count._all,
        },
        lifetime: {
          topupSum: Number(lifetimeTopupAgg._sum.amount ?? 0),
          topupCount: lifetimeTopupAgg._count._all,
          usageSum: toAbsNumber(lifetimeOrderAgg._sum.amount),
          orderDeductionCount: lifetimeOrderCount,
        },
        pendingTopup: {
          sum: Number(pendingTopupAgg._sum.amount ?? 0),
          count: pendingTopupAgg._count._all,
        },
        // HEDİYE BAKİYE — müşteri panelinde "🎁 HEDİYE BAKİYE" kampanya rozeti
        // için: ömür boyu tanımlanan toplam + son hediye tutarı/tarihi.
        gift: {
          total: Number(giftAgg._sum.amount ?? 0),
          count: giftAgg._count._all,
          lastAmount: lastGift ? Number(lastGift.amount) : null,
          lastAt: lastGift?.createdAt ?? null,
        },
        lastTopup: lastApprovedTopup
          ? {
              id: lastApprovedTopup.id,
              amount: Number(lastApprovedTopup.amount),
              createdAt: lastApprovedTopup.createdAt,
              description: lastApprovedTopup.description,
            }
          : null,
        lastOrderPayment: lastOrderPayment
          ? {
              id: lastOrderPayment.id,
              amount: Math.abs(Number(lastOrderPayment.amount)),
              createdAt: lastOrderPayment.createdAt,
              description: lastOrderPayment.description,
            }
          : null,
      },
    };
  }

  /**
   * Müşteri "Ödeme Geçmişim" tablosu için sayfalı + filtreli liste.
   *
   * Filtreler:
   *  - type: TOPUP | ORDER_PAYMENT | REFUND | ADJUSTMENT
   *  - status (sadece TOPUP için anlamlı): PENDING / APPROVED / REJECTED
   *      - PENDING: CariLedger'a hiç yazılmamış olan CariTopup PENDING kayıtlar
   *      - REJECTED: CariTopup REJECTED — ledger'da yok
   *      - APPROVED veya boş: gerçek ledger
   *  - from / to: tarih aralığı (createdAt bazlı; ISO string kabul eder)
   *
   * pageSize maksimum 200 — müşterinin tek sayfada geniş geçmiş görmesi içindir
   * (önceki 100 sınırı sebepsiz dardı).
   */
  async listLedgerForCustomer(
    customerId: string,
    params: {
      page?: number;
      pageSize?: number;
      type?: string;
      status?: string;
      from?: string;
      to?: string;
    } = {},
  ) {
    const safePage = Math.max(1, params.page ?? 1);
    const safeSize = Math.min(200, Math.max(1, params.pageSize ?? 20));

    const ALLOWED_TYPES = [
      'TOPUP',
      'ORDER_PAYMENT',
      'REFUND',
      'ADJUSTMENT',
    ] as const;
    type LedgerType = (typeof ALLOWED_TYPES)[number];

    let typeFilter: LedgerType | undefined;
    if (params.type) {
      const upper = params.type.toUpperCase();
      if (!ALLOWED_TYPES.includes(upper as LedgerType)) {
        throw new BadRequestException('invalid type filter');
      }
      typeFilter = upper as LedgerType;
    }

    let statusFilter: TopupStatus | undefined;
    if (params.status) {
      const upper = params.status.toUpperCase();
      if (!ALLOWED_TOPUP_STATUSES.includes(upper as TopupStatus)) {
        throw new BadRequestException('invalid status filter');
      }
      statusFilter = upper as TopupStatus;
    }

    const parseDate = (value: string | undefined): Date | undefined => {
      if (!value) return undefined;
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) {
        throw new BadRequestException('invalid date filter');
      }
      return d;
    };
    const fromDate = parseDate(params.from);
    const toDate = parseDate(params.to);

    const dateRange: Prisma.DateTimeFilter | undefined =
      fromDate || toDate
        ? { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) }
        : undefined;

    // status=PENDING: ledger'da yok — sadece CariTopup PENDING
    if (statusFilter === 'PENDING') {
      if (typeFilter && typeFilter !== 'TOPUP') {
        return {
          success: true,
          data: [],
          meta: { total: 0, page: safePage, limit: safeSize, totalPages: 1 },
        };
      }
      const topupWhere: Prisma.CariTopupWhereInput = {
        customerId,
        status: 'PENDING',
        // Kart denemeleri geçici POS ara durumudur — müşteri hareket
        // listesinde "bekleyen havale" gibi GÖRÜNMEZ (kendi ödeme akışı var).
        method: { not: 'card' },
      };
      if (dateRange) {
        topupWhere.requestedAt = dateRange;
      }

      const [total, pendingRows] = await Promise.all([
        this.prisma.cariTopup.count({ where: topupWhere }),
        this.prisma.cariTopup.findMany({
          where: topupWhere,
          orderBy: { requestedAt: 'desc' },
          skip: (safePage - 1) * safeSize,
          take: safeSize,
          select: {
            id: true,
            humanTopupNo: true,
            amount: true,
            status: true,
            customerNote: true,
            adminNote: true,
            requestedAt: true,
            decidedAt: true,
          },
        }),
      ]);

      return {
        success: true,
        data: pendingRows.map((t) => ({
          id: `topup:${t.id}`,
          type: 'TOPUP' as const,
          amount: Number(t.amount),
          balanceAfter: null as number | null,
          description: t.customerNote ?? 'Bakiye yükleme talebi (bekliyor)',
          createdAt: t.requestedAt,
          orderId: null as string | null,
          topupId: t.id,
          humanTopupNo: t.humanTopupNo,
          humanOrderNo: null as string | null,
          topupStatus: 'PENDING' as const,
        })),
        meta: {
          total,
          page: safePage,
          limit: safeSize,
          totalPages: Math.max(1, Math.ceil(total / safeSize)),
        },
      };
    }

    // status=REJECTED: ledger'da yok — sadece CariTopup REJECTED
    if (statusFilter === 'REJECTED') {
      if (typeFilter && typeFilter !== 'TOPUP') {
        return {
          success: true,
          data: [],
          meta: { total: 0, page: safePage, limit: safeSize, totalPages: 1 },
        };
      }
      const topupWhere: Prisma.CariTopupWhereInput = {
        customerId,
        status: 'REJECTED',
        // Otomatik kapanan kart denemeleri müşteri geçmişinde listelenmez.
        method: { not: 'card' },
      };
      if (dateRange) {
        topupWhere.OR = [
          { decidedAt: dateRange },
          { requestedAt: dateRange },
        ];
      }

      const [total, rejectedRows] = await Promise.all([
        this.prisma.cariTopup.count({ where: topupWhere }),
        this.prisma.cariTopup.findMany({
          where: topupWhere,
          orderBy: { decidedAt: 'desc' },
          skip: (safePage - 1) * safeSize,
          take: safeSize,
          select: {
            id: true,
            humanTopupNo: true,
            amount: true,
            status: true,
            customerNote: true,
            adminNote: true,
            requestedAt: true,
            decidedAt: true,
          },
        }),
      ]);

      return {
        success: true,
        data: rejectedRows.map((t) => ({
          id: `topup:${t.id}`,
          type: 'TOPUP' as const,
          amount: Number(t.amount),
          balanceAfter: null as number | null,
          description: t.adminNote
            ? `Yükleme reddedildi — ${t.adminNote}`
            : 'Yükleme reddedildi',
          createdAt: t.decidedAt ?? t.requestedAt,
          orderId: null as string | null,
          topupId: t.id,
          humanTopupNo: t.humanTopupNo,
          humanOrderNo: null as string | null,
          topupStatus: 'REJECTED' as const,
        })),
        meta: {
          total,
          page: safePage,
          limit: safeSize,
          totalPages: Math.max(1, Math.ceil(total / safeSize)),
        },
      };
    }

    // status=APPROVED veya filtre yok: gerçek ledger sorgusu
    const where: Prisma.CariLedgerWhereInput = { customerId };
    if (typeFilter) where.type = typeFilter;
    if (dateRange) where.createdAt = dateRange;

    const [total, rows] = await Promise.all([
      this.prisma.cariLedger.count({ where }),
      this.prisma.cariLedger.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (safePage - 1) * safeSize,
        take: safeSize,
        select: {
          id: true,
          type: true,
          amount: true,
          balanceAfter: true,
          description: true,
          createdAt: true,
          orderId: true,
          topupId: true,
          isGift: true,
          order: {
            select: { id: true, humanOrderNo: true },
          },
          topup: {
            select: { humanTopupNo: true, method: true },
          },
        },
      }),
    ]);

    // Makbuzu olan kart yüklemelerine küçük ikon için — yalnızca TOPUP
    // satırlarının topupId'lerini toplayıp tek sorguda çözeriz (N+1 yok).
    // Makbuz yalnızca kart yüklemelerinde var olduğundan, havale TOPUP
    // satırları bu kümede doğal olarak yer almaz.
    const ledgerTopupIds = rows
      .map((r) => r.topupId)
      .filter((id): id is string => !!id);
    const ledgerReceiptTopupIds =
      await this.receipts.topupIdsWithReceipt(ledgerTopupIds);

    return {
      success: true,
      data: rows.map((r) => ({
        id: r.id,
        type: r.type,
        amount: Number(r.amount),
        balanceAfter: Number(r.balanceAfter),
        description: r.description,
        createdAt: r.createdAt,
        orderId: r.orderId,
        topupId: r.topupId,
        humanOrderNo: r.order?.humanOrderNo ?? null,
        humanTopupNo: r.topup?.humanTopupNo ?? null,
        // 'bank_transfer' | 'card' — bakiye hareketinde yöntem rozeti için.
        topupMethod: r.topup?.method ?? null,
        topupStatus: r.type === 'TOPUP' ? ('APPROVED' as const) : null,
        // Hediye bakiye kaydı mı? Müşteri panelinde "🎁 Hediye Bakiye" etiketi için.
        isGift: r.isGift,
        hasReceipt: r.topupId ? ledgerReceiptTopupIds.has(r.topupId) : false,
      })),
      meta: {
        total,
        page: safePage,
        limit: safeSize,
        totalPages: Math.max(1, Math.ceil(total / safeSize)),
      },
    };
  }

  async listTopupsForCustomer(
    customerId: string,
    page = 1,
    pageSize = 20,
  ) {
    const safePage = Math.max(1, page);
    const safeSize = Math.min(100, Math.max(1, pageSize));

    const [total, rows] = await Promise.all([
      this.prisma.cariTopup.count({ where: { customerId } }),
      this.prisma.cariTopup.findMany({
        where: { customerId },
        orderBy: { requestedAt: 'desc' },
        skip: (safePage - 1) * safeSize,
        take: safeSize,
        select: {
          id: true,
          humanTopupNo: true,
          amount: true,
          status: true,
          customerNote: true,
          adminNote: true,
          requestedAt: true,
          decidedAt: true,
          bankAccount: {
            select: {
              id: true,
              bankName: true,
              accountName: true,
              iban: true,
            },
          },
        },
      }),
    ]);

    // Makbuzu olan kart yüklemelerine küçük ikon için — tek sorguda çöz.
    const topupReceiptIds = await this.receipts.topupIdsWithReceipt(
      rows.map((r) => r.id),
    );

    return {
      success: true,
      data: rows.map((r) => ({
        id: r.id,
        humanTopupNo: r.humanTopupNo,
        amount: Number(r.amount),
        status: r.status,
        customerNote: r.customerNote,
        adminNote: r.adminNote,
        requestedAt: r.requestedAt,
        decidedAt: r.decidedAt,
        bankAccount: r.bankAccount,
        hasReceipt: topupReceiptIds.has(r.id),
      })),
      meta: {
        total,
        page: safePage,
        limit: safeSize,
        totalPages: Math.ceil(total / safeSize),
      },
    };
  }

  /**
   * Müşterinin kart yüklemesine ait tahsilat makbuzunu döner (PDF signed URL
   * dahil). Sahiplik kontrolü ReceiptsService.getForTopupCustomer içinde
   * customerId ile yapılır; başkasının makbuzu sızdırılmaz.
   */
  async getTopupReceiptForCustomer(customerId: string, topupId: string) {
    const receipt = await this.receipts.getForTopupCustomer(
      topupId,
      customerId,
    );
    if (!receipt) throw new NotFoundException('receipt not found');
    const { url } = await this.receipts.ensurePdf(receipt.id);
    return {
      success: true,
      data: this.receipts.serializeForCustomer(receipt, url),
    };
  }

  async listActiveBankAccounts() {
    const rows = await this.prisma.bankAccount.findMany({
      where: { active: true },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        bankName: true,
        accountName: true,
        iban: true,
        branchCode: true,
        accountNo: true,
        note: true,
      },
    });
    return { success: true, data: rows };
  }

  /**
   * KART ile cari yükleme talebi (PayTR).
   *
   * amount = CARİYE EKLENECEK net tutar. Müşteriye aktif POS'un SİTE
   * komisyon oranı yansıtılır: chargedAmount = amount + commission.
   * Örn. 1.000 yükleme, %3 → 30 komisyon → karttan 1.030 çekilir,
   * success'te cariye 1.000 eklenir. Komisyon CARİYE EKLENMEZ, iade edilmez.
   * Onay AKIŞI YOK — PayTR callback'i systemApproveCardTopup ile otomatik
   * onaylar. Havale/EFT akışına (createTopupRequest) dokunulmaz.
   */
  async createCardTopupRequest(params: { customerId: string; amount: number }) {
    const amount = Number(params.amount);
    if (
      !Number.isFinite(amount) ||
      amount < MIN_TOPUP_AMOUNT ||
      amount > MAX_TOPUP_AMOUNT
    ) {
      throw new BadRequestException('invalid topup amount');
    }

    const customer = await this.prisma.customer.findUnique({
      where: { id: params.customerId },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('customer not found');

    const activePos = await this.prisma.posProvider.findFirst({
      where: { active: true },
      select: { customerCommissionRate: true },
    });
    if (!activePos) {
      throw new BadRequestException(
        'Kart ile yükleme şu anda kullanılamıyor — lütfen havale/EFT kullanın.',
      );
    }

    const amountDecimal = decimalRound2(new Prisma.Decimal(amount));
    const rate = activePos.customerCommissionRate ?? new Prisma.Decimal(0);
    const commission = decimalRound2(amountDecimal.mul(rate).div(100));
    const charged = decimalRound2(amountDecimal.add(commission));

    const created = await this.prisma.$transaction(async (tx) => {
      const humanTopupNo = await this.topupNumbers.generateHumanTopupNo(tx);
      return tx.cariTopup.create({
        data: {
          humanTopupNo,
          customerId: customer.id,
          amount: amountDecimal,
          method: 'card',
          commissionRate: rate,
          commissionAmount: commission,
          chargedAmount: charged,
          status: 'PENDING',
        },
        select: {
          id: true,
          humanTopupNo: true,
          amount: true,
          commissionRate: true,
          commissionAmount: true,
          chargedAmount: true,
          status: true,
        },
      });
    });

    return {
      success: true,
      data: {
        topupId: created.id,
        humanTopupNo: created.humanTopupNo,
        amount: Number(created.amount),
        commissionRate: Number(created.commissionRate ?? 0),
        commissionAmount: Number(created.commissionAmount ?? 0),
        chargedAmount: Number(created.chargedAmount ?? created.amount),
        status: created.status,
      },
    };
  }

  /** Kart ödeme sonuç sayfasının poll ettiği tekil talep durumu. */
  async getTopupStatusForCustomer(customerId: string, topupId: string) {
    const topup = await this.prisma.cariTopup.findUnique({
      where: { id: topupId },
      select: {
        id: true,
        customerId: true,
        humanTopupNo: true,
        amount: true,
        method: true,
        commissionAmount: true,
        chargedAmount: true,
        status: true,
      },
    });
    if (!topup || topup.customerId !== customerId) {
      throw new NotFoundException('Yükleme talebi bulunamadı');
    }
    return {
      success: true,
      data: {
        id: topup.id,
        humanTopupNo: topup.humanTopupNo,
        amount: Number(topup.amount),
        method: topup.method,
        commissionAmount: topup.commissionAmount
          ? Number(topup.commissionAmount)
          : null,
        chargedAmount: topup.chargedAmount ? Number(topup.chargedAmount) : null,
        status: topup.status,
      },
    };
  }

  /**
   * Kart yüklemesinin SİSTEM onayı — yalnızca PayTR callback'i (success)
   * çağırır. İdempotent: PENDING değilse no-op. Cariye topup.amount eklenir
   * (komisyon HARİÇ), ledger TOPUP yazılır, status APPROVED olur.
   */
  async systemApproveCardTopup(topupId: string): Promise<{
    approved: boolean;
    reason?: string;
  }> {
    const result = await this.prisma.$transaction(async (tx) => {
      const topup = await tx.cariTopup.findUnique({
        where: { id: topupId },
        select: {
          id: true,
          customerId: true,
          amount: true,
          method: true,
          status: true,
          humanTopupNo: true,
        },
      });
      if (!topup) return { approved: false, reason: 'not-found' };
      if (topup.method !== 'card') return { approved: false, reason: 'not-card' };
      if (topup.status !== 'PENDING') {
        return { approved: false, reason: `status:${topup.status}` };
      }

      // ATOMİK CLAIM: status hâlâ PENDING ise APPROVED'a çevir — eşzamanlı
      // ikinci callback/reconcile aynı topup'ı İKİNCİ kez kredilendiremez
      // (yukarıdaki read-then-act tek başına yarışa açıktı).
      const claimed = await tx.cariTopup.updateMany({
        where: { id: topup.id, status: 'PENDING' },
        data: {
          status: 'APPROVED',
          decidedAt: new Date(),
          adminNote: 'Kart ödemesi — otomatik onay (POS)',
        },
      });
      if (claimed.count !== 1) {
        return { approved: false, reason: 'status:already-decided' };
      }

      await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Customer" WHERE id = ${topup.customerId} FOR UPDATE
      `;
      const customer = await tx.customer.findUnique({
        where: { id: topup.customerId },
        select: { id: true, cariBalance: true },
      });
      if (!customer) {
        // Tx rollback olsun ki claim de geri alınsın (tutarsız onay kalmasın).
        throw new NotFoundException('customer not found for card topup');
      }

      const previousBalance = decimalRound2(
        new Prisma.Decimal(customer.cariBalance),
      );
      const amount = decimalRound2(new Prisma.Decimal(topup.amount));
      const newBalance = decimalRound2(previousBalance.add(amount));

      await tx.customer.update({
        where: { id: customer.id },
        data: { cariBalance: newBalance },
      });
      await tx.cariLedger.create({
        data: {
          customerId: customer.id,
          type: 'TOPUP',
          amount,
          balanceAfter: newBalance,
          topupId: topup.id,
          description: 'Kart ile bakiye yüklemesi (otomatik onay)',
        },
      });

      this.logger.log(
        `Kartla cari yükleme onaylandı: #${topup.humanTopupNo} +${amount.toString()} TL`,
      );
      return { approved: true };
    });

    // Tahsilat makbuzu — yükleme COMMIT olduktan SONRA üretilir. Makbuz satırı
    // kendi idempotent transaction'ında açılır (createForTopup); buradaki bir
    // hata ASLA onaylanmış yüklemeyi geri almaz. Eksik kalırsa backfill + lazy
    // ensurePdf güvenlik ağı yakalar. Yalnızca onay gerçekleştiyse üretir
    // (guard createForTopupTx içinde: method==='card').
    if (result.approved) {
      try {
        await this.receipts.createForTopup(topupId);
      } catch (e) {
        this.logger.error(
          `makbuz üretilemedi (topup=${topupId}): ${(e as Error).message}`,
        );
      }
    }

    return result;
  }

  async createTopupRequest(params: {
    customerId: string;
    amount: number;
    customerNote?: string;
    bankAccountId?: string;
    req?: Request | null;
  }) {
    const amount = Number(params.amount);
    if (!Number.isFinite(amount) || amount < MIN_TOPUP_AMOUNT || amount > MAX_TOPUP_AMOUNT) {
      throw new BadRequestException('invalid topup amount');
    }

    const customer = await this.prisma.customer.findUnique({
      where: { id: params.customerId },
      select: { id: true, name: true, email: true },
    });
    if (!customer) throw new NotFoundException('customer not found');

    if (params.bankAccountId) {
      const bank = await this.prisma.bankAccount.findUnique({
        where: { id: params.bankAccountId },
        select: { id: true, active: true },
      });
      if (!bank || !bank.active) {
        throw new BadRequestException('bank account not available');
      }
    }

    const amountDecimal = decimalRound2(new Prisma.Decimal(amount));

    // Sequence + insert tek transaction içinde — eğer insert düşerse sequence'tan
    // bir numara yanmış olur (sorun değil, sırada delik açar sadece). Tersi (önce
    // insert, sonra update) müşteri taleplerine duplicate humanTopupNo riski
    // taşır ve UNIQUE constraint'i hatalı tetikleyebilir.
    const created = await this.prisma.$transaction(async (tx) => {
      const humanTopupNo = await this.topupNumbers.generateHumanTopupNo(tx);
      return tx.cariTopup.create({
        data: {
          humanTopupNo,
          customerId: customer.id,
          amount: amountDecimal,
          status: 'PENDING',
          customerNote: params.customerNote ?? null,
          bankAccountId: params.bankAccountId ?? null,
        },
        select: {
          id: true,
          humanTopupNo: true,
          amount: true,
          status: true,
          customerNote: true,
          requestedAt: true,
        },
      });
    });

    if (customer.email) {
      void this.mail
        .sendTopupRequestReceived({
          to: customer.email,
          customerName: customer.name ?? '',
          amount: Number(created.amount),
          currency: 'TRY',
          humanTopupNo: created.humanTopupNo ?? null,
        })
        .catch((e) =>
          this.logger.error('topup request mail failed', e as Error),
        );
    }

    // Fire-and-forget admin bildirimi. CariTopup tek tenant'lı kurulum gereği
    // tenantId taşımıyor — resolveDefaultTenantId ile çözülür.
    void (async () => {
      const tenantId = await this.adminNotifier.resolveDefaultTenantId();
      if (!tenantId) {
        this.logger.warn(
          `[cari.topup.create] admin notification skipped — tenant bulunamadı topupId=${created.id}`,
        );
        return;
      }
      const emails = await this.adminNotifier.resolveAdminEmails(
        tenantId,
        OPS_NOTIFY_ROLES,
      );
      if (emails.length === 0) {
        this.logger.warn(
          `[cari.topup.create] admin notification skipped — tenant=${tenantId} mail alıcısı yok topupId=${created.id}`,
        );
        return;
      }
      await this.mail.sendAdminNewTopupRequest({
        to: emails,
        customerName: customer.name ?? '(bilinmiyor)',
        customerEmail: customer.email ?? null,
        amount: Number(created.amount),
        currency: 'TRY',
        note: params.customerNote ?? null,
        adminUrl: null,
        humanTopupNo: created.humanTopupNo ?? null,
      });
    })().catch((e) =>
      this.logger.warn(
        `[cari.topup.create] admin mail failed topupId=${created.id} err=${(e as Error).message}`,
      ),
    );

    // In-app + push bildirimi (admin bildirim merkezi). Mail tenant resolution'a
    // bağımlı ama bildirim merkezi ADMIN+OWNER rolüne fanout — tenant lookup'a
    // gerek yok. Fire-and-forget; bildirim hatası talebin başarısını etkilemez.
    void this.notifications
      .emit({
        type: 'cari.topup.requested',
        severity: 'warning',
        title: created.humanTopupNo
          ? `Yeni cari yükleme talebi · ${created.humanTopupNo}`
          : 'Yeni cari yükleme talebi',
        body: `${customerLabel(customer)} — ₺${formatTry(Number(created.amount))}`,
        // Admin app içi route — bayi cari sekmesi açılır, ?topupId ile ilgili
        // talep satırına kaydırılıp vurgulanır (admin direkt onaylayabilir).
        // ESKİ değer (/admin/cari-balance/topups) admin router'ında yok → catch-all
        // dashboard'a düşürüyordu; /cari geçerli route'tur.
        link: `/cari?topupId=${created.id}`,
        data: {
          topupId: created.id,
          humanTopupNo: created.humanTopupNo ?? null,
          customerId: customer.id,
          amount: Number(created.amount),
          currency: 'TRY',
        },
        audience: { role: 'ADMIN' },
      })
      .catch((e) =>
        this.logger.warn(
          `[cari.topup.create] notification emit failed topupId=${created.id} err=${(e as Error).message}`,
        ),
      );

    void this.audit.record({
      action: 'CARI_TOPUP_REQUEST_CREATE',
      summary: `${customerLabel(customer)} ₺${formatTry(Number(created.amount))} cari bakiye yükleme talebi oluşturdu${created.humanTopupNo ? ` (${created.humanTopupNo})` : ''}`,
      actor: {
        type: 'customer',
        id: customer.id,
        name: customer.name,
        email: customer.email,
      },
      target: {
        id: created.id,
        type: 'cari-topup',
        label: created.humanTopupNo
          ? `Talep ${created.humanTopupNo}`
          : `Talep #${created.id.slice(0, 8)}`,
      },
      extra: {
        humanTopupNo: created.humanTopupNo ?? null,
        amount: Number(created.amount),
        currency: 'TRY',
        customerNote: params.customerNote ?? null,
        bankAccountId: params.bankAccountId ?? null,
      },
      req: params.req ?? null,
    });

    return {
      success: true,
      data: {
        id: created.id,
        humanTopupNo: created.humanTopupNo ?? null,
        amount: Number(created.amount),
        status: created.status,
        customerNote: created.customerNote,
        requestedAt: created.requestedAt,
      },
    };
  }

  // ---------- ADMIN FACING ----------

  async listTopupsForAdmin(
    // H-25: Tek tenant'lı kurulum — Customer'da tenantId yok. Bakiye yükleme
    // talepleri müşterinin siparişine bağlı olmadığından tenant filtrelemesi
    // yapılmaz; aksi halde hiç siparişi olmayan müşterinin talebi admin'e
    // hiç düşmez. Çağrı imzasında `tenantId` zorunlu tutuluyor ki ileride
    // multi-tenant olunca silent cross-tenant data leak yerine compile hatası
    // çıksın. Boş/yanlış tenantId verilirse defensive guard fırlatır.
    tenantId: string,
    statusFilter?: string,
    page = 1,
    pageSize = 20,
  ) {
    if (typeof tenantId !== 'string' || tenantId.trim().length === 0) {
      // Çağrı yerinde tenant resolved değilse admin endpoint'i çağrılmamalı;
      // RolesGuard üst katmanı bunu zaten engelliyor, burada ek bir sigorta.
      throw new BadRequestException('tenantId required');
    }
    const safePage = Math.max(1, page);
    const safeSize = Math.min(100, Math.max(1, pageSize));
    const where: Prisma.CariTopupWhereInput = {};
    if (statusFilter) {
      const upper = statusFilter.toUpperCase();
      if (!ALLOWED_TOPUP_STATUSES.includes(upper as TopupStatus)) {
        throw new BadRequestException('invalid status filter');
      }
      where.status = upper as TopupStatus;
      // Kart yüklemelerinde PENDING/REJECTED geçici POS denemesidir (otomatik
      // sonuçlanır, manuel karar verilemez) — onay kuyruğuna ve nav rozetine
      // (status=PENDING&pageSize=1 → meta.total) GİRMEZ. APPROVED kart
      // yüklemeleri (gerçek tahsilat) listede Tür="Kredi Kartı" ile görünür.
      if (upper !== 'APPROVED') {
        where.method = { not: 'card' };
      }
    }

    const [total, rows] = await Promise.all([
      this.prisma.cariTopup.count({ where }),
      this.prisma.cariTopup.findMany({
        where,
        orderBy: { requestedAt: 'desc' },
        skip: (safePage - 1) * safeSize,
        take: safeSize,
        select: {
          id: true,
          humanTopupNo: true,
          amount: true,
          method: true,
          commissionAmount: true,
          chargedAmount: true,
          status: true,
          customerNote: true,
          adminNote: true,
          requestedAt: true,
          decidedAt: true,
          customer: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              cariBalance: true,
            },
          },
          bankAccount: {
            select: {
              id: true,
              bankName: true,
              iban: true,
            },
          },
        },
      }),
    ]);

    return {
      success: true,
      data: rows.map((r) => ({
        id: r.id,
        humanTopupNo: r.humanTopupNo,
        amount: Number(r.amount),
        // 'bank_transfer' | 'card' — admin liste "Tür" kolonu için.
        method: r.method,
        commissionAmount: r.commissionAmount ? Number(r.commissionAmount) : null,
        chargedAmount: r.chargedAmount ? Number(r.chargedAmount) : null,
        status: r.status,
        customerNote: r.customerNote,
        adminNote: r.adminNote,
        requestedAt: r.requestedAt,
        decidedAt: r.decidedAt,
        customer: r.customer
          ? {
              id: r.customer.id,
              name: r.customer.name,
              email: r.customer.email,
              phone: r.customer.phone,
              cariBalance: Number(r.customer.cariBalance),
            }
          : null,
        bankAccount: r.bankAccount,
      })),
      meta: {
        total,
        page: safePage,
        limit: safeSize,
        totalPages: Math.ceil(total / safeSize),
      },
    };
  }

  /**
   * Admin "Cari Hareketler" tablosu için — TÜM CariLedger kayıtları (TOPUP,
   * ORDER_PAYMENT, REFUND, ADJUSTMENT) müşteri bilgisi ve (varsa) ilişkili
   * topup status'u ile birlikte sayfalı döner.
   *
   * Filtreler:
   *  - type: ledger tipi
   *  - status: yalnızca TOPUP kayıtlarına etki eder (PENDING/APPROVED/REJECTED).
   *            TOPUP olmayan kayıtlar her zaman APPROVED kabul edilir.
   *
   * NOT: PENDING TOPUP'lar henüz CariLedger'a yazılmamıştır (yalnızca onayda
   * yazılır). Bu yüzden status=PENDING filtresinde sonuçlara PENDING durumlu
   * CariTopup kayıtları da synthetic ledger entry olarak eklenir — admin tek
   * tabloda bekleyen yüklemeleri de görür ve onaylar/reddeder.
   */
  async listLedgerForAdmin(
    tenantId: string,
    params: {
      type?: string;
      status?: string;
      page?: number;
      pageSize?: number;
      customerId?: string;
      from?: string;
      to?: string;
    },
  ) {
    if (typeof tenantId !== 'string' || tenantId.trim().length === 0) {
      throw new BadRequestException('tenantId required');
    }

    const safePage = Math.max(1, params.page ?? 1);
    const safeSize = Math.min(200, Math.max(1, params.pageSize ?? 50));
    const customerIdFilter =
      typeof params.customerId === 'string' && params.customerId.trim().length > 0
        ? params.customerId.trim()
        : undefined;

    const ALLOWED_TYPES = ['TOPUP', 'ORDER_PAYMENT', 'REFUND', 'ADJUSTMENT'] as const;
    type LedgerType = (typeof ALLOWED_TYPES)[number];

    let typeFilter: LedgerType | undefined;
    if (params.type) {
      const upper = params.type.toUpperCase();
      if (!ALLOWED_TYPES.includes(upper as LedgerType)) {
        throw new BadRequestException('invalid type filter');
      }
      typeFilter = upper as LedgerType;
    }

    let statusFilter: TopupStatus | undefined;
    if (params.status) {
      const upper = params.status.toUpperCase();
      if (!ALLOWED_TOPUP_STATUSES.includes(upper as TopupStatus)) {
        throw new BadRequestException('invalid status filter');
      }
      statusFilter = upper as TopupStatus;
    }

    const parseDate = (value: string | undefined): Date | undefined => {
      if (!value) return undefined;
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) {
        throw new BadRequestException('invalid date filter');
      }
      return d;
    };
    const fromDate = parseDate(params.from);
    const toDate = parseDate(params.to);
    const dateRange: Prisma.DateTimeFilter | undefined =
      fromDate || toDate
        ? { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) }
        : undefined;

    // PENDING filtresinde CariLedger'a hiç bakmıyoruz — PENDING TOPUP'lar
    // henüz ledger'a yazılmamış. Sadece CariTopup tablosundan PENDING'leri
    // synthetic entry olarak döneriz.
    if (statusFilter === 'PENDING') {
      // type filtresi PENDING ile uyumsuz — sadece TOPUP olabilir
      if (typeFilter && typeFilter !== 'TOPUP') {
        return {
          success: true,
          data: [],
          meta: { total: 0, page: safePage, limit: safeSize, totalPages: 1 },
        };
      }

      // Kart denemeleri (PENDING) geçici POS ara durumudur — admin onay
      // kuyruğunda GÖRÜNMEZ (manuel karar verilemez, otomatik sonuçlanır).
      const pendingWhere: Prisma.CariTopupWhereInput = {
        status: 'PENDING',
        method: { not: 'card' },
      };
      if (customerIdFilter) pendingWhere.customerId = customerIdFilter;
      if (dateRange) pendingWhere.requestedAt = dateRange;

      const [total, pendingTopups] = await Promise.all([
        this.prisma.cariTopup.count({ where: pendingWhere }),
        this.prisma.cariTopup.findMany({
          where: pendingWhere,
          orderBy: { requestedAt: 'desc' },
          skip: (safePage - 1) * safeSize,
          take: safeSize,
          select: {
            id: true,
            humanTopupNo: true,
            amount: true,
            // Yöntem + kart komisyonu snapshot'ı — admin 'Tür' rozeti ve
            // komisyon/çekilen tooltip'i için (komisyon yalnızca kartta dolu).
            method: true,
            commissionAmount: true,
            chargedAmount: true,
            status: true,
            customerNote: true,
            adminNote: true,
            requestedAt: true,
            decidedAt: true,
            customer: {
              select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                cariBalance: true,
              },
            },
            bankAccount: {
              select: { id: true, bankName: true, iban: true },
            },
          },
        }),
      ]);

      return {
        success: true,
        data: pendingTopups.map((t) => ({
          id: `topup:${t.id}`,
          type: 'TOPUP' as const,
          amount: Number(t.amount),
          balanceAfter: null as number | null,
          description: t.customerNote ?? 'Bakiye yükleme talebi',
          createdAt: t.requestedAt,
          orderId: null,
          humanOrderNo: null,
          orderPaymentType: null,
          topupId: t.id,
          humanTopupNo: t.humanTopupNo,
          topupStatus: 'PENDING' as const,
          // 'bank_transfer' | 'card' — admin 'Tür' kolonu rozeti için.
          topupMethod: t.method,
          topupCommissionAmount: t.commissionAmount
            ? Number(t.commissionAmount)
            : null,
          topupChargedAmount: t.chargedAmount
            ? Number(t.chargedAmount)
            : null,
          customerNote: t.customerNote,
          adminNote: t.adminNote,
          decidedAt: t.decidedAt,
          customer: t.customer
            ? {
                id: t.customer.id,
                name: t.customer.name,
                email: t.customer.email,
                phone: t.customer.phone,
                cariBalance: Number(t.customer.cariBalance),
              }
            : null,
          bankAccount: t.bankAccount,
        })),
        meta: {
          total,
          page: safePage,
          limit: safeSize,
          totalPages: Math.max(1, Math.ceil(total / safeSize)),
        },
      };
    }

    // Normal ledger sorgusu (APPROVED/REJECTED/ALL için)
    const where: Prisma.CariLedgerWhereInput = {};
    if (typeFilter) {
      where.type = typeFilter;
    }
    if (customerIdFilter) {
      where.customerId = customerIdFilter;
    }
    if (dateRange) {
      where.createdAt = dateRange;
    }
    // status=REJECTED: ledger'a hiç REJECTED yazılmaz; sadece CariTopup'da
    // status=REJECTED kayıtlar var. Onları synthetic döner.
    if (statusFilter === 'REJECTED') {
      if (typeFilter && typeFilter !== 'TOPUP') {
        return {
          success: true,
          data: [],
          meta: { total: 0, page: safePage, limit: safeSize, totalPages: 1 },
        };
      }
      // Otomatik kapanan kart denemeleri (REJECTED) gürültüdür — listelenmez;
      // gerçek tahsilatlar (APPROVED) ledger üzerinden zaten görünür.
      const rejectedWhere: Prisma.CariTopupWhereInput = {
        status: 'REJECTED',
        method: { not: 'card' },
      };
      if (customerIdFilter) rejectedWhere.customerId = customerIdFilter;
      if (dateRange) {
        rejectedWhere.OR = [
          { decidedAt: dateRange },
          { requestedAt: dateRange },
        ];
      }
      const [total, rejected] = await Promise.all([
        this.prisma.cariTopup.count({ where: rejectedWhere }),
        this.prisma.cariTopup.findMany({
          where: rejectedWhere,
          orderBy: { decidedAt: 'desc' },
          skip: (safePage - 1) * safeSize,
          take: safeSize,
          select: {
            id: true,
            humanTopupNo: true,
            amount: true,
            // Yöntem + kart komisyonu snapshot'ı — admin 'Tür' rozeti ve
            // komisyon/çekilen tooltip'i için (komisyon yalnızca kartta dolu).
            method: true,
            commissionAmount: true,
            chargedAmount: true,
            status: true,
            customerNote: true,
            adminNote: true,
            requestedAt: true,
            decidedAt: true,
            customer: {
              select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                cariBalance: true,
              },
            },
            bankAccount: {
              select: { id: true, bankName: true, iban: true },
            },
          },
        }),
      ]);

      return {
        success: true,
        data: rejected.map((t) => ({
          id: `topup:${t.id}`,
          type: 'TOPUP' as const,
          amount: Number(t.amount),
          balanceAfter: null as number | null,
          description: t.customerNote ?? 'Bakiye yükleme talebi',
          createdAt: t.decidedAt ?? t.requestedAt,
          orderId: null,
          humanOrderNo: null,
          orderPaymentType: null,
          topupId: t.id,
          humanTopupNo: t.humanTopupNo,
          topupStatus: 'REJECTED' as const,
          // 'bank_transfer' | 'card' — admin 'Tür' kolonu rozeti için.
          topupMethod: t.method,
          topupCommissionAmount: t.commissionAmount
            ? Number(t.commissionAmount)
            : null,
          topupChargedAmount: t.chargedAmount
            ? Number(t.chargedAmount)
            : null,
          customerNote: t.customerNote,
          adminNote: t.adminNote,
          decidedAt: t.decidedAt,
          customer: t.customer
            ? {
                id: t.customer.id,
                name: t.customer.name,
                email: t.customer.email,
                phone: t.customer.phone,
                cariBalance: Number(t.customer.cariBalance),
              }
            : null,
          bankAccount: t.bankAccount,
        })),
        meta: {
          total,
          page: safePage,
          limit: safeSize,
          totalPages: Math.max(1, Math.ceil(total / safeSize)),
        },
      };
    }

    // APPROVED veya filtre yok: gerçek ledger kayıtları
    const [total, rows] = await Promise.all([
      this.prisma.cariLedger.count({ where }),
      this.prisma.cariLedger.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (safePage - 1) * safeSize,
        take: safeSize,
        select: {
          id: true,
          type: true,
          amount: true,
          balanceAfter: true,
          description: true,
          createdAt: true,
          orderId: true,
          topupId: true,
          isGift: true,
          customer: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              cariBalance: true,
            },
          },
          order: {
            // paymentType: 'cari' | 'card' — admin 'Tür' kolonunda sipariş
            // bağlı satırların (ORDER_PAYMENT/REFUND) yöntem rozeti için.
            // Kart siparişinin iadesi de cariye REFUND olarak düştüğünden
            // burada 'card' görünebilir.
            select: { id: true, humanOrderNo: true, paymentType: true },
          },
          topup: {
            select: {
              id: true,
              humanTopupNo: true,
              // Yöntem + kart komisyonu snapshot'ı — admin 'Tür' rozeti ve
              // komisyon/çekilen tooltip'i için (komisyon yalnızca kartta dolu).
              method: true,
              commissionAmount: true,
              chargedAmount: true,
              status: true,
              customerNote: true,
              adminNote: true,
              requestedAt: true,
              decidedAt: true,
              bankAccount: {
                select: { id: true, bankName: true, iban: true },
              },
            },
          },
        },
      }),
    ]);

    return {
      success: true,
      data: rows.map((r) => ({
        id: r.id,
        type: r.type,
        amount: Number(r.amount),
        balanceAfter: Number(r.balanceAfter),
        description: r.description,
        createdAt: r.createdAt,
        orderId: r.orderId,
        humanOrderNo: r.order?.humanOrderNo ?? null,
        // Hediye bakiye kaydı mı? Admin hareket listesinde "Hediye" rozeti için.
        isGift: r.isGift,
        // Siparişin ödeme tipi ('cari' | 'card') — admin 'Tür' kolonu rozeti.
        orderPaymentType: r.order?.paymentType ?? null,
        topupId: r.topupId,
        humanTopupNo: r.topup?.humanTopupNo ?? null,
        // Ledger'da olan TOPUP'lar zaten APPROVED'dur. ADJUSTMENT/ORDER_PAYMENT/REFUND
        // hep APPROVED kabul edilir (transactional, kesin işlem).
        topupStatus: r.type === 'TOPUP' ? 'APPROVED' as const : null,
        // 'bank_transfer' | 'card' — admin 'Tür' kolonu rozeti için.
        topupMethod: r.topup?.method ?? null,
        // Kartlı yüklemede komisyon + karttan çekilen toplam — tooltip'te
        // gösterilir; havale/EFT'de null.
        topupCommissionAmount: r.topup?.commissionAmount
          ? Number(r.topup.commissionAmount)
          : null,
        topupChargedAmount: r.topup?.chargedAmount
          ? Number(r.topup.chargedAmount)
          : null,
        customerNote: r.topup?.customerNote ?? null,
        adminNote: r.topup?.adminNote ?? null,
        decidedAt: r.topup?.decidedAt ?? null,
        customer: r.customer
          ? {
              id: r.customer.id,
              name: r.customer.name,
              email: r.customer.email,
              phone: r.customer.phone,
              cariBalance: Number(r.customer.cariBalance),
            }
          : null,
        bankAccount: r.topup?.bankAccount ?? null,
      })),
      meta: {
        total,
        page: safePage,
        limit: safeSize,
        totalPages: Math.max(1, Math.ceil(total / safeSize)),
      },
    };
  }

  /**
   * Approve / reject a topup. Idempotent: re-decision throws ConflictException.
   *
   * On approval:
   *   - lock customer row (SELECT FOR UPDATE)
   *   - re-read topup status inside Tx (double-check)
   *   - increment cariBalance atomically
   *   - update topup status / decidedAt / decidedByUserId
   *   - write CariLedger row (TOPUP, positive amount, balanceAfter snapshot)
   * On rejection: only mark topup REJECTED + adminNote; balance untouched.
   */
  async decideTopup(params: {
    topupId: string;
    decidedByUserId: string;
    tenantId: string;
    decision: 'approved' | 'rejected';
    adminNote?: string;
    actorEmail?: string | null;
    req?: Request | null;
  }) {
    if (params.decision !== 'approved' && params.decision !== 'rejected') {
      throw new BadRequestException('decision must be approved or rejected');
    }

    // Tek tenant'lı kurulum: tenant filtresi yok (bkz. listTopupsForAdmin).
    // Siparişi olmayan müşterinin talebi de onaylanabilmeli.
    const existing = await this.prisma.cariTopup.findFirst({
      where: {
        id: params.topupId,
      },
      select: {
        id: true,
        humanTopupNo: true,
        status: true,
        amount: true,
        customerId: true,
        customer: {
          select: { id: true, name: true, email: true },
        },
      },
    });
    if (!existing) throw new NotFoundException('topup not found');
    if (existing.status !== 'PENDING') {
      throw new ConflictException('topup already decided');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // Acquire row lock + re-read inside Tx
      await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "CariTopup" WHERE id = ${params.topupId} FOR UPDATE
      `;
      const fresh = await tx.cariTopup.findUnique({
        where: { id: params.topupId },
        select: {
          id: true,
          status: true,
          amount: true,
          customerId: true,
          method: true,
        },
      });
      if (!fresh) throw new NotFoundException('topup not found');
      if (fresh.status !== 'PENDING') {
        throw new ConflictException('topup already decided');
      }
      // KART yüklemeleri manuel ONAYLANAMAZ/REDDEDİLEMEZ: tahsilat PayTR
      // callback'i ile otomatik onaylanır (systemApproveCardTopup); ödenmemiş
      // denemeleri sweep cron'u kapatır. Admin onayı tahsilatsız cari kredisi,
      // admin reddi ise "para çekildi ama bakiye yüklenmedi" yarışı yaratırdı.
      if (fresh.method === 'card') {
        throw new ConflictException(
          'Kartlı yüklemeler POS tahsilatıyla otomatik sonuçlanır — manuel karar verilemez.',
        );
      }

      if (params.decision === 'rejected') {
        const upd = await tx.cariTopup.update({
          where: { id: params.topupId },
          data: {
            status: 'REJECTED',
            decidedAt: new Date(),
            decidedByUserId: params.decidedByUserId,
            adminNote: params.adminNote ?? undefined,
          },
          select: {
            id: true,
            humanTopupNo: true,
            status: true,
            decidedAt: true,
            adminNote: true,
            amount: true,
          },
        });
        return {
          topup: upd,
          previousBalance: null as Prisma.Decimal | null,
          newBalance: null as Prisma.Decimal | null,
          ledgerId: null as string | null,
        };
      }

      // APPROVED: lock customer row, debit/credit, write ledger
      await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Customer" WHERE id = ${fresh.customerId} FOR UPDATE
      `;
      const customer = await tx.customer.findUnique({
        where: { id: fresh.customerId },
        select: { id: true, cariBalance: true },
      });
      if (!customer) throw new NotFoundException('customer not found');

      const previousBalance = decimalRound2(
        new Prisma.Decimal(customer.cariBalance),
      );
      const amount = decimalRound2(new Prisma.Decimal(fresh.amount));
      const newBalance = decimalRound2(previousBalance.add(amount));

      await tx.customer.update({
        where: { id: customer.id },
        data: { cariBalance: newBalance },
      });

      const upd = await tx.cariTopup.update({
        where: { id: params.topupId },
        data: {
          status: 'APPROVED',
          decidedAt: new Date(),
          decidedByUserId: params.decidedByUserId,
          adminNote: params.adminNote ?? undefined,
        },
        select: {
          id: true,
          humanTopupNo: true,
          status: true,
          decidedAt: true,
          adminNote: true,
          amount: true,
        },
      });

      const ledger = await tx.cariLedger.create({
        data: {
          customerId: customer.id,
          type: 'TOPUP',
          amount, // positive
          balanceAfter: newBalance,
          topupId: params.topupId,
          description: 'Cari bakiye yüklemesi onaylandı',
          createdByUserId: params.decidedByUserId,
        },
        select: { id: true },
      });

      return { topup: upd, previousBalance, newBalance, ledgerId: ledger.id };
    });

    if (existing.customer?.email) {
      const payload = {
        to: existing.customer.email,
        customerName: existing.customer.name ?? '',
        amount: Number(existing.amount),
        currency: 'TRY',
        note: params.adminNote ?? null,
        humanTopupNo: existing.humanTopupNo ?? null,
      };
      const sender =
        params.decision === 'approved'
          ? this.mail.sendTopupApproved(payload)
          : this.mail.sendTopupRejected(payload);
      void sender.catch((e) =>
        this.logger.error('topup decision mail failed', e as Error),
      );
    }

    const LARGE_TOPUP_THRESHOLD = 5000;
    if (params.decision === 'approved' && Number(existing.amount) > LARGE_TOPUP_THRESHOLD) {
      void (async () => {
        try {
          const decidingUser = await this.prisma.user.findUnique({
            where: { id: params.decidedByUserId },
            select: { tenantId: true, name: true, email: true },
          });
          if (!decidingUser) return;
          const emails = await this.adminNotifier.resolveAdminEmails(decidingUser.tenantId);
          if (emails.length === 0) {
            this.logger.warn(
              `[cari.topup.large] admin notification skipped — tenant=${decidingUser.tenantId} aktif OWNER/ADMIN yok topupId=${existing.id}`,
            );
            return;
          }
          await this.mail.sendAdminLargeTopup({
            to: emails,
            customerName: existing.customer?.name ?? existing.customer?.email ?? '',
            customerEmail: existing.customer?.email ?? '',
            amount: Number(existing.amount),
            currency: 'TRY',
            approvedByName: decidingUser.name ?? decidingUser.email,
            humanTopupNo: existing.humanTopupNo ?? null,
          });
        } catch (e) {
          this.logger.warn(`large topup admin mail failed: ${(e as Error).message}`);
        }
      })();
    }

    void (async () => {
      const admin = await this.prisma.user
        .findUnique({
          where: { id: params.decidedByUserId },
          select: { id: true, name: true, email: true, tenantId: true },
        })
        .catch(() => null);
      const adminLabel = admin?.name?.trim() || admin?.email?.trim() || params.actorEmail || 'admin';
      const targetLabel = existing.humanTopupNo
        ? `Talep ${existing.humanTopupNo}`
        : `Talep #${existing.id.slice(0, 8)}`;
      const topupRefSuffix = existing.humanTopupNo ? ` (${existing.humanTopupNo})` : '';
      const customerName = customerLabel({
        name: existing.customer?.name,
        email: existing.customer?.email,
      });
      const amountText = `₺${formatTry(Number(existing.amount))}`;

      if (params.decision === 'approved') {
        const newBalText =
          result.newBalance !== null ? `₺${formatTry(Number(result.newBalance))}` : '—';
        await this.audit.record({
          action: 'CARI_TOPUP_APPROVE',
          summary: `${adminLabel} ${customerName} için ${amountText} cari yüklemesini onayladı${topupRefSuffix} (yeni bakiye: ${newBalText})`,
          actor: {
            type: 'admin',
            id: admin?.id ?? params.decidedByUserId,
            name: admin?.name ?? null,
            email: admin?.email ?? params.actorEmail ?? null,
            tenantId: admin?.tenantId ?? params.tenantId,
          },
          target: {
            id: existing.id,
            type: 'cari-topup',
            label: targetLabel,
          },
          before:
            result.previousBalance !== null
              ? { cariBalance: Number(result.previousBalance) }
              : null,
          after:
            result.newBalance !== null ? { cariBalance: Number(result.newBalance) } : null,
          extra: {
            humanTopupNo: existing.humanTopupNo ?? null,
            amount: Number(existing.amount),
            currency: 'TRY',
            adminNote: params.adminNote ?? null,
            customerId: existing.customer?.id ?? null,
            customerName: existing.customer?.name ?? null,
            customerEmail: existing.customer?.email ?? null,
          },
          req: params.req ?? null,
        });
      } else {
        await this.audit.record({
          action: 'CARI_TOPUP_REJECT',
          summary: `${adminLabel} ${customerName} için ${amountText} cari yüklemesini reddetti${topupRefSuffix}${params.adminNote ? ` — sebep: ${params.adminNote}` : ''}`,
          actor: {
            type: 'admin',
            id: admin?.id ?? params.decidedByUserId,
            name: admin?.name ?? null,
            email: admin?.email ?? params.actorEmail ?? null,
            tenantId: admin?.tenantId ?? params.tenantId,
          },
          target: {
            id: existing.id,
            type: 'cari-topup',
            label: targetLabel,
          },
          extra: {
            humanTopupNo: existing.humanTopupNo ?? null,
            amount: Number(existing.amount),
            currency: 'TRY',
            adminNote: params.adminNote ?? null,
            customerId: existing.customer?.id ?? null,
            customerName: existing.customer?.name ?? null,
            customerEmail: existing.customer?.email ?? null,
          },
          req: params.req ?? null,
        });
      }
    })().catch((e) =>
      this.logger.warn(`audit log failed (topup decide): ${(e as Error).message}`),
    );

    return {
      success: true,
      data: {
        id: result.topup.id,
        humanTopupNo: result.topup.humanTopupNo ?? null,
        status: result.topup.status,
        decidedAt: result.topup.decidedAt,
        adminNote: result.topup.adminNote,
        amount: Number(result.topup.amount),
        newBalance: result.newBalance !== null ? Number(result.newBalance) : null,
        ledgerId: result.ledgerId,
      },
    };
  }

  /**
   * Admin manuel cari bakiye düzeltmesi.
   *
   * Admin yeni MUTLAK bakiye değerini gönderir; servis aradaki işaretli farkı
   * (delta) hesaplar ve ADJUSTMENT tipinde bir CariLedger kaydı yazar — böylece
   * denetim izi korunur ve bakiyenin doğruluğu izlenebilir kalır.
   *
   * Atomik: customer satırı SELECT ... FOR UPDATE ile kilitlenir, taze okunur,
   * cariBalance hedef değere set edilir ve ledger snapshot'ı aynı transaction
   * içinde yazılır. Delta sıfırsa BadRequestException atılır.
   */
  async adjustBalanceByAdmin(params: {
    customerId: string;
    newBalance: number;
    reason?: string;
    adminUserId: string;
    actorEmail?: string | null;
    tenantId?: string | null;
    req?: Request | null;
  }) {
    const target = Number(params.newBalance);
    if (
      !Number.isFinite(target) ||
      target < MIN_ADJUSTED_BALANCE ||
      target > MAX_ADJUSTED_BALANCE
    ) {
      throw new BadRequestException('invalid balance value');
    }
    const targetDecimal = decimalRound2(new Prisma.Decimal(target));

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Customer" WHERE id = ${params.customerId} FOR UPDATE
      `;
      const customer = await tx.customer.findUnique({
        where: { id: params.customerId },
        select: { id: true, cariBalance: true, name: true, email: true },
      });
      if (!customer) throw new NotFoundException('customer not found');

      const previousBalance = decimalRound2(
        new Prisma.Decimal(customer.cariBalance),
      );
      const delta = decimalRound2(targetDecimal.sub(previousBalance));
      if (delta.isZero()) {
        throw new BadRequestException('balance unchanged');
      }

      // PROMO (hoşgeldin) kredisi: pozitif düzeltme + açıklamada AÇIK işaret —
      // ya "HOS100" gibi HOS+rakam kodu ya da "hoşgeldin/hosgeldin". Bare "hoş"
      // (ör. "hoş jest") EŞLEŞMEZ → yanlış pozitif önlenir. Harcanan kısmı ortak
      // gideri olur (faturaya girmez).
      const reason = params.reason ?? '';
      const isPromoCredit =
        delta.greaterThan(0) &&
        (/hos\s*\d/i.test(reason) || /ho[sş]geldin/i.test(reason));

      await tx.customer.update({
        where: { id: customer.id },
        data: { cariBalance: targetDecimal },
      });

      const ledger = await tx.cariLedger.create({
        data: {
          customerId: customer.id,
          type: 'ADJUSTMENT',
          amount: delta, // işaretli: pozitif = alacak, negatif = borç
          balanceAfter: targetDecimal,
          description: params.reason
            ? `Manuel düzeltme: ${params.reason}`
            : 'Manuel cari bakiye düzeltmesi',
          isPromo: isPromoCredit,
          createdByUserId: params.adminUserId,
        },
        select: { id: true },
      });

      return { previousBalance, delta, ledgerId: ledger.id, customer };
    });

    void (async () => {
      const admin = await this.prisma.user
        .findUnique({
          where: { id: params.adminUserId },
          select: { id: true, name: true, email: true, tenantId: true },
        })
        .catch(() => null);
      const adminLabel = admin?.name?.trim() || admin?.email?.trim() || params.actorEmail || 'admin';
      const cName = customerLabel({
        name: result.customer.name,
        email: result.customer.email,
      });
      const delta = Number(result.delta);
      const directionLabel = delta >= 0 ? 'arttırdı' : 'azalttı';
      const deltaText = `₺${formatTry(Math.abs(delta))}`;
      await this.audit.record({
        action: 'CARI_BALANCE_ADJUST',
        summary: `${adminLabel} ${cName} müşterisinin cari bakiyesini ${deltaText} ${directionLabel} (yeni bakiye: ₺${formatTry(Number(targetDecimal))})${params.reason ? ` — sebep: ${params.reason}` : ''}`,
        actor: {
          type: 'admin',
          id: admin?.id ?? params.adminUserId,
          name: admin?.name ?? null,
          email: admin?.email ?? params.actorEmail ?? null,
          tenantId: admin?.tenantId ?? params.tenantId ?? null,
        },
        target: {
          id: params.customerId,
          type: 'customer',
          label: cName,
        },
        before: { cariBalance: Number(result.previousBalance) },
        after: { cariBalance: Number(targetDecimal) },
        extra: {
          delta,
          currency: 'TRY',
          reason: params.reason ?? null,
          ledgerId: result.ledgerId,
        },
        req: params.req ?? null,
      });
    })().catch((e) =>
      this.logger.warn(`audit log failed (balance adjust): ${(e as Error).message}`),
    );

    return {
      success: true,
      data: {
        customerId: params.customerId,
        previousBalance: Number(result.previousBalance),
        newBalance: Number(targetDecimal),
        delta: Number(result.delta),
        ledgerId: result.ledgerId,
        currency: 'TRY',
      },
    };
  }

  /**
   * Admin HEDİYE BAKİYE tanımlaması.
   *
   * Manuel düzeltmeden (adjustBalanceByAdmin) FARKI: admin girdiği tutar
   * EKLENECEK pozitif hediye bakiyedir (mutlak yeni bakiye değil). Böylece
   * "önceki bakiye + hediye = yeni bakiye" mantığı doğrudan uygulanır.
   *
   * Ledger kaydı: type=ADJUSTMENT, amount=+hediye, isGift=true VE isPromo=true.
   *   - isGift: müşteri panelinde "HEDİYE BAKİYE" rozeti + ayrı etiket (gösterim).
   *   - isPromo: hediye firma-fonlu kredidir → promo havuzuna girer; harcanan
   *     kısmı ortak gideri olur, faturaya girmez (hoşgeldin kredisiyle aynı
   *     muhasebe). Bkz. debitForOrderTx promo tüketimi.
   *
   * Atomik: customer satırı SELECT ... FOR UPDATE ile kilitlenir, taze okunur,
   * cariBalance += hediye set edilir ve ledger snapshot'ı aynı transaction
   * içinde yazılır. COMMIT sonrası müşteriye hediye e-postası gönderilir.
   */
  async giftBalanceByAdmin(params: {
    customerId: string;
    amount: number;
    note?: string;
    adminUserId: string;
    actorEmail?: string | null;
    tenantId?: string | null;
    req?: Request | null;
  }) {
    const gift = Number(params.amount);
    if (
      !Number.isFinite(gift) ||
      gift < MIN_GIFT_AMOUNT ||
      gift > MAX_GIFT_AMOUNT
    ) {
      throw new BadRequestException('invalid gift amount');
    }
    const giftDecimal = decimalRound2(new Prisma.Decimal(gift));
    const note = params.note?.trim() || null;

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Customer" WHERE id = ${params.customerId} FOR UPDATE
      `;
      const customer = await tx.customer.findUnique({
        where: { id: params.customerId },
        select: { id: true, cariBalance: true, name: true, email: true },
      });
      if (!customer) throw new NotFoundException('customer not found');

      const previousBalance = decimalRound2(
        new Prisma.Decimal(customer.cariBalance),
      );
      const newBalance = decimalRound2(previousBalance.add(giftDecimal));

      await tx.customer.update({
        where: { id: customer.id },
        data: { cariBalance: newBalance },
      });

      const ledger = await tx.cariLedger.create({
        data: {
          customerId: customer.id,
          type: 'ADJUSTMENT',
          amount: giftDecimal, // pozitif = alacak (hediye)
          balanceAfter: newBalance,
          description: note
            ? `🎁 Hediye bakiye tanımlandı — ${note}`
            : '🎁 Hediye bakiye tanımlandı',
          isGift: true,
          isPromo: true,
          createdByUserId: params.adminUserId,
        },
        select: { id: true },
      });

      return { previousBalance, newBalance, ledgerId: ledger.id, customer };
    });

    // Müşteriye hediye e-postası — COMMIT sonrası fire-and-forget. Mail hatası
    // ASLA tanımlanmış hediyeyi geri almaz.
    if (result.customer.email) {
      void this.mail
        .sendGiftBalanceGranted({
          to: result.customer.email,
          customerName: result.customer.name ?? '',
          amount: Number(giftDecimal),
          previousBalance: Number(result.previousBalance),
          newBalance: Number(result.newBalance),
          currency: 'TRY',
          note,
        })
        .catch((e) =>
          this.logger.error('gift balance mail failed', e as Error),
        );
    }

    void (async () => {
      const admin = await this.prisma.user
        .findUnique({
          where: { id: params.adminUserId },
          select: { id: true, name: true, email: true, tenantId: true },
        })
        .catch(() => null);
      const adminLabel =
        admin?.name?.trim() || admin?.email?.trim() || params.actorEmail || 'admin';
      const cName = customerLabel({
        name: result.customer.name,
        email: result.customer.email,
      });
      await this.audit.record({
        action: 'CARI_GIFT_BALANCE_GRANT',
        summary: `${adminLabel} ${cName} müşterisine ₺${formatTry(Number(giftDecimal))} HEDİYE bakiye tanımladı (yeni bakiye: ₺${formatTry(Number(result.newBalance))})${note ? ` — not: ${note}` : ''}`,
        actor: {
          type: 'admin',
          id: admin?.id ?? params.adminUserId,
          name: admin?.name ?? null,
          email: admin?.email ?? params.actorEmail ?? null,
          tenantId: admin?.tenantId ?? params.tenantId ?? null,
        },
        target: {
          id: params.customerId,
          type: 'customer',
          label: cName,
        },
        before: { cariBalance: Number(result.previousBalance) },
        after: { cariBalance: Number(result.newBalance) },
        extra: {
          gift: Number(giftDecimal),
          currency: 'TRY',
          note,
          ledgerId: result.ledgerId,
        },
        req: params.req ?? null,
      });
    })().catch((e) =>
      this.logger.warn(`audit log failed (gift balance): ${(e as Error).message}`),
    );

    return {
      success: true,
      data: {
        customerId: params.customerId,
        previousBalance: Number(result.previousBalance),
        giftAmount: Number(giftDecimal),
        newBalance: Number(result.newBalance),
        ledgerId: result.ledgerId,
        currency: 'TRY',
      },
    };
  }

  // ---------- BANK ACCOUNTS (admin) ----------

  async listBankAccountsForAdmin() {
    const rows = await this.prisma.bankAccount.findMany({
      orderBy: [{ active: 'desc' }, { position: 'asc' }, { createdAt: 'asc' }],
    });
    return { success: true, data: rows };
  }

  async createBankAccount(
    dto: BankAccountUpsertDto,
    actor?: {
      id: string;
      email?: string | null;
      tenantId?: string | null;
    } | null,
    req?: Request | null,
  ) {
    const iban = normalizeIban(dto.iban);
    const existing = await this.prisma.bankAccount.findUnique({
      where: { iban },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('bank account with this IBAN already exists');
    }
    const created = await this.prisma.bankAccount.create({
      data: {
        bankName: dto.bankName.trim(),
        accountName: dto.accountName.trim(),
        iban,
        branchCode: dto.branchCode?.trim() ?? null,
        accountNo: dto.accountNo?.trim() ?? null,
        active: dto.active ?? true,
        position: dto.position ?? 0,
        note: dto.note?.trim() ?? null,
      },
    });

    if (actor) {
      void this.recordBankAuditAsync({
        action: 'BANK_ACCOUNT_CREATE',
        summarize: (adminLabel) =>
          `${adminLabel} "${created.bankName} — ${created.accountName}" banka hesabını ekledi`,
        actor,
        target: { id: created.id, type: 'bank-account', label: `${created.bankName} — ${created.accountName}` },
        after: {
          bankName: created.bankName,
          accountName: created.accountName,
          iban: created.iban,
          branchCode: created.branchCode,
          accountNo: created.accountNo,
          active: created.active,
          position: created.position,
          note: created.note,
        },
        req: req ?? null,
      });
    }

    return { success: true, data: created };
  }

  async updateBankAccount(
    id: string,
    dto: BankAccountUpdateDto,
    actor?: {
      id: string;
      email?: string | null;
      tenantId?: string | null;
    } | null,
    req?: Request | null,
  ) {
    const existing = await this.prisma.bankAccount.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('bank account not found');

    const data: Prisma.BankAccountUpdateInput = {};
    if (dto.bankName !== undefined) data.bankName = dto.bankName.trim();
    if (dto.accountName !== undefined) data.accountName = dto.accountName.trim();
    if (dto.iban !== undefined) {
      const iban = normalizeIban(dto.iban);
      const conflict = await this.prisma.bankAccount.findFirst({
        where: { iban, id: { not: id } },
        select: { id: true },
      });
      if (conflict) throw new ConflictException('IBAN already in use');
      data.iban = iban;
    }
    if (dto.branchCode !== undefined) data.branchCode = dto.branchCode?.trim() ?? null;
    if (dto.accountNo !== undefined) data.accountNo = dto.accountNo?.trim() ?? null;
    if (dto.active !== undefined) data.active = dto.active;
    if (dto.position !== undefined) data.position = dto.position;
    if (dto.note !== undefined) data.note = dto.note?.trim() ?? null;

    const updated = await this.prisma.bankAccount.update({
      where: { id },
      data,
    });

    if (actor) {
      void this.recordBankAuditAsync({
        action: 'BANK_ACCOUNT_UPDATE',
        summarize: (adminLabel) =>
          `${adminLabel} "${updated.bankName} — ${updated.accountName}" banka hesabını güncelledi`,
        actor,
        target: { id: updated.id, type: 'bank-account', label: `${updated.bankName} — ${updated.accountName}` },
        before: {
          bankName: existing.bankName,
          accountName: existing.accountName,
          iban: existing.iban,
          branchCode: existing.branchCode,
          accountNo: existing.accountNo,
          active: existing.active,
          position: existing.position,
          note: existing.note,
        },
        after: {
          bankName: updated.bankName,
          accountName: updated.accountName,
          iban: updated.iban,
          branchCode: updated.branchCode,
          accountNo: updated.accountNo,
          active: updated.active,
          position: updated.position,
          note: updated.note,
        },
        req: req ?? null,
      });
    }

    return { success: true, data: updated };
  }

  async deleteBankAccount(
    id: string,
    actor?: {
      id: string;
      email?: string | null;
      tenantId?: string | null;
    } | null,
    req?: Request | null,
  ) {
    const existing = await this.prisma.bankAccount.findUnique({
      where: { id },
      select: {
        id: true,
        bankName: true,
        accountName: true,
        iban: true,
        topups: { select: { id: true }, take: 1 },
      },
    });
    if (!existing) throw new NotFoundException('bank account not found');

    const label = `${existing.bankName} — ${existing.accountName}`;

    // If referenced by topups, soft-delete (deactivate) instead of hard-delete
    if (existing.topups.length > 0) {
      await this.prisma.bankAccount.update({
        where: { id },
        data: { active: false },
      });
      if (actor) {
        void this.recordBankAuditAsync({
          action: 'BANK_ACCOUNT_DEACTIVATE',
          summarize: (adminLabel) =>
            `${adminLabel} "${label}" banka hesabını pasifleştirdi (geçmiş talepler nedeniyle silinmedi)`,
          actor,
          target: { id, type: 'bank-account', label },
          extra: { reason: 'has-historical-topups', softDeleted: true },
          req: req ?? null,
        });
      }
      return {
        success: true,
        data: { id, softDeleted: true },
      };
    }

    await this.prisma.bankAccount.delete({ where: { id } });
    if (actor) {
      void this.recordBankAuditAsync({
        action: 'BANK_ACCOUNT_DELETE',
        summarize: (adminLabel) => `${adminLabel} "${label}" banka hesabını sildi`,
        actor,
        target: { id, type: 'bank-account', label },
        extra: { iban: existing.iban },
        req: req ?? null,
      });
    }
    return { success: true, data: { id, softDeleted: false } };
  }

  private async recordBankAuditAsync(params: {
    action: string;
    summarize: (adminLabel: string) => string;
    actor: { id: string; email?: string | null; tenantId?: string | null };
    target: { id: string; type: string; label: string };
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    extra?: Record<string, unknown> | null;
    req?: Request | null;
  }): Promise<void> {
    try {
      const admin = await this.prisma.user
        .findUnique({
          where: { id: params.actor.id },
          select: { id: true, name: true, email: true, tenantId: true },
        })
        .catch(() => null);
      const adminLabel = admin?.name?.trim() || admin?.email?.trim() || params.actor.email || 'admin';
      await this.audit.record({
        action: params.action,
        summary: params.summarize(adminLabel),
        actor: {
          type: 'admin',
          id: admin?.id ?? params.actor.id,
          name: admin?.name ?? null,
          email: admin?.email ?? params.actor.email ?? null,
          tenantId: admin?.tenantId ?? params.actor.tenantId ?? null,
        },
        target: params.target,
        before: params.before ?? null,
        after: params.after ?? null,
        extra: params.extra ?? null,
        req: params.req ?? null,
      });
    } catch (e) {
      this.logger.warn(`audit log failed (bank account): ${(e as Error).message}`);
    }
  }

  // ---------- ORDER PAYMENT (called from OrdersService) ----------

  /**
   * Atomically debit cari balance for an order.
   * MUST be called inside the same Prisma.$transaction as Order.create.
   * Throws BadRequestException if insufficient balance.
   *
   * @returns { ledgerId, newBalance }
   */
  async debitForOrderTx(
    tx: Prisma.TransactionClient,
    params: {
      customerId: string;
      orderId: string;
      amount: Prisma.Decimal;
      humanOrderNo: string | null;
    },
  ): Promise<{ ledgerId: string; newBalance: Prisma.Decimal }> {
    // İDEMPOTENCY (savunma): bu sipariş için ORDER_PAYMENT zaten yazıldıysa
    // ikinci çağrıda ÇİFT DÜŞÜM yapma — mevcut kaydı ve güncel bakiyeyi döndür.
    // ORDER_PAYMENT sipariş başına bir kezdir (REFUND'ın aksine kısmi olmaz),
    // bu yüzden bu guard meşru hiçbir akışı bozmaz. (DB-unique yerine güvenli
    // app-katmanı koruması; blanket (orderId,type) unique kısmi iadeleri bozardı.)
    const existingPayment = await tx.cariLedger.findFirst({
      where: { orderId: params.orderId, type: 'ORDER_PAYMENT' },
      select: { id: true },
    });
    // Lock customer row
    await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Customer" WHERE id = ${params.customerId} FOR UPDATE
    `;
    const customer = await tx.customer.findUnique({
      where: { id: params.customerId },
      select: { id: true, cariBalance: true },
    });
    if (!customer) throw new NotFoundException('customer not found');
    if (existingPayment) {
      return {
        ledgerId: existingPayment.id,
        newBalance: decimalRound2(new Prisma.Decimal(customer.cariBalance)),
      };
    }

    const balance = decimalRound2(new Prisma.Decimal(customer.cariBalance));
    const amount = decimalRound2(new Prisma.Decimal(params.amount));
    // Yeterlilik — KURUŞ-YUVARLAMA TOLERANSLI. Müşteriye gösterilen toplam
    // (frontend, JS-float: sepet KDV'yi yuvarlamaz, birim fiyatları Math.round'lar)
    // ile backend'in tahsil ettiği toplam (Prisma.Decimal, kuruş-yuvarlamalı)
    // arasında ≤ birkaç kuruşluk sapma olabilir. Bakiyesi gösterilen toplama TAM
    // yeten müşteri bu drift yüzünden bloklanmasın — CANLI BUG: bakiye 557,03 =
    // gösterilen sipariş 557,03 iken backend 557,04 hesaplayıp "insufficient"
    // atıyordu. Yalnız bu eşiği AŞAN açık GERÇEK yetersizliktir (gerçek eksik
    // kuruş değil TL mertebesindedir). Eşik-içi sapmada tam tutar düşülür; bakiye
    // en çok eşik kadar (≤5 kr) eksiye düşebilir, ledger=order.total korunur,
    // sonraki bakiye yüklemesinde kapanır.
    const ROUNDING_TOL = new Prisma.Decimal('0.05');
    if (amount.sub(balance).greaterThan(ROUNDING_TOL)) {
      throw new BadRequestException('insufficient cari balance');
    }

    const newBalance = decimalRound2(balance.sub(amount));

    await tx.customer.update({
      where: { id: customer.id },
      data: { cariBalance: newBalance },
    });

    const ledger = await tx.cariLedger.create({
      data: {
        customerId: customer.id,
        type: 'ORDER_PAYMENT',
        amount: amount.negated(), // negative = debit
        balanceAfter: newBalance,
        orderId: params.orderId,
        description: params.humanOrderNo
          ? `Sipariş #${params.humanOrderNo} ödemesi`
          : 'Sipariş ödemesi',
      },
      select: { id: true },
    });

    // ── PROMO (hoşgeldin) tüketimi — promo-önce (FIFO), sipariş'e snapshot ──────
    // Önce promo kredisi VAR MI diye tek ucuz sorgu; yoksa (müşterilerin çoğu)
    // ek sorgu/update HİÇ yapılmaz (sıcak checkout yolu korunur).
    const promoGrantAgg = await tx.cariLedger.aggregate({
      where: { customerId: customer.id, isPromo: true, amount: { gt: 0 } },
      _sum: { amount: true },
    });
    const granted = new Prisma.Decimal(promoGrantAgg._sum.amount ?? 0);
    if (granted.greaterThan(0)) {
      // Tüketim tabanı finans promoCum ile AYNI statü kümesi (paid/preparing/
      // shipped) olmalı: iptal/iade edilen promo sipariş havuza geri döner, aksi
      // halde promo kilitlenir ve yeniden harcanan tutar promo-gidersiz kâr sayılırdı.
      const promoUsedAgg = await tx.order.aggregate({
        where: {
          customerId: customer.id,
          status: { in: ['paid', 'preparing', 'shipped'] },
          promoBalanceApplied: { gt: 0 },
        },
        _sum: { promoBalanceApplied: true },
      });
      const consumed = new Prisma.Decimal(
        promoUsedAgg._sum.promoBalanceApplied ?? 0,
      );
      // Güvenlik tavanı (savunma): promo, debit ÖNCESİ bakiyeyi ve 0'ı aşamaz.
      let remainingPromo = granted.sub(consumed);
      if (remainingPromo.greaterThan(balance)) remainingPromo = balance;
      if (remainingPromo.lessThan(0)) remainingPromo = new Prisma.Decimal(0);
      const promoApplied = decimalRound2(
        amount.lessThan(remainingPromo) ? amount : remainingPromo,
      );
      if (promoApplied.greaterThan(0)) {
        await tx.order.update({
          where: { id: params.orderId },
          data: { promoBalanceApplied: promoApplied },
        });
      }
    }

    return { ledgerId: ledger.id, newBalance };
  }

  /**
   * Atomically refund cari balance for an order (reverse of debitForOrderTx).
   * MUST be called inside a Prisma.$transaction.
   *
   * @returns { ledgerId, previousBalance, newBalance }
   */
  async refundForOrderTx(
    tx: Prisma.TransactionClient,
    params: {
      customerId: string;
      orderId: string;
      amount: Prisma.Decimal;
      humanOrderNo: string | null;
    },
  ): Promise<{
    ledgerId: string;
    previousBalance: Prisma.Decimal;
    newBalance: Prisma.Decimal;
  }> {
    await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Customer" WHERE id = ${params.customerId} FOR UPDATE
    `;
    const customer = await tx.customer.findUnique({
      where: { id: params.customerId },
      select: { id: true, cariBalance: true },
    });
    if (!customer) throw new NotFoundException('customer not found');

    const previousBalance = decimalRound2(new Prisma.Decimal(customer.cariBalance));
    const amount = decimalRound2(new Prisma.Decimal(params.amount));
    const newBalance = decimalRound2(previousBalance.add(amount));

    await tx.customer.update({
      where: { id: customer.id },
      data: { cariBalance: newBalance },
    });

    const ledger = await tx.cariLedger.create({
      data: {
        customerId: customer.id,
        type: 'REFUND',
        amount,
        balanceAfter: newBalance,
        orderId: params.orderId,
        description: params.humanOrderNo
          ? `Sipariş #${params.humanOrderNo} iptal ücreti`
          : 'Sipariş iptal ücreti',
      },
      select: { id: true },
    });

    return { ledgerId: ledger.id, previousBalance, newBalance };
  }

  /**
   * §2.2 REAKTİVASYON — İPTAL İADESİNİ GERİ AL (yeniden ücretlendirme).
   * Sipariş 'cancelled'dan tekrar aktife (paid/preparing/shipped) çekildiğinde
   * çağrılır: iptalde oluşturulan REFUND satırlarını SİLER ve toplamı kadar cari
   * bakiyeyi yeniden DÜŞER. Böylece sipariş "sanki hiç iptal olmamış" gibi
   * ücretlendirilmiş duruma döner; tekrar iptal edilirse netPaid formülü doğru
   * çalışır (REFUND artık yok → iade sıfırlanmaz). Kart siparişinde de doğru:
   * iptalin cariye yazdığı REFUND kredisi geri alınır (kart tahsilatı dışarıda
   * durur). Yetersiz bakiyede BadRequestException → tüm transaction rollback.
   * MUTLAKA bir $transaction içinde çağrılmalı.
   *
   * @returns { recharged, newBalance } — recharged=0 ise iade kaydı yoktu (no-op).
   */
  async reverseCancelRefundTx(
    tx: Prisma.TransactionClient,
    params: { customerId: string; orderId: string },
  ): Promise<{ recharged: Prisma.Decimal; newBalance: Prisma.Decimal }> {
    await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Customer" WHERE id = ${params.customerId} FOR UPDATE
    `;
    const customer = await tx.customer.findUnique({
      where: { id: params.customerId },
      select: { id: true, cariBalance: true },
    });
    if (!customer) throw new NotFoundException('customer not found');

    const refunds = await tx.cariLedger.findMany({
      where: {
        orderId: params.orderId,
        customerId: params.customerId,
        type: 'REFUND',
      },
      select: { id: true, amount: true },
    });
    const balance = decimalRound2(new Prisma.Decimal(customer.cariBalance));
    const sum = decimalRound2(
      refunds.reduce(
        (acc, r) => acc.add(new Prisma.Decimal(r.amount)),
        new Prisma.Decimal(0),
      ),
    );
    if (sum.lessThanOrEqualTo(0)) {
      return { recharged: new Prisma.Decimal(0), newBalance: balance };
    }
    if (balance.lessThan(sum)) {
      throw new BadRequestException(
        'Reaktivasyon başarısız: müşterinin cari bakiyesi sipariş iadesini geri ' +
          'almaya yetmiyor. Önce cari bakiye yükletin.',
      );
    }
    const newBalance = decimalRound2(balance.sub(sum));
    await tx.customer.update({
      where: { id: customer.id },
      data: { cariBalance: newBalance },
    });
    await tx.cariLedger.deleteMany({
      where: { id: { in: refunds.map((r) => r.id) } },
    });
    return { recharged: sum, newBalance };
  }

  async getStatementForCustomer(customerId: string, q: CariStatementQueryDto) {
    const page = q.page ?? 1;
    const pageSize = Math.min(q.pageSize ?? 50, 200);
    const where: Prisma.CariLedgerWhereInput = { customerId };
    if (q.type) where.type = q.type as CariLedgerType;
    {
      // TR takvim günü: başlangıç dahil, bitiş günü de DAHİL (yarı-açık üst sınır).
      const range = trDateRange(q.from, q.to);
      if (range) where.createdAt = range;
    }
    if (q.search) {
      where.OR = [
        { description: { contains: q.search, mode: 'insensitive' } },
        { order: { humanOrderNo: { contains: q.search, mode: 'insensitive' } } },
      ];
    }
    const [total, rows] = await Promise.all([
      this.prisma.cariLedger.count({ where }),
      this.prisma.cariLedger.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          order: { select: { humanOrderNo: true } },
          topup: { select: { status: true } },
        },
      }),
    ]);

    return {
      success: true,
      data: rows.map((r) => ({
        id: r.id,
        type: r.type,
        amount: Number(r.amount),
        balanceAfter: Number(r.balanceAfter),
        description: r.description,
        createdAt: r.createdAt.toISOString(),
        orderId: r.orderId,
        topupId: r.topupId,
        humanOrderNo: r.order?.humanOrderNo ?? null,
        topupStatus: r.topup?.status ?? null,
      })),
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  async getStatementSummaryForCustomer(customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { cariBalance: true },
    });
    const [
      topupSum,
      refundSum,
      paymentSumNeg,
      adjustmentPosSum,
      adjustmentNegSum,
      pendingTopupCount,
    ] = await Promise.all([
      this.prisma.cariLedger.aggregate({
        where: { customerId, type: 'TOPUP' },
        _sum: { amount: true },
      }),
      this.prisma.cariLedger.aggregate({
        where: { customerId, type: 'REFUND' },
        _sum: { amount: true },
      }),
      this.prisma.cariLedger.aggregate({
        where: { customerId, type: 'ORDER_PAYMENT' },
        _sum: { amount: true },
      }),
      this.prisma.cariLedger.aggregate({
        where: { customerId, type: 'ADJUSTMENT', amount: { gte: 0 } },
        _sum: { amount: true },
      }),
      this.prisma.cariLedger.aggregate({
        where: { customerId, type: 'ADJUSTMENT', amount: { lt: 0 } },
        _sum: { amount: true },
      }),
      this.prisma.cariTopup.count({
        // Kart denemeleri (PENDING) geçici POS ara durumudur — sayılmaz.
        where: { customerId, status: 'PENDING', method: { not: 'card' } },
      }),
    ]);

    // "Toplam Yüklenen" = müşterinin DIŞARIDAN koyduğu para (havale/kart
    // yüklemeleri + pozitif manuel düzeltme). Sipariş iadesi (REFUND) yeni
    // para DEĞİLDİR — yüklenene eklenmez; iptal edilen harcama olduğu için
    // "Toplam Harcanan"dan düşülür (NET harcama). Böylece
    // yüklenen − harcanan = mevcut bakiye eşitliği de korunur.
    const totalLoaded =
      Number(topupSum._sum.amount ?? 0) +
      Number(adjustmentPosSum._sum.amount ?? 0);
    const totalSpent = Math.max(
      0,
      Math.abs(Number(paymentSumNeg._sum.amount ?? 0)) +
        Math.abs(Number(adjustmentNegSum._sum.amount ?? 0)) -
        Number(refundSum._sum.amount ?? 0),
    );

    return {
      success: true,
      data: {
        currentBalance: Number(customer?.cariBalance ?? 0),
        totalLoaded,
        totalSpent,
        pendingTopupCount,
      },
    };
  }

  async exportStatementForCustomer(customerId: string, q: CariStatementQueryDto) {
    const where: Prisma.CariLedgerWhereInput = { customerId };
    if (q.type) where.type = q.type as CariLedgerType;
    {
      // TR takvim günü: başlangıç dahil, bitiş günü de DAHİL (yarı-açık üst sınır).
      const range = trDateRange(q.from, q.to);
      if (range) where.createdAt = range;
    }
    if (q.search) {
      where.OR = [
        { description: { contains: q.search, mode: 'insensitive' } },
        { order: { humanOrderNo: { contains: q.search, mode: 'insensitive' } } },
      ];
    }
    const rows = await this.prisma.cariLedger.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      include: { order: { select: { humanOrderNo: true } } },
      take: 10_000,
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Toptan Budur';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('Cari Hesap Ekstresi', {
      views: [{ state: 'frozen', ySplit: 4 }],
    });
    sheet.columns = [
      { key: 'date', width: 18 },
      { key: 'type', width: 14 },
      { key: 'desc', width: 48 },
      { key: 'orderNo', width: 16 },
      { key: 'loaded', width: 16 },
      { key: 'spent', width: 16 },
      { key: 'balance', width: 16 },
    ];
    sheet.mergeCells('A1:G1');
    const title = sheet.getCell('A1');
    title.value = 'Toptan Budur — Cari Hesap Ekstresi';
    title.font = { name: 'Calibri', size: 18, bold: true, color: { argb: 'FFFFFFFF' } };
    title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1267F4' } };
    sheet.getRow(1).height = 32;
    sheet.getRow(3).values = [
      'Tarih',
      'Tip',
      'Açıklama',
      'Sipariş No',
      'Yüklenen (₺)',
      'Harcanan (₺)',
      'Bakiye (₺)',
    ];
    sheet.getRow(3).font = { bold: true };

    let runningLoaded = 0;
    let runningSpent = 0;
    rows.forEach((r) => {
      const amt = Number(r.amount);
      let loaded: number | null = null;
      let spent: number | null = null;
      if (r.type === 'TOPUP' || r.type === 'REFUND') {
        loaded = Math.abs(amt);
      } else if (r.type === 'ORDER_PAYMENT') {
        spent = Math.abs(amt);
      } else if (r.type === 'ADJUSTMENT') {
        if (amt >= 0) loaded = amt;
        else spent = Math.abs(amt);
      }
      if (loaded !== null) runningLoaded += loaded;
      if (spent !== null) runningSpent += spent;
      sheet.addRow({
        date: r.createdAt,
        type: cariTypeLabel(r.type),
        desc: r.description ?? '',
        orderNo: r.order?.humanOrderNo ?? '',
        loaded: loaded,
        spent: spent,
        balance: Number(r.balanceAfter),
      });
    });

    const totalRow = sheet.addRow({
      date: '',
      type: '',
      desc: 'TOPLAM',
      orderNo: '',
      loaded: runningLoaded,
      spent: runningSpent,
      balance: '',
    });
    totalRow.font = { bold: true };

    sheet.getColumn('loaded').numFmt = '#,##0.00 "₺"';
    sheet.getColumn('spent').numFmt = '#,##0.00 "₺"';
    sheet.getColumn('balance').numFmt = '#,##0.00 "₺"';
    sheet.getColumn('date').numFmt = 'dd.mm.yyyy hh:mm';

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const filename = `cari-hesap-ekstresi-${trTodayKey()}.xlsx`;
    return { buffer, filename };
  }

  // ---------- NET HARCAMA / CİRO İADE DÜŞÜMÜ (paylaşılan yardımcılar) ----------

  /**
   * Toplam İADE (müşteriye geri ödenen para) tutarını müşteri bazında döndürür.
   *
   * NET HARCAMA = Σ Order.total (status NOT IN cancelled,refunded)
   *             − Σ CariLedger.amount (type='REFUND', bağlı Order status NOT IN cancelled,refunded)
   * formülünün "− Σ iade" ayağıdır. Yalnızca type='REFUND' satırları sayılır.
   *
   * İptal edilmiş sipariş de bir REFUND satırı yazar; ancak gross ciro zaten
   * cancelled siparişleri dışladığından, JOIN'deki `o.status NOT IN
   * ('cancelled','refunded')` filtresi bu satırın tekrar düşülmesini (çifte
   * düşüm) engeller.
   *
   * Tarih filtresi siparişin (Order.createdAt) tarihine göre uygulanır — iade
   * satırının createdAt'ine değil — böylece gross ciroyla AYNI zaman eksenine
   * oturur.
   *
   * @returns Map<customerId, toplamİadeTutarı(pozitif ₺)>
   */
  async refundTotalsByCustomer(params: {
    tenantId?: string;
    customerIds?: string[];
    orderCreatedFrom?: Date;
    orderCreatedTo?: Date;
  }): Promise<Map<string, number>> {
    const { tenantId, customerIds, orderCreatedFrom, orderCreatedTo } = params;

    // Boş id listesi verildiyse hiç sorgu atma.
    if (customerIds && customerIds.length === 0) return new Map();

    // En az bir kapsam (tenant ya da müşteri listesi) zorunlu — yoksa sorgu tüm
    // tenant'ların iadelerini toplar. Müşteri tarafı (Customer.tenantId yok)
    // sadece customerIds verir; admin tarafı tenantId verir.
    if (!tenantId && (!customerIds || customerIds.length === 0)) {
      throw new Error(
        'refundTotalsByCustomer: tenantId veya customerIds zorunlu',
      );
    }

    const tenantFilter = tenantId
      ? Prisma.sql`AND o."tenantId" = ${tenantId}`
      : Prisma.empty;
    const customerFilter =
      customerIds && customerIds.length
        ? Prisma.sql`AND o."customerId" IN (${Prisma.join(customerIds)})`
        : Prisma.empty;
    const fromFilter = orderCreatedFrom
      ? Prisma.sql`AND o."createdAt" >= ${orderCreatedFrom}`
      : Prisma.empty;
    const toFilter = orderCreatedTo
      ? Prisma.sql`AND o."createdAt" <= ${orderCreatedTo}`
      : Prisma.empty;

    const rows = await this.prisma.$queryRaw<{ cid: string; total: string }[]>(
      Prisma.sql`
        SELECT o."customerId" AS cid,
               COALESCE(SUM(cl.amount), 0)::text AS total
        FROM "CariLedger" cl
        JOIN "Order" o ON o.id = cl."orderId"
        WHERE cl.type = 'REFUND'
          ${tenantFilter}
          AND o.status NOT IN ('cancelled', 'refunded')
          ${customerFilter}
          ${fromFilter}
          ${toFilter}
        GROUP BY o."customerId"
      `,
    );

    const map = new Map<string, number>();
    for (const r of rows) {
      if (!r.cid) continue;
      map.set(r.cid, Number(r.total) || 0);
    }
    return map;
  }

  /**
   * Belirli bir tenant ve (opsiyonel) sipariş tarihi penceresi için toplam
   * İADE tutarını tek sayı olarak döndürür. {@link refundTotalsByCustomer}'ın
   * müşteri kırılımı olmayan sürümüdür; ciro/dashboard pencerelerinde
   * NET = max(0, gross − iade) için kullanılır.
   *
   * @returns Toplam iade tutarı (pozitif ₺); kayıt yoksa 0.
   */
  async refundTotalInWindow(params: {
    tenantId: string;
    orderCreatedFrom?: Date;
    orderCreatedTo?: Date;
  }): Promise<number> {
    const { tenantId, orderCreatedFrom, orderCreatedTo } = params;

    const fromFilter = orderCreatedFrom
      ? Prisma.sql`AND o."createdAt" >= ${orderCreatedFrom}`
      : Prisma.empty;
    const toFilter = orderCreatedTo
      ? Prisma.sql`AND o."createdAt" <= ${orderCreatedTo}`
      : Prisma.empty;

    const rows = await this.prisma.$queryRaw<{ total: string }[]>(
      Prisma.sql`
        SELECT COALESCE(SUM(cl.amount), 0)::text AS total
        FROM "CariLedger" cl
        JOIN "Order" o ON o.id = cl."orderId"
        WHERE cl.type = 'REFUND'
          AND o."tenantId" = ${tenantId}
          AND o.status NOT IN ('cancelled', 'refunded')
          ${fromFilter}
          ${toFilter}
      `,
    );

    return Number(rows[0]?.total ?? 0) || 0;
  }
}

function cariTypeLabel(t: CariLedgerType): string {
  if (t === 'TOPUP') return 'Yükleme';
  if (t === 'ORDER_PAYMENT') return 'Sipariş';
  if (t === 'REFUND') return 'İptal Ücreti';
  return 'Düzeltme';
}
