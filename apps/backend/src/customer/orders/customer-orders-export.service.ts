import { Injectable } from '@nestjs/common';
import { Prisma, OrderStatus } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../../prisma/prisma.service';
import {
  type ListOrdersQueryDto,
  resolveOrderDateRange,
} from './dto/list-orders.query.dto';
import { trDateRange, trTodayKey } from '../../common/utils/tr-time';

const EXPORT_MAX_ROWS = 5000;

const STATUS_LABEL_TR: Record<string, string> = {
  paid: 'Ödendi',
  preparing: 'Hazırlanıyor',
  processing: 'İşleniyor',
  shipped: 'Kargoya Verildi',
  delivered: 'Teslim Edildi',
  cancelled: 'İptal Edildi',
  returned: 'İade Edildi',
  refunded: 'İade Edildi',
};

const PRISMA_ORDER_STATUS_VALUES = new Set<OrderStatus>([
  OrderStatus.paid,
  OrderStatus.preparing,
  OrderStatus.shipped,
  OrderStatus.cancelled,
  OrderStatus.refunded,
]);

function toPrismaOrderStatus(value: string | undefined): OrderStatus | null {
  if (!value) return null;
  return PRISMA_ORDER_STATUS_VALUES.has(value as OrderStatus)
    ? (value as OrderStatus)
    : null;
}

const MARKETPLACE_LABEL_TR: Record<string, string> = {
  self: 'Kendim İçin',
  other: 'Diğer Satış Kanalı',
};

const CARGO_LABEL_TR: Record<string, string> = {
  aras: 'Aras Kargo',
  surat: 'Sürat Kargo',
  ptt: 'PTT Kargo',
  dhl: 'DHL',
  mng: 'MNG Kargo',
  yurtici: 'Yurtiçi Kargo',
};

interface ExportRow {
  humanOrderNo: string | null;
  status: string;
  createdAt: Date;
  marketplace: string | null;
  cargoCompany: string | null;
  cargoBarcode: string | null;
  endCustomerName: string | null;
  customerName: string | null;
  paymentType: string | null;
  subtotal: Prisma.Decimal | null;
  kdvRate: number | null;
  kdvAmount: Prisma.Decimal | null;
  packagingCost: Prisma.Decimal | null;
  total: Prisma.Decimal;
  itemCount: number;
  totalQty: number;
  productsSummary: string;
}

@Injectable()
export class CustomerOrdersExportService {
  constructor(private readonly prisma: PrismaService) {}

