import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SupplierLedgerType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { AdminNotifierService } from '../mail/admin-notifier.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  calcItemSupplyCost,
  supplierUnitQty,
} from '../profitability/profit-cost.util';
import { resolveSupplierId } from '../profitability/supplier-attribution.util';

// ──────────────────────────────────────────────────────────────────────────
//  TEDARİKÇİ BAKİYE SENKRONU — çekirdek servis
//
//  Adminin tedarikçi sitelerindeki (Tedarikçi A / Tedarikçi C) KENDİ cüzdan
//  bakiyesini izleyen BAĞIMSIZ modül. Kâr/maliyet (profitability, tedarikçi
//  cari) tablolarına HİÇ dokunmaz; hiçbir kâr raporuna girmez.
//
//  • Para girişi (manuel): admin tedarikçi sitesine para yatırır → topUp().
//  • Para çıkışı (otomatik): sipariş `paid` olunca, Karlılık → Tedarikçi
//    Ayarları'ndaki gerçek alış maliyeti kadar düşülür →
//    deductForOrderByCostTx() (tedarikçi başına deductForOrderTx çağırır).
//    Bota bağımlı değildir; botu olmayan tedarikçilerde de düşer.
//  • İptal: düşülen tutar geri eklenir → refundForOrderTx().
//  • Eşik altı: admin bildirimi + mail (cooldown'lu) → maybeNotifyLowBalance().
// ──────────────────────────────────────────────────────────────────────────

/** Düşük-bakiye bildirimi tekrar gönderme aralığı (6 saat). */
const LOW_BALANCE_COOLDOWN_MS = 6 * 60 * 60 * 1000;

/** Manuel bakiye set/düzeltme alt-üst sınırları (negatif = borç bakiyesi). */
const MIN_BALANCE = -1_000_000;
const MAX_BALANCE = 50_000_000;

/** Tek bir işlemde (topup/adjust) izin verilen mutlak tutar tavanı. */
const MAX_MOVEMENT = 50_000_000;

/** Eşik (threshold) alt-üst sınırları. */
const MIN_THRESHOLD = 0;
const MAX_THRESHOLD = 50_000_000;

/** Ledger sayfalama tavanı. */
const MAX_PAGE_SIZE = 200;

function formatTry(amount: number): string {
  return new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * 2 ondalık basamaklı yuvarlama (Decimal kalıyor — JS Number hassasiyet kaybı yok).
 */
function decimalRound2(value: Prisma.Decimal): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(2));
}

export interface SupplierBalanceRow {
  supplierId: string;
  supplierName: string;
  active: boolean;
  balance: number;
  threshold: number;
  isLow: boolean;
  lowBalanceNotifiedAt: string | null;
  lastMovementAt: string | null;
}

export interface SupplierBalanceSummary {
  totals: {
    totalBalance: number;
    supplierCount: number;
    lowCount: number;
    currency: 'TRY';
  };
  suppliers: SupplierBalanceRow[];
}

@Injectable()
export class SupplierAccountService {
  private readonly logger = new Logger(SupplierAccountService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly adminNotifier: AdminNotifierService,
    private readonly notifications: NotificationsService,
  ) {}

  // ───────────────────────── internal helpers ─────────────────────────

