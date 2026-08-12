import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InvoiceBatchStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { AppSettingsService } from '../../app-settings/app-settings.service';
import {
  FreezeResult,
  FreezeService,
} from '../../birfatura/consolidation/freeze.service';
import {
  PreviewResult,
  PreviewService,
} from '../../birfatura/consolidation/preview.service';
import {
  CONSOLIDATION_VAT_RATE,
  DEFAULT_PACKAGING_UNIT_FEE,
  orderPackagingUnitExcl,
} from '../../birfatura/consolidation/pricing.engine';
import { resolveLineProductCode } from '../../birfatura/consolidation/batch-mapper';
import {
  decimalToNumber,
  vatAdd,
  istanbulMonthKey,
  istanbulMonthLabel,
} from '../../birfatura/birfatura.utils';
import {
  mapPaymentTypeToBirfaturaId,
  mapPaymentTypeToBirfaturaLabel,
} from '../../birfatura/birfatura.constants';

/**
 * Faz 7 — Admin fatura paneli servis katmanı (birfatura.md §9).
 *
 * Bu servis YENİ iş mantığı KURMAZ; kesim/önizleme/fiyat için tek doğruluk
 * kaynağı olan ortak motorları çağırır:
 *  - kesim:      `FreezeService.freezeSingle/freezeAll`
 *  - önizleme:   `PreviewService.preview`
 *  - fiyat/KDV:  §2 sabitleri + `vatAdd` (batch detay kalem dökümü)
 *  - ayarlar:    `AppSettingsService` (audit + tip/min-max doğrulama içeride)
 *
 * Salt-okuma listeleme/detay BirFatura konsolide deseni gereği tenant-bağımsız
 * çalışır (freeze/preview ile aynı; InvoiceBatch sistem genelinde kesilir).
 *
 * `birfaturaOrderId` (BigInt) tüm yanıtlarda string'e serialize edilir (JSON
 * güvenliği). Tüm `Decimal` tutarlar `decimalToNumber` ile number'a çevrilir.
 */

const CUTOFF_DAY_KEY = 'birfatura.consolidationCutoffDay';
const CONSOLIDATION_ENABLED_KEY = 'birfatura.consolidationEnabled';
const ORDERS_ENABLED_KEY = 'birfatura.ordersEnabled';
const PACKAGING_FEE_KEY = 'pricing.packagingUnitFee';

const DEFAULT_CUTOFF_DAY = 25;

/** Fatura ayar bloğu (panelde gösterilen + düzenlenen). */
export interface InvoiceSettings {
  cutoffDay: number;
  packagingUnitFee: string;
  consolidationEnabled: boolean;
  ordersEnabled: boolean;
}

/** Liste/detay başlığında dönen tek batch satırı (JSON-güvenli). */
export interface InvoiceBatchRow {
  id: string;
  customerId: string;
  customerName: string;
  paymentType: string;
  paymentTypeId: number;
  paymentTypeLabel: string;
  periodStart: string;
  periodEnd: string;
  birfaturaOrderId: string;
  orderCode: string;
  status: InvoiceBatchStatus;
  orderCount: number;
  productsTotalTaxExcluding: number;
  productsTotalTaxIncluding: number;
  totalPaidTaxExcluding: number;
  totalPaidTaxIncluding: number;
  invoiceUrl: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  invoicedAt: string | null;
  frozenAt: string | null;
  createdAt: string;
}

/** Ay-ay gruplanmış batch listesi (panelde ana görünüm). */
export interface InvoiceMonthGroup {
  /** `YYYY-MM` (Europe/Istanbul). */
  month: string;
  /** "Haziran 2026" gibi TR etiketi. */
  monthLabel: string;
  batchCount: number;
  totalTaxIncluding: number;
  batches: InvoiceBatchRow[];
}

/** Batch detayındaki tek üye sipariş. */
export interface InvoiceBatchMember {
  id: string;
  humanOrderNo: string;
  status: string;
  shippedAt: string | null;
  invoicedAt: string | null;
  quantity: number;
  itemCount: number;
  totalTaxIncluding: number;
}

/** Batch detayındaki tek kalem satırı (insan-okur döküm). */
export interface InvoiceBatchLine {
  /** Bu satırın ait olduğu siparişin no'su (humanOrderNo, önek yok). */
  orderCode: string;
  productCode: string;
  productName: string;
  quantity: number;
  vatRate: number;
  unitPriceTaxExcluding: number;
  unitPriceTaxIncluding: number;
  lineTotalTaxExcluding: number;
  lineTotalTaxIncluding: number;
  isPackaging: boolean;
}

