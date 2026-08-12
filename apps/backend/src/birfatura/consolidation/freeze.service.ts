import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppSettingsService } from '../../app-settings/app-settings.service';
import { AuditService } from '../../audit/audit.service';
import {
  computeBatchPricing,
  orderCommissionUnitExclShares,
  orderPackagingUnitExcl,
} from './pricing.engine';
import {
  addMonthsIstanbul,
  istanbulDayOfMonth,
  startOfDayIstanbul,
} from './trt-date';

/**
 * Faz 3 — Konsolide fatura **dondurma** servisi (birfatura.md §4/§5/§12.3).
 *
 * "1 sipariş = 1 fatura" yerine: kargolanmış ama faturalanmamış siparişler
 * `(bayi, ödeme tipi)` çiftine göre gruplanıp her grup için **tek** bir
 * `InvoiceBatch` (donmuş = `frozen`) üretilir. e-Fatura bu noktada KESİLMEZ;
 * BirFatura batch'i `/api/orders/` ile **çektiğinde** kesilir (pull-only, Faz 4).
 *
 * Tetikler:
 *  - **Cron** her gün 00:30 TRT → yalnız bugünün TRT günü == kesim günü ise
 *    (`birfatura.consolidationCutoffDay`, vars. 25) ve dönem henüz dondurulmamışsa.
 *  - **Manuel** admin: `freezeSingle(customerId)` (tekli) / `freezeAll()` (toplu).
 *
 * Uygunluk (§4): `status='shipped' AND shippedAt <= cutoff AND
 * invoiceBatchId IS NULL AND customer.invoicingEnabled = true`.
 * Açık-uçlu geriye seçim → kargolanmış-faturalanmamış sipariş bir sonraki
 * kesimde süpürülür, asla kaybolmaz.
 */

/** AppSetting anahtarları. */
const CUTOFF_DAY_KEY = 'birfatura.consolidationCutoffDay';
const CONSOLIDATION_ENABLED_KEY = 'birfatura.consolidationEnabled';

/** Kesim günü AppSetting yoksa fallback (migration seed'i ile aynı). */
const DEFAULT_CUTOFF_DAY = 25;

/** Dondurmayı tetikleyen kaynak — audit + sonuç için. */
export type FreezeTrigger = 'cron' | 'manual_single' | 'manual_all';

/** Tek bir batch'in dondurma sonucu özeti. */
export interface FreezeBatchResult {
  batchId: string;
  /** Sentetik BirFatura sipariş no'su (BigInt → JSON-safe string). */
  birfaturaOrderId: string;
  customerId: string;
  paymentType: string;
  orderCount: number;
  /** Üye sipariş no'ları (humanOrderNo). */
  orderCodes: string[];
  /** §2 motoruyla hesaplanan KDV-dahil toplam (number, gösterim için). */
  totalPaidTaxIncluding: number;
}

/** Bir dondurma çalışmasının tüm sonucu. */
export interface FreezeResult {
  trigger: FreezeTrigger;
  /** Bu kesim = OrderDate (TRT gün başlangıcı). */
  periodEnd: Date;
  /** Önceki kesim (etiket). */
  periodStart: Date;
  /** Oluşturulan batch sayısı. */
  batchCount: number;
  /** Faturalanan toplam sipariş sayısı. */
  orderCount: number;
  /** Dönem için zaten batch'i olduğundan atlanan grup sayısı (idempotency). */
  skippedGroups: number;
  batches: FreezeBatchResult[];
}

interface FreezeOptions {
  /** Sadece bu bayi için dondur (tekli); yoksa tüm uygun bayiler (toplu/cron). */
  customerId?: string;
  /** Gerçek tetik anı — `frozenAt` ve (cutoff verilmezse) varsayılan cutoff. */
  now: Date;
  /**
   * Manuel seçilen kesim tarihi (cutoff). Verilirse uygunluk üst sınırı
   * (`shippedAt <= cutoff`) ve `periodEnd` bundan türetilir; yoksa `now` kullanılır.
   * Alt tarih sınırı HİÇBİR durumda yoktur (açık-uçlu geriye seçim).
   */
  cutoff?: Date;
  trigger: FreezeTrigger;
  /** Audit aktörü (admin id veya 'birfatura'). */
  actorId: string;
}

