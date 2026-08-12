import { Injectable, NotFoundException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../../prisma/prisma.service';
import { trDayStart, trDayEndExclusive } from '../../common/utils/tr-time';

// ──────────────────────────────────────────────────────────────────────────
//  MUHASEBE servisi — muhasebe.md Faz 3/4/5
//
//  Tek sorumluluk: muhasebeci için cari hareket dökümü, tedarikçi hesabı ve
//  bayi hesabı + Excel çıktıları. Tüm sorgular tenant_id (RLS) filtreli.
//
//  Tutar işaret kuralları (mevcut ledger'lardan doğrulandı):
//   • SupplierAccountLedger: TOPUP +, ORDER_PURCHASE −, ORDER_REFUND +,
//     ADJUSTMENT/MANUAL_SET işaretli. balanceAfter = o an bizim tedarikçideki
//     bakiyemiz (pozitif = tedarikçide paramız var).
//   • CariLedger: TOPUP +, ORDER_PAYMENT −, REFUND +, ADJUSTMENT işaretli.
//     balanceAfter = bayinin ön-ödemeli cari bakiyesi.
//
//  Borç/Alacak gösterimi (her iki taraf için tek kural): amount ≥ 0 → ALACAK
//  (giriş), amount < 0 → BORÇ (çıkış, mutlak değer). bakiye = balanceAfter.
// ──────────────────────────────────────────────────────────────────────────

type LedgerType = 'supplier' | 'dealer';

export interface LedgerRow {
  id: string;
  date: string;
  type: string;
  description: string | null;
  debit: number;
  credit: number;
  balanceAfter: number | null;
  orderId: string | null;
  humanOrderNo: string | null;
  /** Tedarikçide oluşturulan sipariş numarası (Order.supplierOrderNo). Sipariş
   *  silinmiş ya da henüz tedarikçiye verilmemişse null → ekranda "—". */
  supplierOrderNo: string | null;
}

export interface LedgerResult {
  type: LedgerType;
  entity: { id: string; name: string };
  currentBalance: number;
  rows: LedgerRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SupplierAccountReport {
  supplier: { id: string; name: string };
  range: { from: string | null; to: string | null };
  openingBalance: number;
  closingBalance: number;
  currentBalance: number;
  topupTotal: number;
  purchaseTotal: number;
  refundTotal: number;
  adjustmentNet: number;
  /** Net hareket = topup − purchase + refund + adjustmentNet (refund/adjustment
   *  ARTIK dahil; closingBalance − openingBalance'a eşit olur). */
  netBalance: number;
  /**
   * §orta — MUTABAKAT (Bayi Hesap ile aynı mantık): açılış + giriş − çıkış =
   * beklenen kapanış; gerçek kapanışa EŞİT olmalı. diff≈0 değilse tutarsızlık.
   *   giriş  = topup + refund + (+)adjustment
   *   çıkış  = purchase + (−)adjustment
   */
  reconciliation: {
    inflow: number;
    outflow: number;
    expectedClosing: number;
    closingBalance: number;
    diff: number;
    consistent: boolean;
  };
  topups: Array<{
    id: string;
    date: string;
    amount: number;
    description: string | null;
  }>;
  purchases: Array<{
    id: string;
    date: string;
    amount: number;
    orderId: string | null;
    humanOrderNo: string | null;
    supplierOrderNo: string | null;
    description: string | null;
  }>;
  /**
   * Sipariş İADELERİ / İPTALLERİ (SupplierAccountLedger ORDER_REFUND) — kalem
   * kalem. İptal/iade tedarikçi cüzdanımıza geri yükleme olduğundan giriştir;
   * tutar mutlak (pozitif) tutulur. Eskiden yalnız refundTotal toplamı vardı,
   * dökümde görünmüyordu.
   */
  refunds: Array<{
    id: string;
    date: string;
    amount: number;
    orderId: string | null;
    humanOrderNo: string | null;
    supplierOrderNo: string | null;
    description: string | null;
  }>;
  movements: LedgerRow[];
}

export interface DealerAccountReport {
  customer: {
    id: string;
    name: string;
    companyTitle: string | null;
    email: string;
    bayiNo: string | null;
  };
  range: { from: string | null; to: string | null };
  openingBalance: number;
  closingBalance: number;
  currentBalance: number;
  orders: Array<{
    id: string;
    date: string;
    humanOrderNo: string;
    supplierOrderNo: string | null;
    total: number;
    paymentType: string | null;
    status: string;
    invoiceNumber: string | null;
    invoiceUrl: string | null;
    invoicedAt: string | null;
  }>;
  /** Toplam sipariş (TÜM siparişler, ham — bilgi). */
  orderTotal: number;
  topups: Array<{
    id: string;
    date: string;
    amount: number;
    method: string;
    source: string;
    status: string;
    humanTopupNo: string | null;
  }>;
  // ── KALEM KALEM hareket toplamları (hepsi gerçek veriden) ────────────────
  /** Onaylı havale/EFT ile cari yüklemeleri. */
  topupHavaleTotal: number;
  /** Onaylı KART ile cari yüklemeleri (cariye karttan ödeme). */
  topupCardTotal: number;
  /** Onaylı toplam yükleme (havale + kart). Cari bakiye kimliğinde kullanılır. */
  topupTotal: number;
  /** KART ile DİREKT ödenen siparişler (cari'den geçmez); iptal/bekleyen hariç. */
  cardOrderTotal: number;
  /** Cari bakiyeden ödenen siparişler (CariLedger ORDER_PAYMENT), pozitif. */
  cariPaymentTotal: number;
  /** Toplam sipariş = cari'den ödenen + kart ile ödenen ("iş hacmi"). */
  purchaseTotal: number;
  /** CariLedger REFUND (iade, cariye dönen), pozitif. */
  refundTotal: number;
  /** CariLedger ADJUSTMENT net (işaretli; + alacak / − borç). */
  adjustmentNet: number;
  invoiceTotal: number;
  /**
   * MUTABAKAT — her şey dahil (kart iki tarafta da yer alır, birbirini götürür):
   *   GİRİŞ  = açılış + havale + kart yükleme + kart sipariş ödemesi + iade + (+)düzeltme
   *   ÇIKIŞ  = cari sipariş ödemeleri + kart sipariş ödemeleri + (−)düzeltme
   *   beklenen kapanış = GİRİŞ − ÇIKIŞ  →  gerçek kapanış bakiyesine EŞİT olmalı.
   * Kart sipariş tutarı hem giriş hem çıkışta olduğundan götürür; sağlam veride
   * diff ≈ 0. Sıfırdan saparsa GERÇEK tutarsızlıktır.
   */
  reconciliation: {
    inflow: number;
    outflow: number;
    expectedClosing: number;
    closingBalance: number;
    diff: number;
    consistent: boolean;
  };
}

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 50;
const BALANCE_EPSILON = 0.01;
/** Cari Hareketler Excel'i TÜM hareketleri verir; tek cari için makul üst sınır
 *  (yıllar boyunca dahi aşılması beklenmez, bellek koruması). */
const LEDGER_EXPORT_CAP = 10000;

const NUMFMT_TRY = '#,##0.00 "₺"';

const COLOR = {
  navy: 'FF0F2A4F',
  white: 'FFFFFFFF',
  zebra: 'FFF7F8FA',
  border: 'FFE5E7EB',
  totalBg: 'FFFEF3C7',
} as const;

function toNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v) || 0;
  if (typeof (v as { toString?: () => string }).toString === 'function') {
    return parseFloat((v as { toString: () => string }).toString()) || 0;
  }
  return 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** YYYY-MM-DD → o günün TÜRKİYE saatiyle GÜN BAŞI (UTC anı). Geçersizse null.
 *  Eski UTC hesabı gün başını 03:00 TR'ye kaydırıp günün ilk 3 saatini eliyordu;
 *  artık tüm muhasebe raporları Tedarikçi Cari/Karlılık ile aynı TR sınırını
 *  kullanır. */
function parseFrom(from?: string): Date | null {
  return trDayStart(from);
}

/** YYYY-MM-DD → o günün TÜRKİYE saatiyle GÜN SONU (DAHİL; `lte` ile kullanım
 *  için ertesi TR günü 00:00'dan 1 ms önce). "Bugüne kadar" filtresi artık
 *  BUGÜNÜ de tam sayar; eski UTC hesabı son günün siparişlerini kırpabiliyordu. */
function parseTo(to?: string): Date | null {
  const end = trDayEndExclusive(to);
  return end ? new Date(end.getTime() - 1) : null;
}

function rangeFilter(
  from: Date | null,
  to: Date | null,
): { gte?: Date; lte?: Date } | undefined {
  if (!from && !to) return undefined;
  const f: { gte?: Date; lte?: Date } = {};
  if (from) f.gte = from;
  if (to) f.lte = to;
  return f;
}

/** İşaretli tutarı borç/alacak kolonlarına ayırır. */
function splitDebitCredit(amount: number): { debit: number; credit: number } {
  return amount >= 0
    ? { debit: 0, credit: round2(amount) }
    : { debit: round2(Math.abs(amount)), credit: 0 };
}

function fmtDateTimeTR(d: Date): string {
  return d.toLocaleString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Istanbul',
  });
}