  /**
   * Tedarikçinin bakiye hesabını kilitler (yoksa oluşturur) ve taze okur.
   * MUTLAKA bir $transaction callback'i içinde çağrılmalı — satır FOR UPDATE
   * ile kilitlenir, böylece eşzamanlı düşüm/iade yarışları engellenir.
   */
  private async lockAccountTx(
    tx: Prisma.TransactionClient,
    supplierId: string,
    tenantId: string,
  ): Promise<{
    id: string;
    balance: Prisma.Decimal;
    threshold: Prisma.Decimal;
    lowBalanceNotifiedAt: Date | null;
  }> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "SupplierAccount" WHERE "supplierId" = ${supplierId} FOR UPDATE
    `;
    if (locked.length > 0) {
      const account = await tx.supplierAccount.findUnique({
        where: { supplierId },
        select: {
          id: true,
          balance: true,
          threshold: true,
          lowBalanceNotifiedAt: true,
        },
      });
      if (account) return account;
    }

    // Hesap yok → oluştur, sonra yeni satırı kilitle. Eşzamanlı oluşturmada
    // unique(supplierId) çatışması olursa (P2002) satırı yeniden kilitle+oku.
    try {
      const created = await tx.supplierAccount.create({
        data: {
          supplierId,
          tenantId,
          balance: new Prisma.Decimal(0),
        },
        select: {
          id: true,
          balance: true,
          threshold: true,
          lowBalanceNotifiedAt: true,
        },
      });
      await tx.$queryRaw`SELECT id FROM "SupplierAccount" WHERE id = ${created.id} FOR UPDATE`;
      return created;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        await tx.$queryRaw`SELECT id FROM "SupplierAccount" WHERE "supplierId" = ${supplierId} FOR UPDATE`;
        const account = await tx.supplierAccount.findUnique({
          where: { supplierId },
          select: {
            id: true,
            balance: true,
            threshold: true,
            lowBalanceNotifiedAt: true,
          },
        });
        if (account) return account;
      }
      throw e;
    }
  }

  /** Admin mutasyonlarında tedarikçinin tenant'a ait olduğunu doğrular. */
  private async assertSupplierInTenant(
    supplierId: string,
    tenantId: string,
  ): Promise<{ id: string; name: string }> {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: supplierId, tenantId },
      select: { id: true, name: true },
    });
    if (!supplier) throw new NotFoundException('supplier not found');
    return supplier;
  }

  // ───────────────── ORDER HOOKS (transaction-bound) ─────────────────

  /**
   * Sipariş preparing'e geçince tedarikçinin yansıttığı GERÇEK tutarı
   * (supplierTotal) bakiyeden düşer. costPrice/KDV/ek-maliyet HESABI YOK.
   *
   * MUTLAKA siparişin durum geçişini yapan $transaction içinde çağrılmalı.
   * İş kuralı gereği ASLA business hatası atmaz (yetersiz bakiye → bakiye
   * negatife düşer; sipariş akışı asla bozulmaz). Idempotent:
   * @@unique([orderId, supplierId, type]) sayesinde tekrar çağrılırsa atlanır.
   *
   * Düşük-bakiye bildirimi BURADA gönderilmez; çağıran commit SONRASI
   * `maybeNotifyLowBalance(supplierId)` çağırmalıdır.
   */
  async deductForOrderTx(
    tx: Prisma.TransactionClient,
    params: {
      supplierId: string;
      tenantId: string;
      orderId: string;
      amount: Prisma.Decimal | number;
      humanOrderNo: string | null;
    },
  ): Promise<{
    skipped: boolean;
    ledgerId: string | null;
    balanceAfter: number | null;
  }> {
    const amount = decimalRound2(new Prisma.Decimal(params.amount));
    // Tutar yoksa/sıfır/negatifse düşülecek bir şey yok — sessizce atla.
    if (amount.lessThanOrEqualTo(0)) {
      return { skipped: true, ledgerId: null, balanceAfter: null };
    }

    // Idempotency: bu sipariş+tedarikçi için zaten düşüm yapıldıysa atla.
    const existing = await tx.supplierAccountLedger.findFirst({
      where: {
        orderId: params.orderId,
        supplierId: params.supplierId,
        type: SupplierLedgerType.ORDER_PURCHASE,
      },
      select: { id: true, balanceAfter: true, amount: true },
    });
    if (existing) {
      // Aynı sipariş+tedarikçi için ikinci düşüm denemesi farklı tutarla
      // geldiyse muhtemel kısmi/ek alım (örn. depo devri sonrası ikinci bot
      // alımı) — düşülemiyor, mutabakatta görünsün diye logla.
      if (existing.amount != null) {
        const existingAmount = decimalRound2(
          new Prisma.Decimal(existing.amount).abs(),
        );
        if (!existingAmount.equals(amount)) {
          this.logger.warn(
            `deductForOrderTx skipped (already deducted) order=${params.humanOrderNo ?? params.orderId} supplier=${params.supplierId}: mevcut ₺${existingAmount.toFixed(2)} ≠ yeni ₺${amount.toFixed(2)} — kısmi/ek alım elle mutabakat gerektirir`,
          );
        }
      }
      return {
        skipped: true,
        ledgerId: existing.id,
        balanceAfter: Number(existing.balanceAfter),
      };
    }

    const account = await this.lockAccountTx(
      tx,
      params.supplierId,
      params.tenantId,
    );
    const balance = decimalRound2(new Prisma.Decimal(account.balance));
    const newBalance = decimalRound2(balance.sub(amount));

    await tx.supplierAccount.update({
      where: { id: account.id },
      data: { balance: newBalance },
    });

    const ledger = await tx.supplierAccountLedger.create({
      data: {
        tenantId: params.tenantId,
        supplierId: params.supplierId,
        accountId: account.id,
        type: SupplierLedgerType.ORDER_PURCHASE,
        amount: amount.negated(), // negatif = çıkış
        balanceAfter: newBalance,
        orderId: params.orderId,
        humanOrderNo: params.humanOrderNo,
        description: params.humanOrderNo
          ? `Sipariş #${params.humanOrderNo} — tedarikçi tutarı düşüldü`
          : 'Sipariş — tedarikçi tutarı düşüldü',
      },
      select: { id: true },
    });

    return {
      skipped: false,
      ledgerId: ledger.id,
      balanceAfter: Number(newBalance),
    };
  }

  /**
   * Sipariş iptalinde, daha önce düşülen tutarı geri ekler (ORDER_PURCHASE'ın
   * tersi). Kendine yeter: ilgili ORDER_PURCHASE kaydını bulur, tutarını
   * (mutlak değer) iade eder. Idempotent — zaten iade varsa veya hiç düşüm
   * yoksa atlar. MUTLAKA bir $transaction içinde çağrılmalı.
   */
  async refundForOrderTx(
    tx: Prisma.TransactionClient,
    params: {
      supplierId: string;
      tenantId: string;
      orderId: string;
      humanOrderNo: string | null;
    },
  ): Promise<{
    skipped: boolean;
    reason?: 'no-purchase' | 'already-refunded';
    ledgerId: string | null;
    balanceAfter: number | null;
  }> {
    const purchase = await tx.supplierAccountLedger.findFirst({
      where: {
        orderId: params.orderId,
        supplierId: params.supplierId,
        type: SupplierLedgerType.ORDER_PURCHASE,
      },
      select: { amount: true },
    });
    if (!purchase) {
      return {
        skipped: true,
        reason: 'no-purchase',
        ledgerId: null,
        balanceAfter: null,
      };
    }

    const already = await tx.supplierAccountLedger.findFirst({
      where: {
        orderId: params.orderId,
        supplierId: params.supplierId,
        type: SupplierLedgerType.ORDER_REFUND,
      },
      select: { id: true, balanceAfter: true },
    });
    if (already) {
      return {
        skipped: true,
        reason: 'already-refunded',
        ledgerId: already.id,
        balanceAfter: Number(already.balanceAfter),
      };
    }

    // purchase.amount negatiftir → mutlak değeri iade et.
    const amount = decimalRound2(new Prisma.Decimal(purchase.amount).abs());
    if (amount.lessThanOrEqualTo(0)) {
      return { skipped: true, ledgerId: null, balanceAfter: null };
    }

    const account = await this.lockAccountTx(
      tx,
      params.supplierId,
      params.tenantId,
    );
    const balance = decimalRound2(new Prisma.Decimal(account.balance));
    const newBalance = decimalRound2(balance.add(amount));

    await tx.supplierAccount.update({
      where: { id: account.id },
      data: { balance: newBalance },
    });

    const ledger = await tx.supplierAccountLedger.create({
      data: {
        tenantId: params.tenantId,
        supplierId: params.supplierId,
        accountId: account.id,
        type: SupplierLedgerType.ORDER_REFUND,
        amount, // pozitif = giriş
        balanceAfter: newBalance,
        orderId: params.orderId,
        humanOrderNo: params.humanOrderNo,
        description: params.humanOrderNo
          ? `Sipariş #${params.humanOrderNo} iptali — tutar geri eklendi`
          : 'Sipariş iptali — tutar geri eklendi',
      },
      select: { id: true },
    });

    return {
      skipped: false,
      ledgerId: ledger.id,
      balanceAfter: Number(newBalance),
    };
  }

  /**
   * §2.2 REAKTİVASYON — tedarikçi cüzdan iadesini GERİ AL. Sipariş 'cancelled'dan
   * tekrar aktife çekildiğinde çağrılır: iptalde oluşan ORDER_REFUND satırını
   * SİLER ve tutarı kadar bakiyeyi yeniden DÜŞER. Böylece cüzdan "ORDER_PURCHASE
   * düşülmüş" duruma geri döner; sipariş tekrar iptal edilirse refundForOrderTx
   * yeniden doğru iade eder (ORDER_REFUND artık yok → idempotency tutarlı kalır).
   * @@unique(orderId,supplierId,type) gereği tedarikçi başına en fazla bir
   * ORDER_REFUND vardır. MUTLAKA bir $transaction içinde çağrılmalı.
   */
  async reverseRefundForReactivationTx(
    tx: Prisma.TransactionClient,
    params: { supplierId: string; tenantId: string; orderId: string },
  ): Promise<{ reversed: boolean; balanceAfter: number | null }> {
    const refund = await tx.supplierAccountLedger.findFirst({
      where: {
        orderId: params.orderId,
        supplierId: params.supplierId,
        type: SupplierLedgerType.ORDER_REFUND,
      },
      select: { id: true, amount: true },
    });
    if (!refund) return { reversed: false, balanceAfter: null };

    const amount = decimalRound2(new Prisma.Decimal(refund.amount).abs());
    const account = await this.lockAccountTx(
      tx,
      params.supplierId,
      params.tenantId,
    );
    const balance = decimalRound2(new Prisma.Decimal(account.balance));
    const newBalance = decimalRound2(balance.sub(amount));

    await tx.supplierAccount.update({
      where: { id: account.id },
      data: { balance: newBalance },
    });
    await tx.supplierAccountLedger.delete({ where: { id: refund.id } });

    return { reversed: true, balanceAfter: Number(newBalance) };
  }

  /**
   * Sipariş tedarikçiden fiilen alındığında çağrılır — TÜM tedarikçiler için
   * tek tip giriş. Siparişin kalemlerini efektif tedarikçiye (override > ürün
   * tedarikçisi) göre gruplar; her tedarikçi için "Karlılık → Tedarikçi
   * Ayarları"ndaki gerçek alış maliyeti kadar bakiye düşer (deductForOrderTx,
   * idempotent).
   *
   *   tutar = Σ kalem: (costSnapshot × (1+AlışKDV%) − indirim) × qty
   *           + ekMaliyet (tedarikçi başına SİPARİŞTE BİR KEZ — kargo/ambalaj)
   *
   * Tedarikçiden ALINAN ADET kadar düşülür — dispatcher ile birebir "ya hep ya
   * hiç" (supplierUnitQty, profit-cost.util ile tek kaynak):
   *  - fulfillmentSource !== 'supplier' (bayiler-arası iade satışı) → 0
   *  - dispatchedAt dolu VEYA aktif rezervasyon (reservedUntil > now) → 0
   *    (dispatcher kalemi tedarikçi siparişinden komple çıkarır)
   *  - rezervasyon yok / süresi geçmiş / reservedUntil null → tam qty
   * Böylece karma depo+tedarikçi siparişinde yalnız tedarikçiye gönderilen
   * kalemler düşer ve elle paid→preparing çekilen depo siparişlerinde
   * yanlış düşüm olmaz.
   *
   * Bot supplierTotal'a bağımlı DEĞİL → XML-only gibi botu olmayan
   * tedarikçilerde de düşer. MUTLAKA bir $transaction içinde çağrılmalı.
   * @@unique(orderId,supplierId,type) sayesinde aynı sipariş için tekrar
   * çağrılırsa no-op (çift düşüm olmaz). Bilinen sınır: aynı tedarikçiden
   * İKİ AYRI partide alım (önce bot, sonra depo devri) ikinci partiyi
   * düşemez — deductForOrderTx farklı tutarı loglar, elle mutabakat gerekir.
   */
  async deductForOrderByCostTx(
    tx: Prisma.TransactionClient,
    params: { orderId: string },
  ): Promise<void> {
    const order = await tx.order.findUnique({
      where: { id: params.orderId },
      select: { tenantId: true, humanOrderNo: true },
    });
    if (!order) return;
    const tenantId = order.tenantId;
    const now = Date.now();

    const items = await tx.orderItem.findMany({
      where: { orderId: params.orderId },
      select: {
        qty: true,
        costPriceSnapshot: true,
        supplierIdOverride: true,
        // TEK KAYNAK atfı (override → snapshot → product) için snapshot ŞART.
        // Aksi halde ürün hard-delete edilip productId SET NULL olduğunda
        // (override yoksa) kalem cüzdandan düşemez ve maliyet raporundan sapar.
        supplierIdSnapshot: true,
        fulfillmentSource: true,
        houseStockDispatchedAt: true,
        houseStockReservedQty: true,
        houseStockReservedUntil: true,
        product: { select: { supplierId: true, costPrice: true } },
      },
    });

    // Her kalem için tedarikçiden alınan ADET (depo adetleri düşülür).
    const eligible = items
      .map((i) => ({ ...i, supplierQty: supplierUnitQty(i, now) }))
      .filter((i) => i.supplierQty > 0);
    if (eligible.length === 0) return;

    // Efektif tedarikçi — TEK KAYNAK (supplier-attribution.util): override →
    // snapshot → ürün tedarikçisi. Maliyet raporu/Karlılık/Export ile BİREBİR
    // aynı öncelik; ürün hard-delete edilse bile snapshot dalıyla doğru
    // tedarikçiye atfedilir. Hiçbiri yoksa kalem atlanır (atıf bilinmiyor).
    const supplierIds = [
      ...new Set(
        eligible
          .map((i) => resolveSupplierId(i))
          .filter((x): x is string => x !== null),
      ),
    ];
    if (supplierIds.length === 0) return;

    // TEK KAYNAK: tedarikçiye ödenen tutar = costPrice (indirimli net alış) ×
    // (1 + purchaseVatRate). Eski ProfitabilityConfig (ayrı indirim + sipariş-başı
    // ekMaliyet) kaldırıldı — maliyet tamamen costPrice'tan türer.
    const supplierRows = await tx.supplier.findMany({
      where: { tenantId, id: { in: supplierIds } },
      select: { id: true, purchaseVatRate: true },
    });
    const vatMap = new Map(supplierRows.map((s) => [s.id, s.purchaseVatRate]));

    // Tedarikçi başına gerçek alış maliyeti topla (fiilen alınan adet kadar).
    const totalBySupplier = new Map<string, number>();
    for (const it of eligible) {
      const supplierId = resolveSupplierId(it);
      if (!supplierId) continue;
      const costPrice = it.costPriceSnapshot ?? it.product?.costPrice ?? null;
      const amount = calcItemSupplyCost(costPrice, it.supplierQty, {
        purchaseVatRate: vatMap.get(supplierId) ?? 20,
      });
      totalBySupplier.set(
        supplierId,
        (totalBySupplier.get(supplierId) ?? 0) + amount,
      );
    }

    for (const [supplierId, raw] of totalBySupplier) {
      const amount = Math.round(raw * 100) / 100;
      if (amount <= 0) continue;
      await this.deductForOrderTx(tx, {
        supplierId,
        tenantId,
        orderId: params.orderId,
        amount: new Prisma.Decimal(amount.toFixed(2)),
        humanOrderNo: order.humanOrderNo,
      });
    }
  }

  // ───────────────────── ADMIN MUTATIONS ─────────────────────

  /**
   * Manuel para girişi (TOPUP) — admin tedarikçi sitesine para yatırdığında
   * buradaki bakiyeyi elle artırır. amount > 0 olmalı.
   */
  async topUp(params: {
    supplierId: string;
    tenantId: string;
    amount: number;
    description?: string | null;
    adminUserId: string;
  }): Promise<{ balance: number; ledgerId: string }> {
    const value = Number(params.amount);
    if (!Number.isFinite(value) || value <= 0 || value > MAX_MOVEMENT) {
      throw new BadRequestException('invalid topup amount');
    }
    const supplier = await this.assertSupplierInTenant(
      params.supplierId,
      params.tenantId,
    );
    const amount = decimalRound2(new Prisma.Decimal(value));

    const result = await this.prisma.$transaction(async (tx) => {
      const account = await this.lockAccountTx(
        tx,
        params.supplierId,
        params.tenantId,
      );
      const balance = decimalRound2(new Prisma.Decimal(account.balance));
      const newBalance = decimalRound2(balance.add(amount));
      if (newBalance.greaterThan(MAX_BALANCE)) {
        throw new BadRequestException('balance limit exceeded');
      }

      await tx.supplierAccount.update({
        where: { id: account.id },
        data: { balance: newBalance },
      });

      const ledger = await tx.supplierAccountLedger.create({
        data: {
          tenantId: params.tenantId,
          supplierId: params.supplierId,
          accountId: account.id,
          type: SupplierLedgerType.TOPUP,
          amount,
          balanceAfter: newBalance,
          description: params.description?.trim()
            ? `Para yatırma: ${params.description.trim()}`
            : 'Manuel para yatırma',
          createdByUserId: params.adminUserId,
        },
        select: { id: true },
      });

      return { newBalance, ledgerId: ledger.id };
    });

    // Bakiye arttı → eşik üstüne çıktıysa düşük-bakiye bayrağını temizle.
    void this.maybeNotifyLowBalance(params.supplierId);
    this.logger.log(
      `topUp ${supplier.name}: +₺${formatTry(value)} → ₺${formatTry(Number(result.newBalance))}`,
    );

    return { balance: Number(result.newBalance), ledgerId: result.ledgerId };
  }

  /**
   * Manuel düzeltme (ADJUSTMENT) — işaretli delta (+/-) uygular.
   * Denetim izi için ledger'a yazılır.
   */
  async adjustByAdmin(params: {
    supplierId: string;
    tenantId: string;
    amount: number;
    reason?: string | null;
    adminUserId: string;
  }): Promise<{ balance: number; ledgerId: string }> {
    const value = Number(params.amount);
    if (
      !Number.isFinite(value) ||
      value === 0 ||
      Math.abs(value) > MAX_MOVEMENT
    ) {
      throw new BadRequestException('invalid adjustment amount');
    }
    await this.assertSupplierInTenant(params.supplierId, params.tenantId);
    const delta = decimalRound2(new Prisma.Decimal(value));

    const result = await this.prisma.$transaction(async (tx) => {
      const account = await this.lockAccountTx(
        tx,
        params.supplierId,
        params.tenantId,
      );
      const balance = decimalRound2(new Prisma.Decimal(account.balance));
      const newBalance = decimalRound2(balance.add(delta));
      if (
        newBalance.lessThan(MIN_BALANCE) ||
        newBalance.greaterThan(MAX_BALANCE)
      ) {
        throw new BadRequestException('balance out of allowed range');
      }

      await tx.supplierAccount.update({
        where: { id: account.id },
        data: { balance: newBalance },
      });

      const ledger = await tx.supplierAccountLedger.create({
        data: {
          tenantId: params.tenantId,
          supplierId: params.supplierId,
          accountId: account.id,
          type: SupplierLedgerType.ADJUSTMENT,
          amount: delta, // işaretli
          balanceAfter: newBalance,
          description: params.reason?.trim()
            ? `Manuel düzeltme: ${params.reason.trim()}`
            : 'Manuel bakiye düzeltmesi',
          createdByUserId: params.adminUserId,
        },
        select: { id: true },
      });

      return { newBalance, ledgerId: ledger.id };
    });

    void this.maybeNotifyLowBalance(params.supplierId);
    return { balance: Number(result.newBalance), ledgerId: result.ledgerId };
  }

  /**
   * Manuel bakiye SET (MANUAL_SET) — admin yeni MUTLAK bakiye değerini
   * gönderir; aradaki işaretli fark ledger'a yazılır.
   */
  async setBalanceByAdmin(params: {
    supplierId: string;
    tenantId: string;
    newBalance: number;
    reason?: string | null;
    adminUserId: string;
  }): Promise<{ balance: number; ledgerId: string }> {
    const target = Number(params.newBalance);
    if (
      !Number.isFinite(target) ||
      target < MIN_BALANCE ||
      target > MAX_BALANCE
    ) {
      throw new BadRequestException('invalid balance value');
    }
    await this.assertSupplierInTenant(params.supplierId, params.tenantId);
    const targetDecimal = decimalRound2(new Prisma.Decimal(target));

    const result = await this.prisma.$transaction(async (tx) => {
      const account = await this.lockAccountTx(
        tx,
        params.supplierId,
        params.tenantId,
      );
      const previous = decimalRound2(new Prisma.Decimal(account.balance));
      const delta = decimalRound2(targetDecimal.sub(previous));
      if (delta.isZero()) {
        throw new BadRequestException('balance unchanged');
      }

      await tx.supplierAccount.update({
        where: { id: account.id },
        data: { balance: targetDecimal },
      });

      const ledger = await tx.supplierAccountLedger.create({
        data: {
          tenantId: params.tenantId,
          supplierId: params.supplierId,
          accountId: account.id,
          type: SupplierLedgerType.MANUAL_SET,
          amount: delta, // işaretli fark
          balanceAfter: targetDecimal,
          description: params.reason?.trim()
            ? `Bakiye set: ${params.reason.trim()}`
            : 'Manuel bakiye set',
          createdByUserId: params.adminUserId,
        },
        select: { id: true },
      });

      return { ledgerId: ledger.id };
    });

    void this.maybeNotifyLowBalance(params.supplierId);
    return { balance: Number(targetDecimal), ledgerId: result.ledgerId };
  }

  /**
   * Düşük-bakiye eşiğini günceller. Ledger yazılmaz (bakiye değişmiyor).
   */
  async setThreshold(params: {
    supplierId: string;
    tenantId: string;
    threshold: number;
  }): Promise<{ threshold: number; balance: number; isLow: boolean }> {
    const value = Number(params.threshold);
    if (
      !Number.isFinite(value) ||
      value < MIN_THRESHOLD ||
      value > MAX_THRESHOLD
    ) {
      throw new BadRequestException('invalid threshold value');
    }
    await this.assertSupplierInTenant(params.supplierId, params.tenantId);
    const thresholdDecimal = decimalRound2(new Prisma.Decimal(value));

    const result = await this.prisma.$transaction(async (tx) => {
      const account = await this.lockAccountTx(
        tx,
        params.supplierId,
        params.tenantId,
      );
      const updated = await tx.supplierAccount.update({
        where: { id: account.id },
        data: { threshold: thresholdDecimal },
        select: { balance: true, threshold: true },
      });
      return updated;
    });

    void this.maybeNotifyLowBalance(params.supplierId);
    const balance = decimalRound2(new Prisma.Decimal(result.balance));
    const threshold = decimalRound2(new Prisma.Decimal(result.threshold));
    return {
      threshold: Number(threshold),
      balance: Number(balance),
      isLow: balance.lessThan(threshold),
    };
  }

  // ───────────────────────── QUERIES ─────────────────────────

  /**
   * Dashboard ve Tedarikçiler sayfası üst şeridi için özet. Tüm hesaplar
   * tek sorguda çekilir; toplamlar tenant'ın TÜM hesaplarından hesaplanır.
   */
  async getSummary(tenantId: string): Promise<SupplierBalanceSummary> {
    const accounts = await this.prisma.supplierAccount.findMany({
      where: { tenantId },
      select: {
        supplierId: true,
        balance: true,
        threshold: true,
        lowBalanceNotifiedAt: true,
        updatedAt: true,
        supplier: { select: { name: true, active: true } },
      },
      orderBy: { balance: 'asc' }, // en düşük bakiye en üstte
    });

    let totalBalance = new Prisma.Decimal(0);
    let lowCount = 0;
    const suppliers: SupplierBalanceRow[] = accounts.map((a) => {
      const balance = decimalRound2(new Prisma.Decimal(a.balance));
      const threshold = decimalRound2(new Prisma.Decimal(a.threshold));
      const isLow = balance.lessThan(threshold);
      if (isLow) lowCount += 1;
      totalBalance = totalBalance.add(balance);
      return {
        supplierId: a.supplierId,
        supplierName: a.supplier.name,
        active: a.supplier.active,
        balance: Number(balance),
        threshold: Number(threshold),
        isLow,
        lowBalanceNotifiedAt: a.lowBalanceNotifiedAt
          ? a.lowBalanceNotifiedAt.toISOString()
          : null,
        lastMovementAt: a.updatedAt ? a.updatedAt.toISOString() : null,
      };
    });

    return {
      totals: {
        totalBalance: Number(decimalRound2(totalBalance)),
        supplierCount: accounts.length,
        lowCount,
        currency: 'TRY',
      },
      suppliers,
    };
  }

  /** Tek bir tedarikçinin hesabı (yoksa default değerlerle döner). */
  async getSupplierAccount(
    supplierId: string,
    tenantId: string,
  ): Promise<SupplierBalanceRow> {
    const supplier = await this.assertSupplierInTenant(supplierId, tenantId);
    const account = await this.prisma.supplierAccount.findUnique({
      where: { supplierId },
      select: {
        balance: true,
        threshold: true,
        lowBalanceNotifiedAt: true,
        updatedAt: true,
      },
    });

    const balance = decimalRound2(new Prisma.Decimal(account?.balance ?? 0));
    const threshold = decimalRound2(
      new Prisma.Decimal(account?.threshold ?? 1000),
    );
    return {
      supplierId,
      supplierName: supplier.name,
      active: true,
      balance: Number(balance),
      threshold: Number(threshold),
      isLow: balance.lessThan(threshold),
      lowBalanceNotifiedAt: account?.lowBalanceNotifiedAt
        ? account.lowBalanceNotifiedAt.toISOString()
        : null,
      lastMovementAt: account?.updatedAt
        ? account.updatedAt.toISOString()
        : null,
    };
  }

  /** Bir tedarikçinin bakiye hareket defteri (sayfalı). */
  async getLedger(
    supplierId: string,
    tenantId: string,
    query: { page?: number; pageSize?: number; type?: SupplierLedgerType },
  ): Promise<{
    rows: Array<{
      id: string;
      type: SupplierLedgerType;
      amount: number;
      balanceAfter: number;
      orderId: string | null;
      humanOrderNo: string | null;
      description: string | null;
      createdByUserId: string | null;
      createdAt: string;
    }>;
    total: number;
    page: number;
    pageSize: number;
  }> {
    await this.assertSupplierInTenant(supplierId, tenantId);

    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Number(query.pageSize) || 50),
    );
    const where: Prisma.SupplierAccountLedgerWhereInput = {
      supplierId,
      tenantId,
    };
    if (query.type) where.type = query.type;

    const [rows, total] = await Promise.all([
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
          createdByUserId: true,
          createdAt: true,
        },
      }),
      this.prisma.supplierAccountLedger.count({ where }),
    ]);

    return {
      rows: rows.map((r) => ({
        id: r.id,
        type: r.type,
        amount: Number(r.amount),
        balanceAfter: Number(r.balanceAfter),
        orderId: r.orderId,
        humanOrderNo: r.humanOrderNo,
        description: r.description,
        createdByUserId: r.createdByUserId,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  }

  // ──────────────────── LOW BALANCE NOTIFICATION ────────────────────

  /**
   * Bakiye eşik altına indiyse admin bildirimi + mail gönderir (cooldown'lu).
   * Bakiye eşik üstüne çıktıysa bayrağı temizler (bir sonraki düşüşte tekrar
   * bildirim atılabilsin). Commit SONRASI fire-and-forget çağrılır; ASLA
   * çağıranın akışını bozmaz (tüm hatalar yutulur, sadece loglanır).
   */
  async maybeNotifyLowBalance(supplierId: string): Promise<void> {
    try {
      const account = await this.prisma.supplierAccount.findUnique({
        where: { supplierId },
        select: {
          id: true,
          tenantId: true,
          balance: true,
          threshold: true,
          lowBalanceNotifiedAt: true,
          supplier: { select: { name: true } },
        },
      });
      if (!account) return;

      const balance = decimalRound2(new Prisma.Decimal(account.balance));
      const threshold = decimalRound2(new Prisma.Decimal(account.threshold));
      const isLow = balance.lessThan(threshold);

      if (!isLow) {
        // Toparlandı → bir sonraki düşüşte tekrar bildirim için bayrağı sıfırla.
        if (account.lowBalanceNotifiedAt) {
          await this.prisma.supplierAccount
            .update({
              where: { id: account.id },
              data: { lowBalanceNotifiedAt: null },
            })
            .catch(() => undefined);
        }
        return;
      }

      const now = Date.now();

      // Bildirim slotunu atomik olarak "sahiplen" — eşzamanlı düşümlerde
      // çift bildirim gönderilmesini engeller (lock + cooldown re-check).
      const claimed = await this.prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM "SupplierAccount" WHERE id = ${account.id} FOR UPDATE
        `;
        if (!locked.length) return false;
        const fresh = await tx.supplierAccount.findUnique({
          where: { id: account.id },
          select: {
            balance: true,
            threshold: true,
            lowBalanceNotifiedAt: true,
          },
        });
        if (!fresh) return false;
        const fb = decimalRound2(new Prisma.Decimal(fresh.balance));
        const ft = decimalRound2(new Prisma.Decimal(fresh.threshold));
        if (!fb.lessThan(ft)) return false;
        const last = fresh.lowBalanceNotifiedAt
          ? fresh.lowBalanceNotifiedAt.getTime()
          : 0;
        if (last && now - last < LOW_BALANCE_COOLDOWN_MS) return false;
        await tx.supplierAccount.update({
          where: { id: account.id },
          data: { lowBalanceNotifiedAt: new Date(now) },
        });
        return true;
      });
      if (!claimed) return;

      const supplierName = account.supplier.name;
      const balanceNum = Number(balance);
      const thresholdNum = Number(threshold);

      await this.notifications
        .emit({
          type: 'supplier.balance.low',
          severity: 'warning',
          title: `Tedarikçi bakiyesi düşük: ${supplierName}`,
          body: `${supplierName} bakiyesi ₺${formatTry(balanceNum)} — eşik ₺${formatTry(thresholdNum)} altına indi. Tedarikçi sitesine para yatırın.`,
          link: '/suppliers',
          data: {
            supplierId,
            balance: balanceNum,
            threshold: thresholdNum,
          },
          audience: { role: 'ADMIN' },
        })
        .catch((e) =>
          this.logger.warn(
            `low balance notification emit failed: ${(e as Error).message}`,
          ),
        );

      const emails = await this.adminNotifier
        .resolveAdminEmails(account.tenantId)
        .catch(() => [] as string[]);
      if (emails.length > 0) {
        await this.mail
          .sendAdminSupplierLowBalance({
            to: emails,
            supplierName,
            balance: balanceNum,
            threshold: thresholdNum,
          })
          .catch((e) =>
            this.logger.warn(
              `low balance mail failed: ${(e as Error).message}`,
            ),
          );
      }
    } catch (e) {
      this.logger.warn(
        `maybeNotifyLowBalance failed: ${(e as Error).message}`,
      );
    }
  }
}