/** Tam batch detayı (başlık + üye siparişler + kalem dökümü). */
export interface InvoiceBatchDetail extends InvoiceBatchRow {
  totalQuantity: number;
  members: InvoiceBatchMember[];
  lines: InvoiceBatchLine[];
}

@Injectable()
export class AdminInvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly freeze: FreezeService,
    private readonly previewSvc: PreviewService,
    private readonly settings: AppSettingsService,
    private readonly audit: AuditService,
  ) {}

  // ── Ayarlar ───────────────────────────────────────────────────────────────

  /** Panelde gösterilecek fatura ayar bloğu (AppSetting'ten okur). */
  async getSettings(): Promise<InvoiceSettings> {
    const [cutoffDay, packagingUnitFee, consolidationEnabled, ordersEnabled] =
      await Promise.all([
        this.settings.getNumber(CUTOFF_DAY_KEY, DEFAULT_CUTOFF_DAY),
        this.settings.getString(PACKAGING_FEE_KEY, DEFAULT_PACKAGING_UNIT_FEE),
        this.settings.getBoolean(CONSOLIDATION_ENABLED_KEY, true),
        this.settings.getBoolean(ORDERS_ENABLED_KEY, false),
      ]);
    return { cutoffDay, packagingUnitFee, consolidationEnabled, ordersEnabled };
  }

  /**
   * Verilen ayar alanlarını tek tek AppSetting'e yazar (her biri içeride
   * tip/min-max doğrulanır + audit'lenir), sonra güncel bloğu döner.
   */
  async updateSettings(
    patch: {
      cutoffDay?: number;
      packagingUnitFee?: string;
      consolidationEnabled?: boolean;
      ordersEnabled?: boolean;
    },
    actor: { id: string; tenantId: string },
  ): Promise<InvoiceSettings> {
    if (patch.cutoffDay !== undefined) {
      await this.settings.set(CUTOFF_DAY_KEY, String(patch.cutoffDay), actor);
    }
    if (patch.packagingUnitFee !== undefined) {
      await this.settings.set(PACKAGING_FEE_KEY, patch.packagingUnitFee, actor);
    }
    if (patch.consolidationEnabled !== undefined) {
      await this.settings.set(
        CONSOLIDATION_ENABLED_KEY,
        String(patch.consolidationEnabled),
        actor,
      );
    }
    if (patch.ordersEnabled !== undefined) {
      await this.settings.set(
        ORDERS_ENABLED_KEY,
        String(patch.ordersEnabled),
        actor,
      );
    }
    return this.getSettings();
  }

  // ── Kesim / Önizleme (ortak motorlara delege) ───────────────────────────────

  /** Tekli (customerId) veya toplu kesim tetiği — gerçek InvoiceBatch'leri donar. */
  async freezeInvoices(
    customerId: string | undefined,
    actorId: string,
    asOf?: string,
  ): Promise<FreezeResult> {
    // Manuel kesim tarihi (cutoff) — önizlemeyle birebir aynı semantik.
    const cutoff = asOf ? new Date(asOf) : undefined;
    return customerId
      ? this.freeze.freezeSingle(customerId, actorId, cutoff)
      : this.freeze.freezeAll(actorId, cutoff);
  }

  /** Önizleme — DB'ye yazmadan kesilecek faturanın birebir aynısını üretir. */
  async preview(opts: {
    customerId?: string;
    asOf?: string;
  }): Promise<PreviewResult> {
    return this.previewSvc.preview({
      customerId: opts.customerId,
      asOf: opts.asOf ? new Date(opts.asOf) : undefined,
    });
  }

  // ── İptal (birfatura.md §12.9) ──────────────────────────────────────────────

  /**
   * Donmuş (`frozen`) bir batch'i iptal eder ve üye siparişleri serbest bırakır.
   *
   * Kurallar (iptal-batch etkileşim guard'ı):
   *  - Faturalanmış batch (`invoiced` / `invoicedAt != null`) iptal EDİLEMEZ
   *    → `ConflictException` (geri alınamaz; e-fatura zaten kesilmiş).
   *  - Zaten `cancelled` ise idempotent: mevcut detay döner (no-op).
   *  - `frozen` ise: tek transaction'da batch `cancelled` yapılır + tüm üye
   *    Order `invoiceBatchId=null` (+ invoice* alanları temizlenir) ile serbest
   *    bırakılır → bir sonraki kesimde yeni döneme süpürülür (asla kaybolmaz).
   *
   * Not: Aynı `(customerId, paymentType, periodEnd)` için iptal sonrası freeze,
   * mevcut (cancelled) batch'i bulup atlar (unique anahtar) → üyeler aynı döneme
   * tekrar donmaz, bir SONRAKİ döneme akar (birfatura.md §12.9, bilinçli davranış).
   */
  async cancelBatch(id: string, actorId: string): Promise<InvoiceBatchDetail> {
    const batch = await this.prisma.invoiceBatch.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        invoicedAt: true,
        customerId: true,
        paymentType: true,
        periodEnd: true,
      },
    });
    if (!batch) throw new NotFoundException('Fatura batch bulunamadı');

    // Zaten iptal → idempotent no-op.
    if (batch.status === InvoiceBatchStatus.cancelled) {
      return this.getBatch(id);
    }

    // Faturalanmış → iptal edilemez (e-fatura kesilmiş, geri alınamaz).
    if (batch.status === InvoiceBatchStatus.invoiced || batch.invoicedAt) {
      throw new ConflictException('Faturalanmış batch iptal edilemez');
    }

    // frozen → iptal + üyeleri serbest bırak (tek transaction, atomik).
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.invoiceBatch.updateMany({
        // Yarış guard'ı: yalnız hâlâ frozen + faturalanmamış batch'i talep et.
        where: { id: batch.id, status: 'frozen', invoicedAt: null },
        data: { status: 'cancelled' },
      });
      if (updated.count === 0) {
        return { applied: false, releasedCount: 0 };
      }
      const released = await tx.order.updateMany({
        where: { invoiceBatchId: batch.id },
        data: {
          invoiceBatchId: null,
          invoiceUrl: null,
          invoiceNumber: null,
          invoiceDate: null,
          invoicedAt: null,
        },
      });
      return { applied: true, releasedCount: released.count };
    });

    if (!result.applied) {
      // Okuma↔yazma arasında biri faturaladı/iptal etti → durum değişti.
      throw new ConflictException('Batch durumu değişti, iptal edilemedi');
    }

    void this.audit.log({
      actorType: 'admin',
      actorId,
      action: 'BIRFATURA_BATCH_CANCEL',
      target: batch.id,
      metadata: {
        customerId: batch.customerId,
        paymentType: batch.paymentType,
        periodEnd: batch.periodEnd.toISOString(),
        releasedOrderCount: result.releasedCount,
      },
    });

    return this.getBatch(id);
  }

  // ── Listeleme / Detay ──────────────────────────────────────────────────────

  /** Tüm batch'leri ay-ay gruplanmış döner (opsiyonel müşteri/durum filtresi). */
  async listBatches(filters: {
    customerId?: string;
    status?: string;
  }): Promise<{ months: InvoiceMonthGroup[]; batchCount: number }> {
    const where: Prisma.InvoiceBatchWhereInput = {};
    if (filters.customerId) where.customerId = filters.customerId;
    const status = this.parseStatus(filters.status);
    if (status) where.status = status;

    const batches = await this.prisma.invoiceBatch.findMany({
      where,
      orderBy: { periodEnd: 'desc' },
      include: {
        customer: { select: { name: true } },
        _count: { select: { orders: true } },
      },
    });

    const rows = batches.map((b) =>
      this.serializeRow(b, b.customer?.name ?? '-', b._count.orders),
    );
    return { months: this.groupByMonth(rows, batches), batchCount: rows.length };
  }

  /** Tek bir bayinin tüm faturaları (alt sayfa / müşteri detayı geçmişi). */
  async listCustomerBatches(customerId: string): Promise<{
    customer: { id: string; name: string };
    months: InvoiceMonthGroup[];
    batchCount: number;
  }> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, name: true },
    });
    if (!customer) throw new NotFoundException('Müşteri bulunamadı');

    const { months, batchCount } = await this.listBatches({ customerId });
    return {
      customer: { id: customer.id, name: customer.name ?? '-' },
      months,
      batchCount,
    };
  }

  /**
   * Tek batch'in tam detayı: başlık + üye siparişler + kalem dökümü.
   *
   * Kalem dökümü FROZEN veriden yeniden kurulur (drift yok): ürün satırları
   * donmuş `OrderItem.unitPrice`'tan §2 KDV'siyle (%20), "Kargo Bedeli" satırı
   * ise saklı snapshot toplamı ile ürün satırları farkından türetilir → satırlar
   * her zaman saklı batch toplamlarına birebir denk gelir (paketleme ücreti
   * sonradan değişse bile).
   */
  async getBatch(id: string): Promise<InvoiceBatchDetail> {
    const batch = await this.prisma.invoiceBatch.findUnique({
      where: { id },
      include: {
        customer: { select: { name: true } },
        orders: {
          orderBy: { humanOrderNo: 'asc' },
          select: {
            id: true,
            humanOrderNo: true,
            packagingCost: true,
            status: true,
            shippedAt: true,
            invoicedAt: true,
            items: {
              orderBy: { id: 'asc' },
              select: {
                productId: true,
                productSlug: true,
                productName: true,
                unitPrice: true,
                qty: true,
                internalCodeSnapshot: true,
                publicBarcodeSnapshot: true,
                product: {
                  select: {
                    id: true,
                    internalCode: true,
                    publicBarcode: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!batch) throw new NotFoundException('Fatura batch bulunamadı');

    const flatItems = batch.orders.flatMap((o) => {
      const oQty = o.items.reduce((a, it) => a + it.qty, 0);
      const pkgUnit = orderPackagingUnitExcl(o.packagingCost, oQty);
      return o.items.map((it) => ({
        ...it,
        orderCode: o.humanOrderNo,
        packagingUnitExcl: pkgUnit,
      }));
    });
    const totalQuantity = flatItems.reduce((acc, it) => acc + it.qty, 0);

    // Paketleme ücreti her ürün matrahına gömülü (ayrı "Kargo Bedeli" satırı YOK).
    // Her siparişin GERÇEK packagingCost'undan birim matrah (paketlemesiz → 0) →
    // satır toplamları bayinin ödediğine (Σ order.total) birebir denk gelir.
    const lines: InvoiceBatchLine[] = flatItems.map((item) => {
      const unitExcl = item.unitPrice.add(item.packagingUnitExcl);
      const unitIncl = vatAdd(unitExcl, CONSOLIDATION_VAT_RATE);
      return {
        orderCode: item.orderCode,
        productCode: resolveLineProductCode(item),
        productName: item.productName,
        quantity: item.qty,
        vatRate: CONSOLIDATION_VAT_RATE,
        unitPriceTaxExcluding: decimalToNumber(unitExcl),
        unitPriceTaxIncluding: decimalToNumber(unitIncl),
        lineTotalTaxExcluding: decimalToNumber(unitExcl.mul(item.qty)),
        lineTotalTaxIncluding: decimalToNumber(unitIncl.mul(item.qty)),
        isPackaging: false,
      };
    });

    const members: InvoiceBatchMember[] = batch.orders.map((o) => {
      let incl = new Prisma.Decimal(0);
      let qty = 0;
      for (const item of o.items) {
        incl = incl.add(vatAdd(item.unitPrice, CONSOLIDATION_VAT_RATE).mul(item.qty));
        qty += item.qty;
      }
      return {
        id: o.id,
        humanOrderNo: o.humanOrderNo,
        status: o.status,
        shippedAt: o.shippedAt ? o.shippedAt.toISOString() : null,
        invoicedAt: o.invoicedAt ? o.invoicedAt.toISOString() : null,
        quantity: qty,
        itemCount: o.items.length,
        totalTaxIncluding: decimalToNumber(incl),
      };
    });

    // Paket (Entegrasyon) faturası: üye sipariş YOK → tek sentetik satır.
    let outLines = lines;
    let outMembers = members;
    let outTotalQty = totalQuantity;
    if (batch.source === 'integration_package') {
      const incl = new Prisma.Decimal(batch.productsTotalTaxIncluding);
      const excl = new Prisma.Decimal(batch.productsTotalTaxExcluding);
      outLines = [
        {
          orderCode: batch.orderCode,
          productCode: 'ENTEGRASYON',
          productName: batch.lineDescription ?? 'Entegrasyon Paketi',
          quantity: 1,
          vatRate: CONSOLIDATION_VAT_RATE,
          unitPriceTaxExcluding: decimalToNumber(excl),
          unitPriceTaxIncluding: decimalToNumber(incl),
          lineTotalTaxExcluding: decimalToNumber(excl),
          lineTotalTaxIncluding: decimalToNumber(incl),
          isPackaging: false,
        },
      ];
      outMembers = [];
      outTotalQty = 1;
    }

    const row = this.serializeRow(
      batch,
      batch.customer?.name ?? '-',
      batch.source === 'integration_package' ? 1 : batch.orders.length,
    );
    return { ...row, totalQuantity: outTotalQty, members: outMembers, lines: outLines };
  }

  // ── Yardımcılar ────────────────────────────────────────────────────────────

  /** Saklı batch satırını JSON-güvenli DTO'ya çevirir (BigInt→string, Decimal→number). */
  private serializeRow(
    b: {
      id: string;
      customerId: string;
      paymentType: string;
      periodStart: Date;
      periodEnd: Date;
      birfaturaOrderId: bigint;
      orderCode: string;
      status: InvoiceBatchStatus;
      productsTotalTaxExcluding: Prisma.Decimal;
      productsTotalTaxIncluding: Prisma.Decimal;
      totalPaidTaxExcluding: Prisma.Decimal;
      totalPaidTaxIncluding: Prisma.Decimal;
      invoiceUrl: string | null;
      invoiceNumber: string | null;
      invoiceDate: Date | null;
      invoicedAt: Date | null;
      frozenAt: Date | null;
      createdAt: Date;
    },
    customerName: string,
    orderCount: number,
  ): InvoiceBatchRow {
    return {
      id: b.id,
      customerId: b.customerId,
      customerName,
      paymentType: b.paymentType,
      paymentTypeId: mapPaymentTypeToBirfaturaId(b.paymentType),
      paymentTypeLabel: mapPaymentTypeToBirfaturaLabel(b.paymentType),
      periodStart: b.periodStart.toISOString(),
      periodEnd: b.periodEnd.toISOString(),
      birfaturaOrderId: b.birfaturaOrderId.toString(),
      orderCode: b.orderCode,
      status: b.status,
      orderCount,
      productsTotalTaxExcluding: decimalToNumber(b.productsTotalTaxExcluding),
      productsTotalTaxIncluding: decimalToNumber(b.productsTotalTaxIncluding),
      totalPaidTaxExcluding: decimalToNumber(b.totalPaidTaxExcluding),
      totalPaidTaxIncluding: decimalToNumber(b.totalPaidTaxIncluding),
      invoiceUrl: b.invoiceUrl,
      invoiceNumber: b.invoiceNumber,
      invoiceDate: b.invoiceDate ? b.invoiceDate.toISOString() : null,
      invoicedAt: b.invoicedAt ? b.invoicedAt.toISOString() : null,
      frozenAt: b.frozenAt ? b.frozenAt.toISOString() : null,
      createdAt: b.createdAt.toISOString(),
    };
  }

  /** Serialize edilmiş satırları periodEnd ayına (Europe/Istanbul) göre gruplar. */
  private groupByMonth(
    rows: InvoiceBatchRow[],
    batches: { periodEnd: Date }[],
  ): InvoiceMonthGroup[] {
    const order: string[] = [];
    const map = new Map<string, InvoiceMonthGroup>();
    rows.forEach((row, i) => {
      const periodEnd = batches[i].periodEnd;
      const month = istanbulMonthKey(periodEnd);
      let group = map.get(month);
      if (!group) {
        group = {
          month,
          monthLabel: istanbulMonthLabel(periodEnd),
          batchCount: 0,
          totalTaxIncluding: 0,
          batches: [],
        };
        map.set(month, group);
        order.push(month);
      }
      group.batches.push(row);
      group.batchCount += 1;
      group.totalTaxIncluding += row.totalPaidTaxIncluding;
    });
    // periodEnd desc sıralıydı → ay anahtarları da desc gelir.
    return order.map((m) => map.get(m) as InvoiceMonthGroup);
  }

  private parseStatus(status?: string): InvoiceBatchStatus | undefined {
    if (!status) return undefined;
    return (Object.values(InvoiceBatchStatus) as string[]).includes(status)
      ? (status as InvoiceBatchStatus)
      : undefined;
  }
}