  async export(
    customerId: string,
    query: ListOrdersQueryDto,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const where: Prisma.OrderWhereInput = { customerId };

    const mappedStatus = toPrismaOrderStatus(query.status);
    if (mappedStatus) {
      where.status = mappedStatus;
    } else {
      // awaiting_payment iç ara durumdur (ödemesi alınmamış kart denemesi) —
      // müşterinin Excel sipariş dökümünde ASLA görünmez (liste ile aynı kural).
      where.status = { not: 'awaiting_payment' };
    }
    // Tamamlanmamış kart denemeleri (cancelled & hiç ödenmemiş, paidAt=null)
    // müşterinin Excel dökümünde GÖRÜNMEZ. Ödenip iptal edilenler kalır.
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
      { NOT: { status: 'cancelled', paidAt: null } },
    ];

    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { humanOrderNo: { contains: search, mode: 'insensitive' } },
        { trackingNumber: { contains: search, mode: 'insensitive' } },
        { cargoBarcode: { contains: search, mode: 'insensitive' } },
        { endCustomerName: { contains: search, mode: 'insensitive' } },
        {
          items: {
            some: {
              productName: { contains: search, mode: 'insensitive' },
            },
          },
        },
      ];
    }

    if (query.marketplace) {
      where.marketplace = { contains: query.marketplace, mode: 'insensitive' };
    }
    if (query.cargoCompany) {
      where.cargoCompany = {
        contains: query.cargoCompany,
        mode: 'insensitive',
      };
    }

    // datePreset → efektif tarih aralığı. Frontend dışa aktarma butonu ham
    // `datePreset` gönderir; burada dateFrom/dateTo'ya çevrilir.
    const { dateFrom, dateTo } = resolveOrderDateRange(query);
    {
      // TR takvim günü: başlangıç dahil, bitiş günü de DAHİL (yarı-açık üst sınır).
      const range = trDateRange(dateFrom, dateTo);
      if (range) where.createdAt = range;
    }

    const orders = await this.prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: EXPORT_MAX_ROWS,
      select: {
        humanOrderNo: true,
        status: true,
        createdAt: true,
        marketplace: true,
        cargoCompany: true,
        cargoBarcode: true,
        endCustomerName: true,
        customerName: true,
        paymentType: true,
        subtotal: true,
        kdvRate: true,
        kdvAmount: true,
        packagingCost: true,
        total: true,
        items: {
          select: { productName: true, qty: true },
        },
      },
    });

    const rows: ExportRow[] = orders.map((o) => {
      const totalQty = o.items.reduce((acc, it) => acc + (it.qty ?? 0), 0);
      const productsSummary = o.items
        .map((it) => `${it.productName} x${it.qty}`)
        .join(' | ')
        .slice(0, 500);
      return {
        humanOrderNo: o.humanOrderNo,
        status: o.status,
        createdAt: o.createdAt,
        marketplace: o.marketplace,
        cargoCompany: o.cargoCompany,
        cargoBarcode: o.cargoBarcode,
        endCustomerName: o.endCustomerName,
        customerName: o.customerName,
        paymentType: o.paymentType,
        subtotal: o.subtotal,
        kdvRate: o.kdvRate,
        kdvAmount: o.kdvAmount,
        packagingCost: o.packagingCost,
        total: o.total,
        itemCount: o.items.length,
        totalQty,
        productsSummary,
      };
    });

    const buffer = await this.buildWorkbook(rows, query);
    const filename = this.buildFilename(query);
    return { buffer, filename };
  }

  private async buildWorkbook(
    rows: ExportRow[],
    query: ListOrdersQueryDto,
  ): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Toptan Budur';
    wb.created = new Date();

    const ws = wb.addWorksheet('Siparişlerim', {
      views: [{ state: 'frozen', ySplit: 5 }],
      properties: { defaultRowHeight: 18 },
    });

    // 16 sütun (A–P). Şehir, İlçe, Takip No, Kargo Ücreti ve Para Birimi
    // kolonları müşteri talebiyle kaldırıldı.
    ws.columns = [
      { key: 'humanOrderNo', width: 18 },
      { key: 'createdAt', width: 18 },
      { key: 'status', width: 16 },
      { key: 'marketplace', width: 15 },
      { key: 'endCustomerName', width: 26 },
      { key: 'cargoCompany', width: 16 },
      { key: 'cargoBarcode', width: 22 },
      { key: 'itemCount', width: 11 },
      { key: 'totalQty', width: 11 },
      { key: 'productsSummary', width: 56 },
      { key: 'paymentType', width: 14 },
      { key: 'subtotal', width: 14 },
      { key: 'kdvRate', width: 10 },
      { key: 'kdvAmount', width: 14 },
      { key: 'packagingCost', width: 14 },
      { key: 'total', width: 16 },
    ];
    const LAST_COL = 'P';

    ws.mergeCells(`A1:${LAST_COL}1`);
    const titleCell = ws.getCell('A1');
    titleCell.value = 'Toptan Budur — Siparişlerim';
    titleCell.font = { name: 'Calibri', size: 18, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    titleCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1267F4' },
    };
    ws.getRow(1).height = 34;

    ws.mergeCells(`A2:${LAST_COL}2`);
    const subtitleCell = ws.getCell('A2');
    subtitleCell.value = this.buildSubtitle(query, rows.length);
    subtitleCell.font = { name: 'Calibri', size: 11, color: { argb: 'FFFFFFFF' } };
    subtitleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    subtitleCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0B3FA3' },
    };
    ws.getRow(2).height = 22;

    ws.getRow(3).height = 6;

    const totals = rows.reduce(
      (acc, r) => {
        acc.subtotal += toNum(r.subtotal);
        acc.kdvAmount += toNum(r.kdvAmount);
        acc.packagingCost += toNum(r.packagingCost);
        acc.total += toNum(r.total);
        acc.qty += r.totalQty;
        return acc;
      },
      { subtotal: 0, kdvAmount: 0, packagingCost: 0, total: 0, qty: 0 },
    );

    ws.mergeCells('A4:E4');
    ws.getCell('A4').value = `${rows.length} sipariş • ${totals.qty} adet ürün`;
    ws.getCell('A4').font = { bold: true, size: 11, color: { argb: 'FF0B3FA3' } };
    ws.getCell('A4').alignment = { vertical: 'middle' };

    ws.mergeCells('F4:K4');
    ws.getCell('F4').value = `Ara Toplam: ${fmtTRY(totals.subtotal)}   KDV: ${fmtTRY(totals.kdvAmount)}`;
    ws.getCell('F4').font = { size: 11, color: { argb: 'FF334155' } };
    ws.getCell('F4').alignment = { vertical: 'middle' };

    ws.mergeCells('L4:P4');
    ws.getCell('L4').value = `Paketleme: ${fmtTRY(totals.packagingCost)}   GENEL TOPLAM: ${fmtTRY(totals.total)}`;
    ws.getCell('L4').font = { bold: true, size: 11, color: { argb: 'FF14532D' } };
    ws.getCell('L4').alignment = { vertical: 'middle', horizontal: 'right' };
    ws.getRow(4).height = 22;

    const headers = [
      'Sipariş No',
      'Tarih',
      'Durum',
      'Satış Kanalı',
      'Müşteri',
      'Kargo Firması',
      'Kargo Barkodu',
      'Ürün Adedi',
      'Toplam Adet',
      'Ürünler',
      'Ödeme',
      'Ara Toplam',
      'KDV %',
      'KDV Tutarı',
      'Paketleme',
      'Toplam (KDV Dahil)',
    ];
    const headerRow = ws.getRow(5);
    headers.forEach((h, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = h;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF0F172A' },
      };
      cell.border = thinBorder('FF1E293B');
    });
    headerRow.height = 28;

    rows.forEach((r, idx) => {
      const row = ws.addRow({
        humanOrderNo: r.humanOrderNo ?? '—',
        createdAt: r.createdAt,
        status: STATUS_LABEL_TR[r.status] ?? r.status,
        marketplace: labelOrRaw(r.marketplace, MARKETPLACE_LABEL_TR),
        endCustomerName: r.endCustomerName ?? r.customerName ?? '—',
        cargoCompany: labelOrRaw(r.cargoCompany, CARGO_LABEL_TR),
        cargoBarcode: r.cargoBarcode ?? '—',
        itemCount: r.itemCount,
        totalQty: r.totalQty,
        productsSummary: r.productsSummary || '—',
        paymentType: r.paymentType ?? '—',
        subtotal: toNum(r.subtotal),
        kdvRate: r.kdvRate ?? null,
        kdvAmount: toNum(r.kdvAmount),
        packagingCost: toNum(r.packagingCost),
        total: toNum(r.total),
      });

      const zebra = idx % 2 === 1;
      row.eachCell((cell) => {
        cell.border = thinBorder('FFE2E8F0');
        cell.alignment = { vertical: 'middle', wrapText: true };
        if (zebra) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF8FAFC' },
          };
        }
      });

      row.getCell('createdAt').numFmt = 'dd.mm.yyyy hh:mm';
      row.getCell('createdAt').alignment = { vertical: 'middle', horizontal: 'left' };
      row.getCell('itemCount').alignment = { vertical: 'middle', horizontal: 'center' };
      row.getCell('totalQty').alignment = { vertical: 'middle', horizontal: 'center' };
      row.getCell('kdvRate').alignment = { vertical: 'middle', horizontal: 'center' };
      if (r.kdvRate !== null && r.kdvRate !== undefined) {
        row.getCell('kdvRate').value = `%${r.kdvRate}`;
      } else {
        row.getCell('kdvRate').value = '—';
      }

      const moneyFmt = '#,##0.00 ₺';
      (['subtotal', 'kdvAmount', 'packagingCost', 'total'] as const).forEach((k) => {
        const cell = row.getCell(k);
        cell.numFmt = moneyFmt;
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
      });

      row.getCell('total').font = { bold: true, color: { argb: 'FF065F46' } };

      const statusColor = statusFill(r.status);
      const statusCell = row.getCell('status');
      statusCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: statusColor.bg },
      };
      statusCell.font = { bold: true, color: { argb: statusColor.fg }, size: 10 };
      statusCell.alignment = { vertical: 'middle', horizontal: 'center' };

      row.height = 22;
    });

    if (rows.length > 0) {
      const totalRow = ws.addRow({
        humanOrderNo: 'TOPLAM',
        totalQty: totals.qty,
        subtotal: totals.subtotal,
        kdvAmount: totals.kdvAmount,
        packagingCost: totals.packagingCost,
        total: totals.total,
      });
      totalRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF0F172A' },
        };
        cell.border = thinBorder('FF1E293B');
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
      });
      totalRow.getCell('humanOrderNo').alignment = { vertical: 'middle', horizontal: 'left' };
      totalRow.getCell('totalQty').alignment = { vertical: 'middle', horizontal: 'center' };
      const moneyFmt = '#,##0.00 ₺';
      (['subtotal', 'kdvAmount', 'packagingCost', 'total'] as const).forEach((k) => {
        totalRow.getCell(k).numFmt = moneyFmt;
      });
      totalRow.height = 26;
    } else {
      const emptyRow = ws.addRow({});
      ws.mergeCells(`A${emptyRow.number}:${LAST_COL}${emptyRow.number}`);
      const cell = ws.getCell(`A${emptyRow.number}`);
      cell.value = 'Seçili filtrelerle eşleşen sipariş bulunamadı.';
      cell.font = { italic: true, color: { argb: 'FF64748B' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      emptyRow.height = 40;
    }

    ws.autoFilter = {
      from: { row: 5, column: 1 },
      to: { row: 5, column: headers.length },
    };

    const ab = await wb.xlsx.writeBuffer();
    return Buffer.from(ab as ArrayBuffer);
  }

  private buildSubtitle(query: ListOrdersQueryDto, count: number): string {
    const parts: string[] = [];
    parts.push(`Oluşturma: ${formatDateTR(new Date())}`);
    const { dateFrom, dateTo } = resolveOrderDateRange(query);
    if (dateFrom || dateTo) {
      const range = `${dateFrom ?? '...'} → ${dateTo ?? '...'}`;
      parts.push(`Tarih aralığı: ${range}`);
    }
    if (query.status) parts.push(`Durum: ${STATUS_LABEL_TR[query.status] ?? query.status}`);
    if (query.marketplace) parts.push(`Satış Kanalı: ${labelOrRaw(query.marketplace, MARKETPLACE_LABEL_TR)}`);
    if (query.cargoCompany) parts.push(`Kargo: ${labelOrRaw(query.cargoCompany, CARGO_LABEL_TR)}`);
    if (query.search) parts.push(`Arama: "${query.search}"`);
    parts.push(`${count} kayıt`);
    return parts.join('   •   ');
  }

  private buildFilename(query: ListOrdersQueryDto): string {
    const today = trTodayKey();
    const suffix: string[] = [];
    if (query.status) suffix.push(query.status);
    if (query.marketplace) suffix.push(query.marketplace);
    if (query.cargoCompany) suffix.push(query.cargoCompany);
    const tail = suffix.length > 0 ? `-${suffix.join('-')}` : '';
    return `siparislerim-${today}${tail}.xlsx`;
  }
}

function toNum(value: Prisma.Decimal | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function labelOrRaw(value: string | null, map: Record<string, string>): string {
  if (!value) return '—';
  return map[value.toLowerCase()] ?? value;
}

function thinBorder(color: string): ExcelJS.Borders {
  const side: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: color } };
  return {
    top: side,
    left: side,
    bottom: side,
    right: side,
    diagonal: side,
  } as ExcelJS.Borders;
}

function fmtTRY(n: number): string {
  return n.toLocaleString('tr-TR', {
    style: 'currency',
    currency: 'TRY',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDateTR(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function statusFill(status: string): { bg: string; fg: string } {
  switch (status) {
    case 'shipped':
      return { bg: 'FFDCFCE7', fg: 'FF14532D' };
    case 'refunded':
      return { bg: 'FFE0E7FF', fg: 'FF312E81' };
    case 'preparing':
    case 'paid':
      return { bg: 'FFFEF3C7', fg: 'FF78350F' };
    case 'cancelled':
      return { bg: 'FFFEE2E2', fg: 'FF7F1D1D' };
    default:
      return { bg: 'FFF1F5F9', fg: 'FF0F172A' };
  }
}