/** Ledger hareket tipi → insan-okunur etiket (FE ledgerTypeLabel ile aynı). */
const LEDGER_TYPE_LABELS: Record<string, string> = {
  // Bayi (CariLedgerType)
  TOPUP: 'Bakiye Yükleme',
  ORDER_PAYMENT: 'Sipariş Ödemesi',
  REFUND: 'İade / İptal',
  ADJUSTMENT: 'Düzeltme',
  // Tedarikçi (SupplierLedgerType)
  MANUAL_SET: 'Manuel Bakiye',
  ORDER_PURCHASE: 'Sipariş Alımı',
  ORDER_REFUND: 'Sipariş İadesi / İptali',
};

function ledgerTypeLabel(type: string): string {
  return LEDGER_TYPE_LABELS[type] ?? type;
}

/** CariTopup.method → insan-okunur kaynak etiketi. */
function topupSourceLabel(method: string): string {
  switch (method) {
    case 'card':
      return 'Kart (PayTR/TOSLA)';
    case 'bank_transfer':
      return 'Havale/EFT';
    default:
      return method || 'Havale/EFT';
  }
}

@Injectable()
export class AdminMuhasebeService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Arama uçları (yetki: herhangi bir authed admin) ──────────────────────

  async searchSuppliers(
    tenantId: string,
    q: string,
  ): Promise<Array<{ id: string; name: string }>> {
    const term = (q ?? '').trim();
    const rows = await this.prisma.supplier.findMany({
      where: {
        tenantId,
        ...(term
          ? { name: { contains: term, mode: 'insensitive' as const } }
          : {}),
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: 20,
    });
    return rows;
  }

  async searchCustomers(
    tenantId: string,
    q: string,
  ): Promise<
    Array<{
      id: string;
      name: string;
      companyTitle: string | null;
      email: string;
      bayiNo: string | null;
    }>
  > {
    const term = (q ?? '').trim();
    const rows = await this.prisma.customer.findMany({
      where: term
        ? {
            OR: [
              { name: { contains: term, mode: 'insensitive' as const } },
              { companyTitle: { contains: term, mode: 'insensitive' as const } },
              { email: { contains: term, mode: 'insensitive' as const } },
              { bayiNo: { contains: term, mode: 'insensitive' as const } },
            ],
          }
        : {},
      select: {
        id: true,
        name: true,
        companyTitle: true,
        email: true,
        bayiNo: true,
      },
      orderBy: { name: 'asc' },
      take: 20,
    });
    return rows;
  }

  // ── Faz 3: Birleşik cari hareket dökümü ──────────────────────────────────

  async getLedger(
    tenantId: string,
    type: LedgerType,
    id: string,
    opts: { from?: string; to?: string; page?: number; pageSize?: number },
  ): Promise<LedgerResult> {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, opts.pageSize ?? DEFAULT_PAGE_SIZE),
    );
    const from = parseFrom(opts.from);
    const to = parseTo(opts.to);
    const created = rangeFilter(from, to);

    if (type === 'supplier') {
      const supplier = await this.assertSupplier(tenantId, id);
      const account = await this.prisma.supplierAccount.findUnique({
        where: { supplierId: id },
        select: { balance: true },
      });
      const where = {
        tenantId,
        supplierId: id,
        ...(created ? { createdAt: created } : {}),
      };
      const [total, rows] = await Promise.all([
        this.prisma.supplierAccountLedger.count({ where }),
        this.prisma.supplierAccountLedger.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: {
            id: true,
            type: true,
            amount: true,
            balanceAfter: true,
            orderId: true,
            humanOrderNo: true,
            description: true,
            createdAt: true,
            order: { select: { supplierOrderNo: true } },
          },
        }),
      ]);
      return {
        type,
        entity: { id, name: supplier.name },
        currentBalance: round2(toNum(account?.balance)),
        rows: rows.map((r) => {
          const amt = toNum(r.amount);
          const { debit, credit } = splitDebitCredit(amt);
          return {
            id: r.id,
            date: r.createdAt.toISOString(),
            type: r.type,
            description: r.description,
            debit,
            credit,
            balanceAfter: round2(toNum(r.balanceAfter)),
            orderId: r.orderId,
            humanOrderNo: r.humanOrderNo,
            supplierOrderNo: r.order?.supplierOrderNo ?? null,
          };
        }),
        total,
        page,
        pageSize,
      };
    }

    // dealer
    const customer = await this.assertCustomer(id);
    const where = {
      customerId: id,
      ...(created ? { createdAt: created } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.cariLedger.count({ where }),
      this.prisma.cariLedger.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          type: true,
          amount: true,
          balanceAfter: true,
          orderId: true,
          description: true,
          createdAt: true,
          order: { select: { humanOrderNo: true, supplierOrderNo: true } },
        },
      }),
    ]);
    return {
      type,
      entity: { id, name: customer.companyTitle || customer.name },
      currentBalance: round2(toNum(customer.cariBalance)),
      rows: rows.map((r) => {
        const amt = toNum(r.amount);
        const { debit, credit } = splitDebitCredit(amt);
        return {
          id: r.id,
          date: r.createdAt.toISOString(),
          type: r.type,
          description: r.description,
          debit,
          credit,
          balanceAfter: round2(toNum(r.balanceAfter)),
          orderId: r.orderId,
          humanOrderNo: r.order?.humanOrderNo ?? null,
          supplierOrderNo: r.order?.supplierOrderNo ?? null,
        };
      }),
      total,
      page,
      pageSize,
    };
  }

  // ── Faz 4: Tedarikçi hesabı ──────────────────────────────────────────────

  async getSupplierAccountReport(
    tenantId: string,
    supplierId: string,
    opts: { from?: string; to?: string },
  ): Promise<SupplierAccountReport> {
    const supplier = await this.assertSupplier(tenantId, supplierId);
    const from = parseFrom(opts.from);
    const to = parseTo(opts.to);

    const account = await this.prisma.supplierAccount.findUnique({
      where: { supplierId },
      select: { balance: true },
    });
    const currentBalance = round2(toNum(account?.balance));

    const [openingBalance, closingBalance] = await Promise.all([
      this.supplierBalanceAt(tenantId, supplierId, from, true),
      this.supplierBalanceAt(tenantId, supplierId, to, false),
    ]);

    const created = rangeFilter(from, to);
    const movements = await this.prisma.supplierAccountLedger.findMany({
      where: {
        tenantId,
        supplierId,
        ...(created ? { createdAt: created } : {}),
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        type: true,
        amount: true,
        balanceAfter: true,
        orderId: true,
        humanOrderNo: true,
        description: true,
        createdAt: true,
        order: { select: { supplierOrderNo: true } },
      },
    });

    let topupTotal = 0;
    let purchaseTotal = 0;
    let refundTotal = 0;
    let adjustmentNet = 0;
    const topups: SupplierAccountReport['topups'] = [];
    const purchases: SupplierAccountReport['purchases'] = [];
    const refunds: SupplierAccountReport['refunds'] = [];
    const movementRows: LedgerRow[] = [];

    for (const m of movements) {
      const amt = toNum(m.amount);
      const supplierOrderNo = m.order?.supplierOrderNo ?? null;
      const { debit, credit } = splitDebitCredit(amt);
      movementRows.push({
        id: m.id,
        date: m.createdAt.toISOString(),
        type: m.type,
        description: m.description,
        debit,
        credit,
        balanceAfter: round2(toNum(m.balanceAfter)),
        orderId: m.orderId,
        humanOrderNo: m.humanOrderNo,
        supplierOrderNo,
      });

      if (m.type === 'TOPUP') {
        topupTotal += amt;
        topups.push({
          id: m.id,
          date: m.createdAt.toISOString(),
          amount: round2(amt),
          description: m.description,
        });
      } else if (m.type === 'ORDER_PURCHASE') {
        purchaseTotal += Math.abs(amt);
        purchases.push({
          id: m.id,
          date: m.createdAt.toISOString(),
          amount: round2(Math.abs(amt)),
          orderId: m.orderId,
          humanOrderNo: m.humanOrderNo,
          supplierOrderNo,
          description: m.description,
        });
      } else if (m.type === 'ORDER_REFUND') {
        refundTotal += Math.abs(amt);
        refunds.push({
          id: m.id,
          date: m.createdAt.toISOString(),
          amount: round2(Math.abs(amt)),
          orderId: m.orderId,
          humanOrderNo: m.humanOrderNo,
          supplierOrderNo,
          description: m.description,
        });
      } else {
        // MANUAL_SET / ADJUSTMENT
        adjustmentNet += amt;
      }
    }

    // §orta — Tedarikçi tarafı MUTABAKAT (Bayi Hesap ile aynı kimlik).
    const inflow = round2(topupTotal + refundTotal + Math.max(0, adjustmentNet));
    const outflow = round2(purchaseTotal + Math.max(0, -adjustmentNet));
    const expectedClosing = round2(openingBalance + inflow - outflow);
    const diff = round2(closingBalance - expectedClosing);

    return {
      supplier: { id: supplier.id, name: supplier.name },
      range: { from: opts.from ?? null, to: opts.to ?? null },
      openingBalance,
      closingBalance,
      currentBalance,
      topupTotal: round2(topupTotal),
      purchaseTotal: round2(purchaseTotal),
      refundTotal: round2(refundTotal),
      adjustmentNet: round2(adjustmentNet),
      // refund + adjustment ARTIK dahil → 3 farklı "bakiye" çelişkisi biter.
      netBalance: round2(
        topupTotal - purchaseTotal + refundTotal + adjustmentNet,
      ),
      reconciliation: {
        inflow,
        outflow,
        expectedClosing,
        closingBalance,
        diff,
        consistent: Math.abs(diff) <= BALANCE_EPSILON,
      },
      topups,
      purchases,
      refunds,
      movements: movementRows,
    };
  }

  // ── Faz 5: Bayi hesabı ───────────────────────────────────────────────────

  async getDealerAccountReport(
    tenantId: string,
    customerId: string,
    opts: { from?: string; to?: string },
  ): Promise<DealerAccountReport> {
    const customer = await this.assertCustomer(customerId);
    const from = parseFrom(opts.from);
    const to = parseTo(opts.to);
    const createdOrder = rangeFilter(from, to);

    const currentBalance = round2(toNum(customer.cariBalance));

    const [openingBalance, closingBalance] = await Promise.all([
      this.dealerBalanceAt(customerId, from, true),
      this.dealerBalanceAt(customerId, to, false),
    ]);

    const orderRows = await this.prisma.order.findMany({
      where: {
        tenantId,
        customerId,
        // awaiting_payment (tamamlanmamış kart denemesi) Bayi Hesap sipariş
        // listesinde ve "Toplam Sipariş"te GÖRÜNMEZ — kullanıcı bunları iptal
        // sanıyordu. Sadece gerçek statüler yer alır.
        status: { not: 'awaiting_payment' },
        ...(createdOrder ? { createdAt: createdOrder } : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        humanOrderNo: true,
        supplierOrderNo: true,
        total: true,
        paymentType: true,
        status: true,
        invoiceNumber: true,
        invoiceUrl: true,
        invoicedAt: true,
        createdAt: true,
      },
    });

    const orders = orderRows.map((o) => ({
      id: o.id,
      date: o.createdAt.toISOString(),
      humanOrderNo: o.humanOrderNo,
      supplierOrderNo: o.supplierOrderNo ?? null,
      total: round2(toNum(o.total)),
      paymentType: o.paymentType,
      status: o.status,
      invoiceNumber: o.invoiceNumber,
      invoiceUrl: o.invoiceUrl,
      invoicedAt: o.invoicedAt ? o.invoicedAt.toISOString() : null,
    }));
    const orderTotal = round2(
      orders.reduce((s, o) => s + o.total, 0),
    );
    // Kart ile DİREKT ödenen siparişler — cari bakiyeden DÜŞMEZ; PayTR/TOSLA'dan
    // doğrudan tahsil edilir, CariLedger'a girmez. İptal/bekleyen HARİÇ (iptalde
    // tutar karta değil cariye iade edilir → aşağıda "İade" kaleminde görünür).
    const isSettled = (st: string): boolean =>
      st !== 'cancelled' && st !== 'awaiting_payment' && st !== 'refunded';
    const cardOrderTotal = round2(
      orders
        .filter((o) => o.paymentType === 'card' && isSettled(o.status))
        .reduce((s, o) => s + o.total, 0),
    );
    // Fatura toplamı: fatura kaydı olanların sipariş tutarı; yoksa sipariş bazlı
    // (Explore karar: ayrı fatura modeli yoksa kesilmiş kabul edilen siparişler).
    // NOT: Bu yalnız BİLGİ amaçlıdır — fatura bir belge metriğidir, nakit akışı
    // DEĞİLDİR; bu yüzden mutabakat (reconciliation) hesabına KATILMAZ.
    const invoiceTotal = round2(
      orders
        .filter((o) => o.invoiceNumber || o.invoicedAt)
        .reduce((s, o) => s + o.total, 0),
    );

    const topupRows = await this.prisma.cariTopup.findMany({
      where: {
        customerId,
        ...(createdOrder ? { createdAt: createdOrder } : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        humanTopupNo: true,
        amount: true,
        method: true,
        status: true,
        createdAt: true,
      },
    });
    const topups = topupRows.map((t) => ({
      id: t.id,
      date: t.createdAt.toISOString(),
      amount: round2(toNum(t.amount)),
      method: t.method,
      source: topupSourceLabel(t.method),
      status: t.status,
      humanTopupNo: t.humanTopupNo,
    }));
    // Yükleme toplamı (yalnız ONAYLANMIŞ) — havale/EFT ve kart olarak ayrı kalem.
    const approvedTopups = topups.filter((t) => t.status === 'APPROVED');
    const topupCardTotal = round2(
      approvedTopups
        .filter((t) => t.method === 'card')
        .reduce((s, t) => s + t.amount, 0),
    );
    const topupHavaleTotal = round2(
      approvedTopups
        .filter((t) => t.method !== 'card')
        .reduce((s, t) => s + t.amount, 0),
    );
    const topupTotal = round2(topupCardTotal + topupHavaleTotal);

    // ── MUTABAKAT — cari bakiye kimliği (CariLedger'dan, dönem filtreli) ──────
    // GERÇEK kaynak: müşteri cari hesabının açılış→kapanış kimliği:
    //   açılış + Σ(girişler) − Σ(çıkışlar) = kapanış.
    // Sipariş/fatura tutarları DEĞİL — kart ile ödenen siparişler cari'ye hiç
    // girmez, faturalar nakit değildir. Bu yüzden hepsi ledger'dan türetilir.
    const ledgerAgg = await this.prisma.cariLedger.groupBy({
      by: ['type'],
      where: {
        customerId,
        ...(createdOrder ? { createdAt: createdOrder } : {}),
      },
      _sum: { amount: true },
    });
    const sumByType: Record<string, number> = {};
    for (const g of ledgerAgg) {
      sumByType[g.type] = toNum(g._sum.amount);
    }
    const cariPaymentTotal = round2(Math.abs(sumByType['ORDER_PAYMENT'] ?? 0));
    const refundTotal = round2(sumByType['REFUND'] ?? 0);
    const adjustmentNet = round2(sumByType['ADJUSTMENT'] ?? 0);
    const topupLedger = round2(sumByType['TOPUP'] ?? 0);

    // Düzeltme işaretli: pozitif → giriş, negatif → çıkış.
    const adjCredit = adjustmentNet > 0 ? adjustmentNet : 0;
    const adjDebit = adjustmentNet < 0 ? Math.abs(adjustmentNet) : 0;

    // GİRİŞ = açılış + yükleme(havale+kart) + kart sipariş ödemesi + iade + (+)düzeltme
    // ÇIKIŞ = cari sipariş ödemeleri + kart sipariş ödemeleri + (−)düzeltme
    // Kart sipariş tutarı (cardOrderTotal) HEM girişte HEM çıkışta yer alır →
    // birbirini götürür, cari bakiye kimliği bozulmaz (diff ≈ 0). Böylece kart
    // ödemeleri mutabakatın İÇİNDE kalem olarak görünür ama bakiyeyi şişirmez.
    // NOT: yükleme tarafında ledger TOPUP (topupLedger) kullanılır; bu, onaylı
    // CariTopup toplamına (topupTotal) eşittir — sapma olursa diff bunu yakalar.
    const credits = round2(
      topupLedger + cardOrderTotal + refundTotal + adjCredit,
    );
    const debits = round2(cariPaymentTotal + cardOrderTotal + adjDebit);
    const purchaseTotal = round2(cariPaymentTotal + cardOrderTotal);
    const inflow = round2(openingBalance + credits);
    const outflow = debits;
    const expectedClosing = round2(inflow - outflow);
    const diff = round2(closingBalance - expectedClosing);

    return {
      customer: {
        id: customer.id,
        name: customer.name,
        companyTitle: customer.companyTitle,
        email: customer.email,
        bayiNo: customer.bayiNo,
      },
      range: { from: opts.from ?? null, to: opts.to ?? null },
      openingBalance,
      closingBalance,
      currentBalance,
      orders,
      orderTotal,
      topups,
      topupHavaleTotal,
      topupCardTotal,
      topupTotal,
      cardOrderTotal,
      cariPaymentTotal,
      purchaseTotal,
      refundTotal,
      adjustmentNet,
      invoiceTotal,
      reconciliation: {
        inflow,
        outflow,
        expectedClosing,
        closingBalance,
        diff,
        consistent: Math.abs(diff) <= BALANCE_EPSILON,
      },
    };
  }

  // ── Excel çıktıları ──────────────────────────────────────────────────────

  async exportSupplierAccount(
    tenantId: string,
    supplierId: string,
    opts: { from?: string; to?: string },
  ): Promise<{ buffer: Buffer; filename: string }> {
    const report = await this.getSupplierAccountReport(
      tenantId,
      supplierId,
      opts,
    );
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Toptan Budur Muhasebe';
    wb.created = new Date();

    const ws = wb.addWorksheet('Tedarikçi Hesap');
    this.writeTitle(ws, `Tedarikçi Hesap — ${report.supplier.name}`, report.range);

    // Özet bloğu
    this.writeSummaryRow(ws, 'Dönem Başı Bakiye', report.openingBalance);
    this.writeSummaryRow(ws, 'Yükleme Toplamı', report.topupTotal);
    this.writeSummaryRow(ws, 'Alış Toplamı', report.purchaseTotal);
    this.writeSummaryRow(ws, 'İade Toplamı', report.refundTotal);
    this.writeSummaryRow(ws, 'Düzeltme (net)', report.adjustmentNet);
    this.writeSummaryRow(ws, 'Net Bakiye (Yükleme − Alış)', report.netBalance);
    this.writeSummaryRow(ws, 'Dönem Sonu Bakiye', report.closingBalance);
    this.writeSummaryRow(ws, 'Güncel Bakiye', report.currentBalance);
    ws.addRow([]);

    // Yükleme tablosu
    this.writeSectionHeader(ws, 'Yüklemelerimiz (Tedarikçiye Gönderilen)');
    const topupHeader = ws.addRow(['Tarih', 'Açıklama', 'Tutar']);
    this.styleTableHeader(topupHeader, 3);
    for (const t of report.topups) {
      const row = ws.addRow([
        fmtDateTimeTR(new Date(t.date)),
        t.description ?? '',
        t.amount,
      ]);
      row.getCell(3).numFmt = NUMFMT_TRY;
    }
    const topupTotalRow = ws.addRow(['', 'TOPLAM', report.topupTotal]);
    topupTotalRow.getCell(3).numFmt = NUMFMT_TRY;
    this.styleTotalRow(topupTotalRow, 3);
    ws.addRow([]);

    // Alış tablosu (mutabakat kolonu ile)
    this.writeSectionHeader(ws, 'Alışlarımız (Tedarikçiden — ekstra/indirim dahil)');
    const buyHeader = ws.addRow([
      'Tarih',
      'Sipariş No',
      'Tedarikçi Sip. No',
      'Açıklama',
      'Alış Tutarı',
      'Tedarikçi Faturası (manuel)',
      'Fark',
    ]);
    this.styleTableHeader(buyHeader, 7);
    for (const p of report.purchases) {
      const row = ws.addRow([
        fmtDateTimeTR(new Date(p.date)),
        p.humanOrderNo ?? '',
        p.supplierOrderNo ?? '—',
        p.description ?? '',
        p.amount,
        '',
        '',
      ]);
      row.getCell(5).numFmt = NUMFMT_TRY;
      row.getCell(6).numFmt = NUMFMT_TRY;
      row.getCell(7).numFmt = NUMFMT_TRY;
    }
    const buyTotalRow = ws.addRow([
      '',
      '',
      '',
      'TOPLAM',
      report.purchaseTotal,
      '',
      '',
    ]);
    buyTotalRow.getCell(5).numFmt = NUMFMT_TRY;
    this.styleTotalRow(buyTotalRow, 7);
    ws.addRow([]);

    // İade / İptal tablosu — sipariş iptal/iadesinde tedarikçi cüzdanına geri
    // yükleme. Eskiden yalnız toplam vardı, kalem kalem görünmüyordu.
    this.writeSectionHeader(ws, 'Sipariş İadeleri / İptalleri (Cüzdana Geri Yüklenen)');
    const refHeader = ws.addRow([
      'Tarih',
      'Sipariş No',
      'Tedarikçi Sip. No',
      'Açıklama',
      'İade Tutarı',
    ]);
    this.styleTableHeader(refHeader, 5);
    for (const r of report.refunds) {
      const row = ws.addRow([
        fmtDateTimeTR(new Date(r.date)),
        r.humanOrderNo ?? '',
        r.supplierOrderNo ?? '—',
        r.description ?? '',
        r.amount,
      ]);
      row.getCell(5).numFmt = NUMFMT_TRY;
    }
    const refTotalRow = ws.addRow(['', '', '', 'TOPLAM', report.refundTotal]);
    refTotalRow.getCell(5).numFmt = NUMFMT_TRY;
    this.styleTotalRow(refTotalRow, 5);

    this.autoWidth(ws);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const filename = this.buildFilename('tedarikci-hesap', report.supplier.name, opts);
    return { buffer, filename };
  }

  async exportDealerAccount(
    tenantId: string,
    customerId: string,
    opts: { from?: string; to?: string },
  ): Promise<{ buffer: Buffer; filename: string }> {
    const report = await this.getDealerAccountReport(tenantId, customerId, opts);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Toptan Budur Muhasebe';
    wb.created = new Date();

    const ws = wb.addWorksheet('Bayi Hesap');
    const title = report.customer.companyTitle || report.customer.name;
    this.writeTitle(ws, `Bayi Hesap — ${title}`, report.range);

    // ── MUTABAKAT bloğu — cari bakiye kimliği ────────────────────────────────
    // açılış + girişler − çıkışlar = kapanış. Sipariş/fatura tutarları AŞAĞIDA
    // ayrıca "bilgi amaçlı" gösterilir; mutabakata KATILMAZ.
    // ── MUTABAKAT — kalem kalem (kart dahil; her iki tarafta yer alıp götürür) ─
    this.writeSectionHeader(ws, 'Mutabakat (Kalem Kalem)');
    this.writeSummaryRow(ws, 'Dönem Başı Bakiye', report.openingBalance);
    this.writeSummaryRow(ws, '(+) Havale/EFT ile Yükleme', report.topupHavaleTotal);
    this.writeSummaryRow(ws, '(+) Kart ile Yükleme (cariye)', report.topupCardTotal);
    this.writeSummaryRow(ws, '(+) Kart ile Sipariş Ödemesi', report.cardOrderTotal);
    this.writeSummaryRow(ws, '(+) İade (cariye dönen)', report.refundTotal);
    this.writeSummaryRow(ws, '(±) Düzeltme (net)', report.adjustmentNet);
    this.writeSummaryRow(ws, '(−) Cari Bakiyeden Sipariş Ödemeleri', report.cariPaymentTotal);
    this.writeSummaryRow(ws, '(−) Kart ile Sipariş Ödemeleri', report.cardOrderTotal);
    this.writeSummaryRow(ws, 'GİRİŞ (toplam)', report.reconciliation.inflow);
    this.writeSummaryRow(ws, 'ÇIKIŞ (toplam)', report.reconciliation.outflow);
    this.writeSummaryRow(ws, 'Beklenen Kapanış (Giriş − Çıkış)', report.reconciliation.expectedClosing);
    this.writeSummaryRow(ws, 'Gerçek Dönem Sonu Bakiye', report.closingBalance);
    this.writeSummaryRow(
      ws,
      report.reconciliation.consistent ? 'Fark (MUTABIK ✓)' : 'Fark (KONTROL ET!)',
      report.reconciliation.diff,
    );
    ws.addRow([]);

    // İş hacmi + bilgi
    this.writeSectionHeader(ws, 'İş Hacmi');
    this.writeSummaryRow(ws, 'Cari ile Ödenen Sipariş', report.cariPaymentTotal);
    this.writeSummaryRow(ws, 'Kart ile Ödenen Sipariş', report.cardOrderTotal);
    this.writeSummaryRow(ws, 'Toplam Sipariş (cari + kart)', report.purchaseTotal);
    this.writeSummaryRow(ws, 'Fatura Kesilen Toplam', report.invoiceTotal);
    this.writeSummaryRow(ws, 'Güncel Bakiye', report.currentBalance);
    ws.addRow([]);

    // Alış tablosu
    this.writeSectionHeader(ws, 'Alışlar (Siparişler)');
    const orderHeader = ws.addRow([
      'Tarih',
      'Sipariş No',
      'Tedarikçi Sip. No',
      'Ödeme Tipi',
      'Durum',
      'Fatura No',
      'Tutar',
    ]);
    this.styleTableHeader(orderHeader, 7);
    for (const o of report.orders) {
      const row = ws.addRow([
        fmtDateTimeTR(new Date(o.date)),
        o.humanOrderNo,
        o.supplierOrderNo ?? '—',
        o.paymentType ?? '',
        o.status,
        o.invoiceNumber ?? '',
        o.total,
      ]);
      row.getCell(7).numFmt = NUMFMT_TRY;
    }
    const orderTotalRow = ws.addRow([
      '',
      '',
      '',
      '',
      '',
      'TOPLAM',
      report.orderTotal,
    ]);
    orderTotalRow.getCell(7).numFmt = NUMFMT_TRY;
    this.styleTotalRow(orderTotalRow, 7);
    ws.addRow([]);

    // Yükleme tablosu (kaynak kolonu)
    this.writeSectionHeader(ws, 'Yüklemeler (Kaynaklı)');
    const topupHeader = ws.addRow([
      'Tarih',
      'Yükleme No',
      'Kaynak',
      'Durum',
      'Tutar',
    ]);
    this.styleTableHeader(topupHeader, 5);
    for (const t of report.topups) {
      const row = ws.addRow([
        fmtDateTimeTR(new Date(t.date)),
        t.humanTopupNo ?? '',
        t.source,
        t.status,
        t.amount,
      ]);
      row.getCell(5).numFmt = NUMFMT_TRY;
    }
    const topupTotalRow = ws.addRow(['', '', '', 'TOPLAM', report.topupTotal]);
    topupTotalRow.getCell(5).numFmt = NUMFMT_TRY;
    this.styleTotalRow(topupTotalRow, 5);

    this.autoWidth(ws);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const filename = this.buildFilename('bayi-hesap', title, opts);
    return { buffer, filename };
  }

  /**
   * Cari Hareketler (birleşik döküm) Excel çıktısı — tedarikçi ya da bayi için
   * TÜM borç/alacak hareketlerini (iptaller/iadeler dahil) kalem kalem, kronolojik
   * sırada verir. Ekrandaki tablo sayfalı; Excel TAM dökümdür.
   */
  async exportLedger(
    tenantId: string,
    type: LedgerType,
    id: string,
    opts: { from?: string; to?: string },
  ): Promise<{ buffer: Buffer; filename: string }> {
    const from = parseFrom(opts.from);
    const to = parseTo(opts.to);
    const created = rangeFilter(from, to);

    let entityName: string;
    let currentBalance: number;
    let rows: LedgerRow[];
    let totalRowsInRange = 0;

    if (type === 'supplier') {
      const supplier = await this.assertSupplier(tenantId, id);
      entityName = supplier.name;
      const account = await this.prisma.supplierAccount.findUnique({
        where: { supplierId: id },
        select: { balance: true },
      });
      currentBalance = round2(toNum(account?.balance));
      const supplierWhere = {
        tenantId,
        supplierId: id,
        ...(created ? { createdAt: created } : {}),
      };
      totalRowsInRange = await this.prisma.supplierAccountLedger.count({
        where: supplierWhere,
      });
      const raw = await this.prisma.supplierAccountLedger.findMany({
        where: supplierWhere,
        orderBy: { createdAt: 'asc' },
        take: LEDGER_EXPORT_CAP,
        select: {
          id: true,
          type: true,
          amount: true,
          balanceAfter: true,
          orderId: true,
          humanOrderNo: true,
          description: true,
          createdAt: true,
          order: { select: { supplierOrderNo: true } },
        },
      });
      rows = raw.map((r) => {
        const { debit, credit } = splitDebitCredit(toNum(r.amount));
        return {
          id: r.id,
          date: r.createdAt.toISOString(),
          type: r.type,
          description: r.description,
          debit,
          credit,
          balanceAfter: round2(toNum(r.balanceAfter)),
          orderId: r.orderId,
          humanOrderNo: r.humanOrderNo,
          supplierOrderNo: r.order?.supplierOrderNo ?? null,
        };
      });
    } else {
      const customer = await this.assertCustomer(id);
      entityName = customer.companyTitle || customer.name;
      currentBalance = round2(toNum(customer.cariBalance));
      const dealerWhere = {
        customerId: id,
        ...(created ? { createdAt: created } : {}),
      };
      totalRowsInRange = await this.prisma.cariLedger.count({
        where: dealerWhere,
      });
      const raw = await this.prisma.cariLedger.findMany({
        where: dealerWhere,
        orderBy: { createdAt: 'asc' },
        take: LEDGER_EXPORT_CAP,
        select: {
          id: true,
          type: true,
          amount: true,
          balanceAfter: true,
          orderId: true,
          description: true,
          createdAt: true,
          order: { select: { humanOrderNo: true, supplierOrderNo: true } },
        },
      });
      rows = raw.map((r) => {
        const { debit, credit } = splitDebitCredit(toNum(r.amount));
        return {
          id: r.id,
          date: r.createdAt.toISOString(),
          type: r.type,
          description: r.description,
          debit,
          credit,
          balanceAfter: round2(toNum(r.balanceAfter)),
          orderId: r.orderId,
          humanOrderNo: r.order?.humanOrderNo ?? null,
          supplierOrderNo: r.order?.supplierOrderNo ?? null,
        };
      });
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Toptan Budur Muhasebe';
    wb.created = new Date();
    const ws = wb.addWorksheet('Cari Hareketler');
    const kind = type === 'supplier' ? 'Tedarikçi' : 'Bayi';
    this.writeTitle(ws, `Cari Hareketler — ${kind}: ${entityName}`, {
      from: opts.from ?? null,
      to: opts.to ?? null,
    });
    this.writeSummaryRow(ws, 'Güncel Bakiye', currentBalance);
    // Sessiz kırpma yasak: kayıt sayısı cap'i aşarsa dökümün eksik olduğunu
    // açıkça yaz (pratikte tek cari için ulaşılmaz, ama olursa görünür olsun).
    if (totalRowsInRange > LEDGER_EXPORT_CAP) {
      const warn = ws.addRow([
        `UYARI: Bu cari için ${totalRowsInRange} hareket var; döküm ilk ${LEDGER_EXPORT_CAP} tanesini içerir. Tam döküm için tarih aralığını daraltın.`,
      ]);
      warn.getCell(1).font = { bold: true, color: { argb: 'FFB91C1C' } };
    }
    ws.addRow([]);

    const header = ws.addRow([
      'Tarih',
      'Tip',
      'Sipariş No',
      'Tedarikçi Sip. No',
      'Açıklama',
      'Borç',
      'Alacak',
      'Bakiye',
    ]);
    this.styleTableHeader(header, 8);

    let debitSum = 0;
    let creditSum = 0;
    for (const r of rows) {
      debitSum += r.debit;
      creditSum += r.credit;
      const row = ws.addRow([
        fmtDateTimeTR(new Date(r.date)),
        ledgerTypeLabel(r.type),
        r.humanOrderNo ?? '',
        r.supplierOrderNo ?? '—',
        r.description ?? '',
        r.debit || '',
        r.credit || '',
        r.balanceAfter ?? '',
      ]);
      row.getCell(6).numFmt = NUMFMT_TRY;
      row.getCell(7).numFmt = NUMFMT_TRY;
      row.getCell(8).numFmt = NUMFMT_TRY;
    }
    const totalRow = ws.addRow([
      '',
      '',
      '',
      '',
      'TOPLAM',
      round2(debitSum),
      round2(creditSum),
      currentBalance,
    ]);
    totalRow.getCell(6).numFmt = NUMFMT_TRY;
    totalRow.getCell(7).numFmt = NUMFMT_TRY;
    totalRow.getCell(8).numFmt = NUMFMT_TRY;
    this.styleTotalRow(totalRow, 8);

    this.autoWidth(ws);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const filename = this.buildFilename(`cari-hareketler-${type}`, entityName, opts);
    return { buffer, filename };
  }

  // ── Yardımcılar ──────────────────────────────────────────────────────────

  private async assertSupplier(
    tenantId: string,
    supplierId: string,
  ): Promise<{ id: string; name: string }> {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: supplierId, tenantId },
      select: { id: true, name: true },
    });
    if (!supplier) throw new NotFoundException('Tedarikçi bulunamadı');
    return supplier;
  }

  private async assertCustomer(customerId: string): Promise<{
    id: string;
    name: string;
    companyTitle: string | null;
    email: string;
    bayiNo: string | null;
    cariBalance: unknown;
  }> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        name: true,
        companyTitle: true,
        email: true,
        bayiNo: true,
        cariBalance: true,
      },
    });
    if (!customer) throw new NotFoundException('Bayi bulunamadı');
    return customer;
  }

  /**
   * Tedarikçi bakiyesinin bir tarihteki değeri. opening=true → tarihten ÖNCE
   * (createdAt < date) son hareketin balanceAfter'ı; false → date'e kadar
   * (createdAt <= date). Date null ise: opening→0, closing→güncel hareket sonu.
   */
  private async supplierBalanceAt(
    tenantId: string,
    supplierId: string,
    date: Date | null,
    opening: boolean,
  ): Promise<number> {
    if (!date) {
      if (opening) return 0;
      const last = await this.prisma.supplierAccountLedger.findFirst({
        where: { tenantId, supplierId },
        orderBy: { createdAt: 'desc' },
        select: { balanceAfter: true },
      });
      return round2(toNum(last?.balanceAfter));
    }
    const last = await this.prisma.supplierAccountLedger.findFirst({
      where: {
        tenantId,
        supplierId,
        createdAt: opening ? { lt: date } : { lte: date },
      },
      orderBy: { createdAt: 'desc' },
      select: { balanceAfter: true },
    });
    return round2(toNum(last?.balanceAfter));
  }

  private async dealerBalanceAt(
    customerId: string,
    date: Date | null,
    opening: boolean,
  ): Promise<number> {
    if (!date) {
      if (opening) return 0;
      const last = await this.prisma.cariLedger.findFirst({
        where: { customerId },
        orderBy: { createdAt: 'desc' },
        select: { balanceAfter: true },
      });
      return round2(toNum(last?.balanceAfter));
    }
    const last = await this.prisma.cariLedger.findFirst({
      where: {
        customerId,
        createdAt: opening ? { lt: date } : { lte: date },
      },
      orderBy: { createdAt: 'desc' },
      select: { balanceAfter: true },
    });
    return round2(toNum(last?.balanceAfter));
  }

  private buildFilename(
    prefix: string,
    name: string,
    opts: { from?: string; to?: string },
  ): string {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    const range = [opts.from, opts.to].filter(Boolean).join('_');
    return `${prefix}_${slug}${range ? `_${range}` : ''}.xlsx`;
  }

  private writeTitle(
    ws: ExcelJS.Worksheet,
    title: string,
    range: { from: string | null; to: string | null },
  ): void {
    const titleRow = ws.addRow([title]);
    titleRow.font = { bold: true, size: 14, color: { argb: COLOR.navy } };
    ws.addRow([
      `Dönem: ${range.from ?? 'başlangıç'} → ${range.to ?? 'bugün'}`,
    ]);
    ws.addRow([`Oluşturma: ${fmtDateTimeTR(new Date())}`]);
    ws.addRow([]);
  }

  private writeSummaryRow(
    ws: ExcelJS.Worksheet,
    label: string,
    value: number,
  ): void {
    const row = ws.addRow([label, value]);
    row.getCell(1).font = { bold: true };
    row.getCell(2).numFmt = NUMFMT_TRY;
  }

  private writeSectionHeader(ws: ExcelJS.Worksheet, text: string): void {
    const row = ws.addRow([text]);
    row.font = { bold: true, size: 12, color: { argb: COLOR.navy } };
  }

  private styleTableHeader(row: ExcelJS.Row, cols: number): void {
    for (let c = 1; c <= cols; c++) {
      const cell = row.getCell(c);
      cell.font = { bold: true, color: { argb: COLOR.white } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: COLOR.navy },
      };
      cell.border = this.thinBorder();
    }
  }

  private styleTotalRow(row: ExcelJS.Row, cols: number): void {
    for (let c = 1; c <= cols; c++) {
      const cell = row.getCell(c);
      cell.font = { bold: true };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: COLOR.totalBg },
      };
      cell.border = this.thinBorder();
    }
  }

  private thinBorder(): Partial<ExcelJS.Borders> {
    const style = { style: 'thin' as const, color: { argb: COLOR.border } };
    return { top: style, left: style, bottom: style, right: style };
  }

  private autoWidth(ws: ExcelJS.Worksheet): void {
    ws.columns.forEach((col) => {
      let max = 12;
      col.eachCell?.({ includeEmpty: false }, (cell) => {
        const len = cell.value ? String(cell.value).length : 0;
        if (len > max) max = len;
      });
      col.width = Math.min(48, max + 2);
    });
  }
}