/** §6.2 ile birebir: 'card' dışındaki her şey 'cari' kabul edilir (card→1, cari→2). */
export function normalizePaymentType(paymentType: string | null | undefined): string {
  return paymentType === 'card' ? 'card' : 'cari';
}

/**
 * §4 uygunluk WHERE — donmaya hazır siparişler: kargolanmış (`shipped`),
 * `shippedAt` set ve kesim anına (`cutoff`) kadar, henüz bir batch'e bağlanmamış
 * (`invoiceBatchId IS NULL`) ve bayisinin faturalaması açık (`invoicingEnabled`).
 * Açık-uçlu geriye seçim → kaçan sipariş bir sonraki kesimde süpürülür, kaybolmaz.
 *
 * TEK doğruluk kaynağı: hem **freeze** (gerçek dondurma) hem Faz 6 **önizleme**
 * (`PreviewService`) bu fonksiyonu çağırır → "önizleme = kesilecek fatura"
 * garantisi; uygunluk tanımı asla iki yerde ayrışmaz (drift yok).
 */
export function eligibleOrdersWhere(
  cutoff: Date,
  customerId?: string,
): Prisma.OrderWhereInput {
  return {
    status: 'shipped',
    shippedAt: { not: null, lte: cutoff },
    invoiceBatchId: null,
    // billingHold=true olan sipariş faturalanmaz. Legacy per-order yol
    // (birfatura.service.ts) bunu zaten kontrol ediyordu; konsolide freeze
    // etmiyordu. İADE sürecindeki sipariş açılışta billingHold=true yapılır.
    billingHold: false,
    // DAYANIKLI YEDEK (kullanıcı şartı: iade süresince ASLA fatura kesilmez):
    // billingHold yazımı non-atomik/hata-yutan olduğu için tek başına yeterli
    // değil. Açık bir iade talebi (returnStatus REQUESTED/APPROVED/SHIPPED_BACK)
    // olan sipariş billingHold'dan bağımsız olarak freeze/önizleme dışında tutulur.
    // SHIPPED_BACK = müşteri ürünü yolladı ama iade henüz tamamlanmadı → HÂLÂ açık,
    // bu aşamada fatura kesilirse para+fatura tutarsızlığı doğar. Reddedilen
    // (REJECTED) / tamamlanan (FINALIZED→sipariş 'refunded', zaten status ile
    // elenir) iadeler bu koşula takılmaz → normal faturalamaya döner.
    supportMessages: {
      none: { returnStatus: { in: ['REQUESTED', 'APPROVED', 'SHIPPED_BACK'] } },
    },
    ...(customerId ? { customerId } : { customerId: { not: null } }),
    customer: { is: { invoicingEnabled: true } },
  };
}

/**
 * Batch billing snapshot kaynağı (§5 "Customer'dan"). Üye `Order` zaten paid
 * anında Customer'dan kopyalanmış **tam** bir billing snapshot taşır ve alanları
 * `InvoiceBatch` ile birebir eşleşir; ayrıca faturanın gerçekte kesildiği bilgiyi
 * yansıtır. Bu yüzden snapshot öncelikle üye order'dan alınır, eksik kimlik/vergi
 * alanları için **canlı Customer** fallback olur (Customer'da yapısal billing
 * adresi kolonu yoktur → adres yalnız order snapshot'ından gelir).
 */
export interface BillingSnapshotOrder {
  billingName: string | null;
  billingCompanyTitle: string | null;
  billingVergiNo: string | null;
  billingVergiDairesi: string | null;
  billingTcNo: string | null;
  billingEmail: string | null;
  billingPhone: string | null;
  billingMobilePhone: string | null;
  billingAddressLine: string | null;
  billingDistrict: string | null;
  billingCity: string | null;
  billingPostal: string | null;
}

export interface BillingSnapshotCustomer {
  name: string;
  companyTitle: string | null;
  vergiNo: string | null;
  vergiDairesi: string | null;
  tcKimlik: string | null;
  email: string;
  phone: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  companyAddress: string | null;
}

