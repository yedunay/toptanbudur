import { Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceBatchStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CONSOLIDATION_VAT_RATE,
  orderPackagingUnitExcl,
} from '../../birfatura/consolidation/pricing.engine';
import { resolveLineProductCode } from '../../birfatura/consolidation/batch-mapper';
import {
  decimalToNumber,
  vatAdd,
  istanbulMonthKey,
  istanbulMonthLabel,
} from '../../birfatura/birfatura.utils';
import { mapPaymentTypeToBirfaturaLabel } from '../../birfatura/birfatura.constants';

/**
 * Faz 8 — Bayi "Faturalarım" servis katmanı (birfatura.md §10).
 *
 * Admin fatura panelinin (AdminInvoicesService) bayi-kapsamlı, salt-okuma
 * yansımasıdır. Tek bayinin kendi konsolide aylık toplu faturalarını listeler
 * (aylık gruplu) ve tek batch detayını döner.
 *
 * Güvenlik: Her sorgu `customerId` ile sınırlıdır; `getBatch` ayrıca sahiplik
 * doğrular (`where { id, customerId }`) → bir bayi başka bir bayinin faturasını
 * asla göremez. DTO'lar bayi-güvenli alanlara indirgenir: tedarikçi/maliyet
 * verisi InvoiceBatch'te zaten yok; BirFatura iç alanları (`birfaturaOrderId`,
 * `paymentTypeId`, `frozenAt`, `customerId`) bayiye sızdırılmaz.
 *
 * Tutarlar `decimalToNumber` ile number'a, kalem dökümü FROZEN
 * `OrderItem.unitPrice`'tan §2 KDV'siyle (%20) yeniden kurulur (drift yok) —
 * admin `getBatch` ile birebir aynı mantık.
 */

/** Bayiye dönen tek batch satırı (bayi-güvenli, JSON-güvenli). */
export interface DealerInvoiceBatchRow {
  id: string;
  paymentType: string;
  paymentTypeLabel: string;
  periodStart: string;
  periodEnd: string;
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
  createdAt: string;
}

/** Ay-ay gruplanmış batch listesi (bayi ana görünümü). */
export interface DealerInvoiceMonthGroup {
  /** `YYYY-MM` (Europe/Istanbul). */
  month: string;
  /** "Haziran 2026" gibi TR etiketi. */
  monthLabel: string;
  batchCount: number;
  totalTaxIncluding: number;
  batches: DealerInvoiceBatchRow[];
}

/** Batch detayındaki tek üye sipariş. */
export interface DealerInvoiceBatchMember {
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
export interface DealerInvoiceBatchLine {
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
export interface DealerInvoiceBatchDetail extends DealerInvoiceBatchRow {
  monthLabel: string;
  totalQuantity: number;
  members: DealerInvoiceBatchMember[];
  lines: DealerInvoiceBatchLine[];
}

@Injectable()
export class CustomerInvoicesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Bayinin tüm faturalarını ay-ay gruplanmış döner. */
  async listMine(customerId: string): Promise<{
    months: DealerInvoiceMonthGroup[];
    batchCount: number;
  }> {
    const batches = await this.prisma.invoiceBatch.findMany({
      where: { customerId },
      orderBy: { periodEnd: 'desc' },
      include: { _count: { select: { orders: true } } },
    });

    const rows = batches.map((b) => this.serializeRow(b, b._count.orders));
    return { months: this.groupByMonth(rows, batches), batchCount: rows.length };
  }

  /**
   * Bayinin tek bir faturasının tam detayı (sahiplik doğrulamalı).
   *
   * Kalem dökümü FROZEN veriden yeniden kurulur (admin `getBatch` ile aynı):
   * ürün satırları donmuş `OrderItem.unitPrice`'tan §2 KDV'siyle (%20),
   * "Kargo Bedeli" satırı saklı snapshot toplamı ile ürün satırları farkından
   * türetilir → satırlar her zaman saklı batch toplamlarına birebir denk gelir.
   */
  async getMine(
    customerId: string,
    id: string,
  ): Promise<DealerInvoiceBatchDetail> {
    const batch = await this.prisma.invoiceBatch.findFirst({
      where: { id, customerId },
      include: {
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
    if (!batch) throw new NotFoundException('Fatura bulunamadı');

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
    const lines: DealerInvoiceBatchLine[] = flatItems.map((item) => {
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

    const members: DealerInvoiceBatchMember[] = batch.orders.map((o) => {
      let incl = new Prisma.Decimal(0);
      let qty = 0;
      for (const item of o.items) {
        incl = incl.add(
          vatAdd(item.unitPrice, CONSOLIDATION_VAT_RATE).mul(item.qty),
        );
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
    // Sipariş batch'leri (source='order') aynen üye siparişlerden türetilir.
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
      batch.source === 'integration_package' ? 1 : batch.orders.length,
    );
    return {
      ...row,
      monthLabel: istanbulMonthLabel(batch.periodEnd),
      totalQuantity: outTotalQty,
      members: outMembers,
      lines: outLines,
    };
  }

  // ── Yardımcılar ────────────────────────────────────────────────────────────

  /** Saklı batch satırını bayi-güvenli DTO'ya çevirir (Decimal→number). */
  private serializeRow(
    b: {
      id: string;
      paymentType: string;
      periodStart: Date;
      periodEnd: Date;
      status: InvoiceBatchStatus;
      productsTotalTaxExcluding: Prisma.Decimal;
      productsTotalTaxIncluding: Prisma.Decimal;
      totalPaidTaxExcluding: Prisma.Decimal;
      totalPaidTaxIncluding: Prisma.Decimal;
      invoiceUrl: string | null;
      invoiceNumber: string | null;
      invoiceDate: Date | null;
      invoicedAt: Date | null;
      createdAt: Date;
    },
    orderCount: number,
  ): DealerInvoiceBatchRow {
    return {
      id: b.id,
      paymentType: b.paymentType,
      paymentTypeLabel: mapPaymentTypeToBirfaturaLabel(b.paymentType),
      periodStart: b.periodStart.toISOString(),
      periodEnd: b.periodEnd.toISOString(),
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
      createdAt: b.createdAt.toISOString(),
    };
  }

  /** Serialize edilmiş satırları periodEnd ayına (Europe/Istanbul) göre gruplar. */
  private groupByMonth(
    rows: DealerInvoiceBatchRow[],
    batches: { periodEnd: Date }[],
  ): DealerInvoiceMonthGroup[] {
    const order: string[] = [];
    const map = new Map<string, DealerInvoiceMonthGroup>();
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
    return order.map((m) => map.get(m) as DealerInvoiceMonthGroup);
  }
}