export interface BillingSnapshot {
  billingName: string | null;
  billingCompanyTitle: string | null;
  billingVergiNo: string | null;
  billingVergiDairesi: string | null;
  billingTcNo: string | null;
  billingEmail: string | null;
  billingPhone: string | null;
  billingMobilePhone: string | null;
  billingAddressLine: string | null;
  billingDistrict: string | null;
  billingCity: string | null;
  billingPostal: string | null;
}

/** Boş string'i null'a indirger (snapshot'ta "" yerine null taşı). */
function nz(value: string | null | undefined): string | null {
  const t = value?.trim();
  return t ? t : null;
}

/**
 * §5: batch billing snapshot'ını üret. Öncelik üye order snapshot'ı (gerçekte
 * faturalanan bilgi + birebir alan eşleşmesi), fallback canlı Customer.
 * Bir batch'in tüm üyeleri aynı Customer'a aittir → herhangi bir üye temsilcidir.
 */
export function buildBillingSnapshot(
  customer: BillingSnapshotCustomer,
  order: BillingSnapshotOrder,
): BillingSnapshot {
  const isCorporate = !!(nz(order.billingVergiNo) ?? nz(customer.vergiNo));
  const corporateName = nz(customer.companyTitle) ?? customer.name;

  return {
    billingName:
      nz(order.billingName) ?? (isCorporate ? corporateName : customer.name),
    billingCompanyTitle:
      nz(order.billingCompanyTitle) ?? nz(customer.companyTitle),
    billingVergiNo: nz(order.billingVergiNo) ?? nz(customer.vergiNo),
    billingVergiDairesi:
      nz(order.billingVergiDairesi) ?? nz(customer.vergiDairesi),
    billingTcNo: nz(order.billingTcNo) ?? nz(customer.tcKimlik),
    billingEmail:
      nz(order.billingEmail) ?? nz(customer.email) ?? nz(customer.contactEmail),
    billingPhone:
      nz(order.billingPhone) ?? nz(customer.phone) ?? nz(customer.contactPhone),
    billingMobilePhone:
      nz(order.billingMobilePhone) ??
      nz(order.billingPhone) ??
      nz(customer.contactPhone) ??
      nz(customer.phone),
    billingAddressLine:
      nz(order.billingAddressLine) ?? nz(customer.companyAddress),
    billingDistrict: nz(order.billingDistrict),
    billingCity: nz(order.billingCity),
    billingPostal: nz(order.billingPostal),
  };
}

/** Uygun siparişin minimum şekli (Prisma include sonucu üst kümesidir). */
type EligibleOrder = Prisma.OrderGetPayload<{
  include: { items: true; customer: true };
}>;

@Injectable()
export class FreezeService {
  private readonly logger = new Logger(FreezeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AppSettingsService,
    private readonly audit: AuditService,
  ) {}

  // ============================================================
  // Tetikler
  // ============================================================

  /**
   * Cron — her gün 00:30 TRT. Yalnız bugünün TRT günü kesim günü ise dondurur.
   * `now` parametresi test edilebilirlik için; cron çağrısında varsayılan = şimdi.
   */
  @Cron('0 30 0 * * *', {
    name: 'birfatura-consolidation-freeze',
    timeZone: 'Europe/Istanbul',
  })
  async runScheduledFreeze(now: Date = new Date()): Promise<FreezeResult | null> {
    const enabled = await this.settings.getBoolean(
      CONSOLIDATION_ENABLED_KEY,
      true,
    );
    if (!enabled) {
      this.logger.log(
        'Konsolidasyon kapalı (birfatura.consolidationEnabled=false) — cron atlandı.',
      );
      return null;
    }

    const cutoffDay = await this.settings.getNumber(
      CUTOFF_DAY_KEY,
      DEFAULT_CUTOFF_DAY,
    );
    const today = istanbulDayOfMonth(now);
    if (today !== cutoffDay) {
      // Kesim günü değil — sessizce çık (her gün 00:30'da koşar).
      return null;
    }

    this.logger.log(
      `Kesim günü (${cutoffDay}) — otomatik dondurma başlıyor (cron).`,
    );
    return this.freeze({ now, trigger: 'cron', actorId: 'birfatura' });
  }

  /**
   * Manuel "tekli fatura" — yalnız tek bayiyi dondur.
   * `cutoff` verilirse o tarihe kadarki (shippedAt <= cutoff) siparişler alınır;
   * yoksa şimdi. Alt tarih sınırı yoktur.
   */
  async freezeSingle(
    customerId: string,
    actorId: string,
    cutoff?: Date,
  ): Promise<FreezeResult> {
    return this.freeze({
      customerId,
      now: new Date(),
      cutoff,
      trigger: 'manual_single',
      actorId,
    });
  }

  /** Manuel "toplu dondur" — tüm uygun bayileri dondur (`cutoff` opsiyonel). */
  async freezeAll(actorId: string, cutoff?: Date): Promise<FreezeResult> {
    return this.freeze({ now: new Date(), cutoff, trigger: 'manual_all', actorId });
  }

  // ============================================================
  // Çekirdek dondurma (§5)
  // ============================================================

  async freeze(opts: FreezeOptions): Promise<FreezeResult> {
    const { customerId, now, trigger, actorId } = opts;

    // 1) Tarih semantiği: cutoff = manuel seçilen kesim tarihi (varsa) ya da tetik
    //    anı; periodEnd = cutoff'un TRT gün başlangıcı (= OrderDate, @@unique
    //    anahtarı); periodStart = önceki kesim (yalnız etiket). `frozenAt` her zaman
    //    gerçek `now`. Uygunlukta alt tarih sınırı YOKTUR (açık-uçlu geriye seçim).
    const cutoff = opts.cutoff ?? now;
    const periodEnd = startOfDayIstanbul(cutoff);
    const periodStart = addMonthsIstanbul(periodEnd, -1);

    // 2) Uygun siparişler (§4). Açık-uçlu: shippedAt <= cutoff.
    //    WHERE, `eligibleOrdersWhere` ile paylaşılır → önizleme (Faz 6) ile drift olmaz.
    const eligible = (await this.prisma.order.findMany({
      where: eligibleOrdersWhere(cutoff, customerId),
      include: { items: true, customer: true },
      orderBy: { humanOrderNo: 'asc' },
    })) as EligibleOrder[];

    if (eligible.length === 0) {
      await this.safeAudit({
        actorType: trigger === 'cron' ? 'system' : 'admin',
        actorId,
        action: 'BIRFATURA_CONSOLIDATION_FREEZE_EMPTY',
        target: customerId ?? null,
        metadata: {
          trigger,
          periodEnd: periodEnd.toISOString(),
          reason: 'uygun (kargolanmış-faturalanmamış) sipariş yok',
        },
      });
      return {
        trigger,
        periodEnd,
        periodStart,
        batchCount: 0,
        orderCount: 0,
        skippedGroups: 0,
        batches: [],
      };
    }

    // 3) (customerId, paymentType) gruplama — sıra (humanOrderNo asc) korunur.
    const groups = new Map<string, EligibleOrder[]>();
    for (const order of eligible) {
      const ptype = normalizePaymentType(order.paymentType);
      const key = `${order.customerId} ${ptype}`;
      const bucket = groups.get(key);
      if (bucket) {
        bucket.push(order);
      } else {
        groups.set(key, [order]);
      }
    }

    // 4) Her grup için tek InvoiceBatch + üye Order.invoiceBatchId — tek
    //    transaction (batch + bağlama atomik). Dönem için zaten batch varsa
    //    atla (idempotent).
    const created: FreezeBatchResult[] = [];
    let skippedGroups = 0;

    await this.prisma.$transaction(
      async (tx) => {
        for (const orders of groups.values()) {
          const representative = orders[0];
          const cid = representative.customerId as string;
          const ptype = normalizePaymentType(representative.paymentType);

          // İdempotency: bu (bayi, ödeme tipi, dönem) için batch zaten var mı?
          const existing = await tx.invoiceBatch.findUnique({
            where: {
              customerId_paymentType_periodEnd: {
                customerId: cid,
                paymentType: ptype,
                periodEnd,
              },
            },
            select: { id: true, status: true },
          });
          // frozen/invoiced varsa atla (idempotent). CANCELLED ise BLOKLAMASIN:
          // iptal edilen dönem yeniden faturalanabilmeli → eski iptal batch'i sil
          // (üyeleri cancelBatch'te zaten serbest bırakıldı), unique slot boşalır,
          // aşağıda taze batch kesilir.
          if (existing && existing.status !== 'cancelled') {
            skippedGroups += 1;
            continue;
          }
          if (existing) {
            await tx.invoiceBatch.delete({ where: { id: existing.id } });
          }

          // §2 motoru — paketleme her siparişin GERÇEK packagingCost'undan
          // (paketlemesiz siparişe 0). Kart komisyonu da (varsa) ürün
          // matrahlarına ORANSAL gömülür → fatura = müşterinin ödediği
          // (Σ order.total + Σ cardCommissionAmount) birebir.
          const items = orders.flatMap((o) => {
            const oQty = o.items.reduce((a, it) => a + it.qty, 0);
            const pkgUnit = orderPackagingUnitExcl(o.packagingCost, oQty);
            const commissionUnits = orderCommissionUnitExclShares(
              o.cardCommissionAmount ?? null,
              o.items.map((it) => ({ unitPrice: it.unitPrice, qty: it.qty })),
            );
            return o.items.map((it, idx) => ({
              unitPrice: it.unitPrice,
              qty: it.qty,
              packagingUnitExcl: pkgUnit.add(commissionUnits[idx]),
            }));
          });
          const pricing = computeBatchPricing(items);

          const billing = buildBillingSnapshot(
            representative.customer as unknown as BillingSnapshotCustomer,
            representative,
          );
          const orderCodes = orders.map((o) => o.humanOrderNo);

          const batch = await tx.invoiceBatch.create({
            data: {
              tenantId: representative.tenantId,
              customerId: cid,
              paymentType: ptype,
              periodStart,
              periodEnd,
              orderCode: orderCodes.join(', '),
              status: 'frozen',
              ...billing,
              productsTotalTaxExcluding: pricing.productsTotalTaxExcluding,
              productsTotalTaxIncluding: pricing.productsTotalTaxIncluding,
              totalPaidTaxExcluding: pricing.totalPaidTaxExcluding,
              totalPaidTaxIncluding: pricing.totalPaidTaxIncluding,
              frozenAt: now,
            },
            select: { id: true, birfaturaOrderId: true },
          });

          // Üye siparişleri batch'e bağla (null-guard: eşzamanlı çift dondurmaya
          // karşı yalnız hâlâ bağlanmamış olanları talep et).
          const linked = await tx.order.updateMany({
            where: { id: { in: orders.map((o) => o.id) }, invoiceBatchId: null },
            data: { invoiceBatchId: batch.id },
          });

          created.push({
            batchId: batch.id,
            birfaturaOrderId: batch.birfaturaOrderId.toString(),
            customerId: cid,
            paymentType: ptype,
            orderCount: linked.count,
            orderCodes,
            totalPaidTaxIncluding: Number(
              pricing.totalPaidTaxIncluding.toString(),
            ),
          });
        }
      },
      { timeout: 120_000, maxWait: 30_000 },
    );

    const orderCount = created.reduce((acc, b) => acc + b.orderCount, 0);

    await this.safeAudit({
      actorType: trigger === 'cron' ? 'system' : 'admin',
      actorId,
      action: 'BIRFATURA_CONSOLIDATION_FREEZE',
      target: customerId ?? null,
      metadata: {
        trigger,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        batchCount: created.length,
        orderCount,
        skippedGroups,
        batches: created.map((b) => ({
          batchId: b.batchId,
          birfaturaOrderId: b.birfaturaOrderId,
          customerId: b.customerId,
          paymentType: b.paymentType,
          orderCount: b.orderCount,
          totalPaidTaxIncluding: b.totalPaidTaxIncluding,
        })),
      },
    });

    this.logger.log(
      `Dondurma tamam (${trigger}): ${created.length} batch, ${orderCount} sipariş, ${skippedGroups} atlandı.`,
    );

    return {
      trigger,
      periodEnd,
      periodStart,
      batchCount: created.length,
      orderCount,
      skippedGroups,
      batches: created,
    };
  }

  /** Audit hatası dondurmayı bozmasın — batch'ler zaten commit edildi. */
  private async safeAudit(input: Parameters<AuditService['log']>[0]): Promise<void> {
    try {
      await this.audit.log(input);
    } catch (err) {
      this.logger.warn(
        `Audit log yazılamadı (${input.action}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
