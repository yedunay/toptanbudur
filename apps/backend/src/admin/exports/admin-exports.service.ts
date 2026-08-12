import { Injectable, Logger } from '@nestjs/common';
import { Prisma, OrderStatus } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import {
  resolveSupplier,
  supplierMatchOr,
} from '../../profitability/supplier-attribution.util';
import { trDateRange, trTodayKey } from '../../common/utils/tr-time';

export interface ProductsExportFilter {
  supplierId?: string;
  from?: string;
  to?: string;
  category?: string;
  inStock?: boolean;
  minPrice?: number;
  maxPrice?: number;
  q?: string;
  brand?: string;
}

export interface OrdersExportFilter {
  from?: string;
  to?: string;
  status?: string;
  customerId?: string;
  supplierId?: string;
  /** Müşteri adı veya e-postası üzerinde insensitive contains. */
  customer?: string;
}

export interface AuditExportFilter {
  from?: string;
  to?: string;
  actorId?: string;
  action?: string;
  /** 'admin' → User aktörleri, 'customer' → Customer aktörleri. */
  audience?: 'admin' | 'customer';
  /** Serbest metin: action veya target üzerinde insensitive contains. */
  q?: string;
}

@Injectable()
export class AdminExportsService {
  private readonly logger = new Logger(AdminExportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async exportProducts(
    tenantId: string,
    filter: ProductsExportFilter,
    actor: { id: string; email?: string | null },
  ): Promise<{ buffer: Buffer; filename: string }> {
    // Dedup: aynı isimli ürünlerden yalnızca kazanan (isCanonical) export edilir.
    const where: Prisma.ProductWhereInput = { tenantId, isCanonical: true };
    if (filter.supplierId) where.supplierId = filter.supplierId;
    {
      const range = trDateRange(filter.from, filter.to);
      if (range) where.updatedAt = range;
    }
    if (filter.inStock) where.stock = { gt: 0 };
    if (filter.minPrice !== undefined || filter.maxPrice !== undefined) {
      where.price = {};
      if (filter.minPrice !== undefined)
        (where.price as Prisma.DecimalFilter).gte = filter.minPrice;
      if (filter.maxPrice !== undefined)
        (where.price as Prisma.DecimalFilter).lte = filter.maxPrice;
    }
    if (filter.brand && filter.brand.trim()) {
      where.brand = { contains: filter.brand.trim(), mode: 'insensitive' };
    }
    if (filter.q && filter.q.trim()) {
      const term = filter.q.trim();
      where.OR = [
        { name: { contains: term, mode: 'insensitive' } },
        { externalCode: { contains: term, mode: 'insensitive' } },
        { brand: { contains: term, mode: 'insensitive' } },
        { barcode: { contains: term, mode: 'insensitive' } },
      ];
    }
    if (filter.category) {
      const cat = await this.prisma.category.findFirst({
        where: { tenantId, slug: filter.category },
        select: { id: true, path: true },
      });
      if (!cat) {
        // Boş eşleşme — yine de boş workbook oluştur.
        where.categoryId = '__none__';
      } else {
        const descendants = await this.prisma.category.findMany({
          where: {
            tenantId,
            OR: [{ id: cat.id }, { path: { startsWith: `${cat.path} > ` } }],
          },
          select: { id: true },
        });
        where.categoryId = { in: descendants.map((d) => d.id) };
      }
    }

    // Cap'e ulaşılıp ulaşılmadığını anlamak için önce toplam sayım. 50K cap
    // sessizce kırpma yapmasın — kırpılırsa log + audit metadata uyarısı (#26).
    const EXPORT_ROW_CAP = 50_000;
    const matchedTotal = await this.prisma.product.count({ where });
    const truncated = matchedTotal > EXPORT_ROW_CAP;
    if (truncated) {
      this.logger.warn(
        `[export.products] cap aşıldı — tenant=${tenantId} eşleşen=${matchedTotal} cap=${EXPORT_ROW_CAP}; export sadece ilk ${EXPORT_ROW_CAP} satırı içeriyor (updatedAt desc).`,
      );
    }

    const products = await this.prisma.product.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: EXPORT_ROW_CAP,
      select: {
        id: true,
        externalCode: true,
        slug: true,
        name: true,
        brand: true,
        model: true,
        price: true,
        currency: true,
        stock: true,
        active: true,
        marketplaceListed: true,
        barcode: true,
        publicBarcode: true,
        updatedAt: true,
        category: { select: { name: true, path: true } },
        supplier: { select: { name: true } },
      },
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Toptan Budur';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('Ürünler');
    sheet.columns = [
      { header: 'SKU / Tedarikçi Kodu', key: 'externalCode', width: 24 },
      { header: 'Slug', key: 'slug', width: 30 },
      { header: 'Ürün Adı', key: 'name', width: 40 },
      { header: 'Marka', key: 'brand', width: 18 },
      { header: 'Model', key: 'model', width: 18 },
      { header: 'Orijinal Barkod', key: 'barcode', width: 18 },
      { header: 'Public Barkod (TBDR)', key: 'publicBarcode', width: 36 },
      { header: 'Tedarikçi', key: 'supplier', width: 22 },
      { header: 'Kategori', key: 'category', width: 32 },
      { header: 'Fiyat', key: 'price', width: 12, style: { numFmt: '#,##0.00' } },
      { header: 'Para Birimi', key: 'currency', width: 10 },
      { header: 'Stok', key: 'stock', width: 8 },
      { header: 'Aktif', key: 'active', width: 8 },
      { header: 'Vitrinde Görünür', key: 'marketplaceListed', width: 18 },
      { header: 'Son Güncelleme', key: 'updatedAt', width: 22 },
    ];
    sheet.getRow(1).font = { bold: true };

    for (const p of products) {
      sheet.addRow({
        externalCode: p.externalCode,
        slug: p.slug,
        name: p.name,
        brand: p.brand ?? '',
        model: p.model ?? '',
        barcode: p.barcode ?? '',
        publicBarcode: p.publicBarcode ?? '',
        supplier: p.supplier?.name ?? '',
        category: p.category?.path ?? p.category?.name ?? '',
        price: Number(p.price),
        currency: p.currency,
        stock: p.stock,
        active: p.active ? 'Evet' : 'Hayır',
        marketplaceListed: p.marketplaceListed ? 'Evet' : 'Hayır',
        updatedAt: p.updatedAt.toISOString(),
      });
    }

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const filename = `urunler-${trTodayKey()}.xlsx`;

    void this.audit.log({
      actorType: 'admin',
      actorId: actor.id,
      tenantId,
      action: 'EXPORT',
      target: 'products',
      metadata: {
        kind: 'products',
        count: products.length,
        matchedTotal,
        truncated,
        cap: EXPORT_ROW_CAP,
        filter,
        actorEmail: actor.email ?? null,
      },
    });

    return { buffer, filename };
  }

  async exportOrders(
    tenantId: string,
    filter: OrdersExportFilter,
    actor: { id: string; email?: string | null },
  ): Promise<{ buffer: Buffer; filename: string; count: number }> {
    const where: Prisma.OrderWhereInput = { tenantId };
    // awaiting_payment (tamamlanmamış kart denemesi) sipariş DÖKÜMÜNDE hiçbir
    // şekilde görünmez — kullanıcı bunları "iptal" sanıp kafası karışıyordu.
    // Yalnız gerçek statüler (paid/preparing/shipped/cancelled/refunded) dökümde
    // yer alır; cancelled yalnızca GERÇEKTEN iptal edilenler için görünür.
    if (filter.status && filter.status !== 'awaiting_payment') {
      where.status = filter.status as OrderStatus;
    } else {
      where.status = { not: 'awaiting_payment' };
    }
    // Tamamlanmamış kart denemeleri (cancelled & hiç ödenmemiş, paidAt=null)
    // sipariş DÖKÜMÜNDE asla görünmez (aynı tutarlı tekrar iptal kayıtları).
    // Ödenip iptal edilenler (paidAt dolu) görünmeye devam eder.
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
      { NOT: { status: 'cancelled', paidAt: null } },
    ];
    if (filter.customerId) where.customerId = filter.customerId;
    if (filter.customer && filter.customer.trim()) {
      const term = filter.customer.trim();
      where.OR = [
        { customerName: { contains: term, mode: 'insensitive' } },
        { customerEmail: { contains: term, mode: 'insensitive' } },
      ];
    }
    if (filter.supplierId) {
      // Tedarikçi atfı TEK KAYNAK (supplierMatchOr): override → snapshot →
      // product.supplierId. Aşağıdaki kalem-içi filtre (resolveSupplier) AYNI
      // önceliği kullanır — WHERE ile in-memory filtre ASLA sapmamalı, aksi
      // halde başka tedarikçinin kalemi sızar / eksik atfedilir.
      where.items = { some: { OR: supplierMatchOr(filter.supplierId) } };
    }
    {
      // TR takvim günü: başlangıç dahil, bitiş günü de DAHİL (yarı-açık üst sınır).
      const range = trDateRange(filter.from, filter.to);
      if (range) where.createdAt = range;
    }

    const orders = await this.prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50_000,
      select: {
        id: true,
        status: true,
        humanOrderNo: true,
        marketplace: true,
        supplierOrderNo: true,
        cargoCompany: true,
        cargoBarcode: true,
        createdAt: true,
        // Bayi adı YERİNE bayi kodu (BAYI-XXXXXX) — bu Excel tedarikçiye gider,
        // bayi kimliği isimle değil kodla paylaşılır.
        customer: { select: { bayiNo: true } },
        items: {
          select: {
            // Tedarikçinin sevkiyat için ihtiyaç duyduğu kalem bilgisi:
            // ürün adı + adet + tedarikçi stok kodu (SKU) + barkod.
            productName: true,
            qty: true,
            // SKU/barkod snapshot'ları (sipariş anındaki ham değerler) —
            // auto-route override'ı varsa hedef tedarikçinin SKU/barkodu önceli.
            supplierSku: true,
            supplierBarcode: true,
            supplierSkuOverride: true,
            supplierBarcodeOverride: true,
            // Çözümleme önceliği: override → snapshot → product.supplierId.
            supplierIdOverride: true,
            supplierIdSnapshot: true,
            supplierNameSnapshot: true,
            supplierOverride: { select: { name: true } },
            product: {
              select: {
                externalCode: true,
                barcode: true,
                supplierId: true,
                supplier: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    // ── Kalem satırlarını çöz (tedarikçi sevkiyat görünümü) ────────────────
    // Her ürün KALEMİ kendi satırı olur. Tedarikçi filtresi seçiliyse yalnızca
    // o tedarikçiye ait kalemler satıra dönüşür — karışık siparişte başka
    // tedarikçilerin ürünleri o tedarikçiye SIZDIRILMAZ.
    // Fiyat / maliyet / kâr HESAPLANMAZ — bu döküm tedarikçiye gider.
    const filterSupplierId = filter.supplierId?.trim() || null;
    const itemRows = orders.flatMap((o) => {
      const out: Array<{
        order: (typeof orders)[number];
        sku: string;
        barcode: string;
        productName: string;
        qty: number;
        supplierName: string;
      }> = [];
      for (const it of o.items) {
        // Tedarikçi kimliği + adı TEK çözümlemeyle (resolveSupplier) — yukarıdaki
        // WHERE filtresiyle (supplierMatchOr) birebir aynı öncelik.
        const resolved = resolveSupplier(it, '');
        if (filterSupplierId && resolved.id !== filterSupplierId) continue;
        out.push({
          order: o,
          // SKU/barkod: override (auto-route hedefi) → snapshot → canlı ürün.
          sku:
            it.supplierSkuOverride ??
            it.supplierSku ??
            it.product?.externalCode ??
            '',
          barcode:
            it.supplierBarcodeOverride ??
            it.supplierBarcode ??
            it.product?.barcode ??
            '',
          productName: it.productName,
          qty: it.qty,
          supplierName: resolved.name,
        });
      }
      return out;
    });
    const distinctOrderCount = new Set(itemRows.map((r) => r.order.id)).size;

    // Filtre seçili tedarikçinin adını başlık bandında göstermek için (varsa).
    let filterSupplierName: string | null = null;
    if (filterSupplierId) {
      const sup = await this.prisma.supplier.findFirst({
        where: { id: filterSupplierId, tenantId },
        select: { name: true },
      });
      filterSupplierName = sup?.name ?? null;
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Toptan Budur';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('Sipariş Dökümü', {
      views: [{ state: 'frozen', ySplit: 5 }],
      properties: { defaultRowHeight: 18 },
    });

    // Tedarikçi sevkiyat görünümü — her ÜRÜN KALEMİ tek satır. Bu Excel
    // TEDARİKÇİYE gönderilir; bu yüzden hiçbir fiyat / maliyet / kâr / marj
    // kolonu YOKTUR ve bayi adı yerine yalnızca bayi kodu (BAYI-XXXXXX)
    // paylaşılır. Tedarikçinin sevk için ihtiyaç duyduğu Stok Kodu (SKU),
    // Barkod, Ürün Adı ve Adet kolonları zorunludur.
    sheet.columns = [
      { key: 'sira', width: 6 },
      { key: 'humanOrderNo', width: 16 },
      { key: 'createdAt', width: 18 },
      { key: 'status', width: 14 },
      { key: 'bayiId', width: 14 },
      { key: 'marketplace', width: 12 },
      { key: 'sku', width: 22 },
      { key: 'barcode', width: 20 },
      { key: 'productName', width: 42 },
      { key: 'qty', width: 7 },
      { key: 'supplier', width: 24 },
      { key: 'supplierOrderNo', width: 20 },
      { key: 'cargoCompany', width: 16 },
      { key: 'cargoBarcode', width: 22 },
    ];
    const COL_COUNT = 14;
    const LAST_COL = 'N';

    // ── Başlık bandı ───────────────────────────────────────────────────────
    sheet.mergeCells(`A1:${LAST_COL}1`);
    const titleCell = sheet.getCell('A1');
    titleCell.value = 'Toptan Budur — Sipariş Dökümü (Cari Hesap)';
    titleCell.font = {
      name: 'Calibri',
      size: 18,
      bold: true,
      color: { argb: 'FFFFFFFF' },
    };
    titleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    titleCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1267F4' },
    };
    sheet.getRow(1).height = 34;

    sheet.mergeCells(`A2:${LAST_COL}2`);
    const subtitleCell = sheet.getCell('A2');
    subtitleCell.value = buildOrdersSubtitle(
      filter,
      distinctOrderCount,
      itemRows.length,
      filterSupplierName,
    );
    subtitleCell.font = {
      name: 'Calibri',
      size: 11,
      color: { argb: 'FFFFFFFF' },
    };
    subtitleCell.alignment = {
      vertical: 'middle',
      horizontal: 'left',
      indent: 1,
    };
    subtitleCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0B3FA3' },
    };
    sheet.getRow(2).height = 22;

    sheet.getRow(3).height = 6;

    // ── Özet satırı ────────────────────────────────────────────────────────
    sheet.mergeCells(`A4:${LAST_COL}4`);
    sheet.getCell('A4').value =
      `${distinctOrderCount} sipariş • ${itemRows.length} kalem`;
    sheet.getCell('A4').font = {
      bold: true,
      size: 11,
      color: { argb: 'FF0B3FA3' },
    };
    sheet.getCell('A4').alignment = { vertical: 'middle', indent: 1 };
    sheet.getRow(4).height = 22;

    // ── Başlık satırı (row 5, dondurulmuş) ─────────────────────────────────
    const headers = [
      'Sıra',
      'Sipariş No',
      'Sipariş Tarihi',
      'Durum',
      'Bayi ID',
      'Satış Kanalı',
      'Stok Kodu (SKU)',
      'Barkod',
      'Ürün Adı',
      'Adet',
      'Tedarikçi',
      'Tedarikçi Sipariş No',
      'Kargo Firması',
      'Kargo Barkodu',
    ];
    const headerRow = sheet.getRow(5);
    headers.forEach((h, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = h;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.alignment = {
        vertical: 'middle',
        horizontal: 'center',
        wrapText: true,
      };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF0F172A' },
      };
      cell.border = thinBorder('FF1E293B');
    });
    headerRow.height = 26;

    // ── Veri satırları (her ürün kalemi bir satır) ─────────────────────────
    // Zebra deseni SİPARİŞ bazında değişir; aynı siparişin çoklu kalemleri
    // görsel olarak gruplanır (kalemler sipariş bazında ardışıktır).
    let groupToggle = false;
    let prevOrderId: string | null = null;
    itemRows.forEach((r, idx) => {
      const o = r.order;
      if (o.id !== prevOrderId) {
        groupToggle = !groupToggle;
        prevOrderId = o.id;
      }
      const row = sheet.addRow({
        sira: idx + 1,
        humanOrderNo: o.humanOrderNo ?? '—',
        createdAt: o.createdAt,
        status: ADMIN_STATUS_LABEL[o.status] ?? o.status,
        bayiId: o.customer?.bayiNo ?? '—',
        marketplace: o.marketplace
          ? (MARKETPLACE_LABELS[o.marketplace] ?? o.marketplace)
          : '—',
        sku: r.sku || '—',
        barcode: r.barcode || '—',
        productName: r.productName || '—',
        qty: r.qty,
        supplier: r.supplierName || '—',
        supplierOrderNo: o.supplierOrderNo ?? '—',
        cargoCompany: o.cargoCompany
          ? (CARGO_LABELS[o.cargoCompany.toLowerCase()] ?? o.cargoCompany)
          : '—',
        cargoBarcode: o.cargoBarcode ?? '—',
      });

      const zebra = groupToggle;
      for (let col = 1; col <= COL_COUNT; col++) {
        const cell = row.getCell(col);
        cell.border = thinBorder('FFE2E8F0');
        cell.alignment = { vertical: 'middle', wrapText: true };
        if (zebra) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF8FAFC' },
          };
        }
      }

      row.getCell('sira').alignment = {
        vertical: 'middle',
        horizontal: 'center',
      };
      row.getCell('createdAt').numFmt = 'dd.mm.yyyy hh:mm';
      row.getCell('createdAt').alignment = {
        vertical: 'middle',
        horizontal: 'left',
      };
      row.getCell('humanOrderNo').font = {
        bold: true,
        color: { argb: 'FF0F172A' },
      };
      row.getCell('bayiId').font = {
        bold: true,
        color: { argb: 'FF0F172A' },
      };
      row.getCell('bayiId').alignment = {
        vertical: 'middle',
        horizontal: 'center',
      };
      // Stok Kodu (SKU) — tedarikçi için en kritik alan; vurgulanır.
      row.getCell('sku').font = { bold: true, color: { argb: 'FF0F172A' } };
      row.getCell('sku').alignment = {
        vertical: 'middle',
        horizontal: 'center',
      };
      row.getCell('barcode').alignment = {
        vertical: 'middle',
        horizontal: 'center',
      };
      // Adet — sevkiyat için kritik; kalın + ortalanmış.
      row.getCell('qty').font = { bold: true, color: { argb: 'FF0F172A' } };
      row.getCell('qty').alignment = {
        vertical: 'middle',
        horizontal: 'center',
      };
      row.getCell('supplierOrderNo').alignment = {
        vertical: 'middle',
        horizontal: 'center',
      };
      row.getCell('cargoBarcode').alignment = {
        vertical: 'middle',
        horizontal: 'center',
      };

      // Durum çipi
      const statusColor = statusFill(o.status);
      const statusCell = row.getCell('status');
      statusCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: statusColor.bg },
      };
      statusCell.font = {
        bold: true,
        color: { argb: statusColor.fg },
        size: 10,
      };
      statusCell.alignment = { vertical: 'middle', horizontal: 'center' };

      row.height = 22;
    });

    // ── Boş durum satırı ───────────────────────────────────────────────────
    if (itemRows.length === 0) {
      const emptyRow = sheet.addRow({});
      sheet.mergeCells(`A${emptyRow.number}:${LAST_COL}${emptyRow.number}`);
      const cell = sheet.getCell(`A${emptyRow.number}`);
      cell.value = 'Seçili filtrelerle eşleşen sipariş bulunamadı.';
      cell.font = { italic: true, color: { argb: 'FF64748B' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      emptyRow.height = 40;
    }

    sheet.autoFilter = {
      from: { row: 5, column: 1 },
      to: { row: 5, column: COL_COUNT },
    };

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const filename = `siparis-dokumu-${trTodayKey()}.xlsx`;

    void this.audit.log({
      actorType: 'admin',
      actorId: actor.id,
      tenantId,
      action: 'EXPORT',
      target: 'orders',
      metadata: {
        kind: 'orders',
        count: distinctOrderCount,
        lineCount: itemRows.length,
        filter,
        actorEmail: actor.email ?? null,
      },
    });

    return { buffer, filename, count: distinctOrderCount };
  }

  /**
   * AuditLog export — multi-tenant audit kayıtları Excel'e döker. Tenant'a
   * bağlı veya tenant=null public kayıtlar (login denemeleri vb.) dahildir.
   * Aktör adı/e-postası actorType'a göre User veya Customer tablosundan
   * hidrate edilir; metadata içindeki ip/userAgent/deviceType/statusCode/
   * durationMs gibi alanlar üst seviye sütun olarak yer alır.
   */
  async exportAuditLogs(
    tenantId: string,
    filter: AuditExportFilter,
    actor: { id: string; email?: string | null },
  ): Promise<{ buffer: Buffer; filename: string }> {
    // tenant OR ile q OR aynı `OR` anahtarında çakışmasın diye AND listesine
    // ayrı koşullar olarak ekliyoruz.
    const andConditions: Prisma.AuditLogWhereInput[] = [
      { OR: [{ tenantId }, { tenantId: null }] },
    ];
    const where: Prisma.AuditLogWhereInput = { AND: andConditions };

    if (filter.actorId) where.actorId = filter.actorId;
    if (filter.action)
      where.action = { contains: filter.action, mode: 'insensitive' };
    // audience → actorType eşlemesi: 'customer' tam eşleşir, 'admin' ise
    // customer DIŞINDAKİ tüm aktörleri (user/system vb.) kapsar (#10).
    if (filter.audience === 'customer') {
      where.actorType = 'customer';
    } else if (filter.audience === 'admin') {
      where.actorType = { not: 'customer' };
    }
    // q: action veya target üzerinde insensitive contains.
    const qTerm = filter.q?.trim();
    if (qTerm && qTerm.length > 0) {
      andConditions.push({
        OR: [
          { action: { contains: qTerm, mode: 'insensitive' } },
          { target: { contains: qTerm, mode: 'insensitive' } },
        ],
      });
    }
    {
      const range = trDateRange(filter.from, filter.to);
      if (range) where.createdAt = range;
    }

    const items = await this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50_000,
    });

    const adminActorIds = Array.from(
      new Set(
        items
          .filter((i) => i.actorType !== 'customer')
          .map((i) => i.actorId)
          .filter((v): v is string => !!v),
      ),
    );
    const customerActorIds = Array.from(
      new Set(
        items
          .filter((i) => i.actorType === 'customer')
          .map((i) => i.actorId)
          .filter((v): v is string => !!v),
      ),
    );
    const [users, customers] = await Promise.all([
      adminActorIds.length
        ? this.prisma.user.findMany({
            where: { id: { in: adminActorIds } },
            select: { id: true, email: true, name: true },
          })
        : Promise.resolve([]),
      customerActorIds.length
        ? this.prisma.customer.findMany({
            where: { id: { in: customerActorIds } },
            select: { id: true, email: true, name: true },
          })
        : Promise.resolve([]),
    ]);
    const userMap = new Map(users.map((u) => [u.id, u]));
    const customerMap = new Map(customers.map((c) => [c.id, c]));

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Toptan Budur';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('Loglar');
    sheet.columns = [
      { header: 'Zaman', key: 'createdAt', width: 22 },
      { header: 'Aktör Tipi', key: 'actorType', width: 12 },
      { header: 'Aktör Adı', key: 'actorName', width: 24 },
      { header: 'Aktör E-posta', key: 'actorEmail', width: 28 },
      { header: 'Aktör ID', key: 'actorId', width: 30 },
      { header: 'Aksiyon', key: 'action', width: 28 },
      { header: 'Hedef', key: 'target', width: 30 },
      { header: 'HTTP Metod', key: 'method', width: 10 },
      { header: 'Yol (Path)', key: 'path', width: 36 },
      { header: 'Durum Kodu', key: 'statusCode', width: 10 },
      { header: 'Süre (ms)', key: 'durationMs', width: 10 },
      { header: 'IP', key: 'ip', width: 18 },
      { header: 'Cihaz Türü', key: 'deviceType', width: 14 },
      { header: 'User Agent', key: 'userAgent', width: 60 },
      { header: 'Tenant', key: 'tenantId', width: 30 },
      { header: 'Metadata (JSON)', key: 'metadataJson', width: 60 },
    ];
    sheet.getRow(1).font = { bold: true };

    for (const it of items) {
      const meta =
        it.metadata && typeof it.metadata === 'object'
          ? (it.metadata as Record<string, unknown>)
          : {};
      const lookupRow = it.actorId
        ? it.actorType === 'customer'
          ? (customerMap.get(it.actorId) ?? null)
          : (userMap.get(it.actorId) ?? null)
        : null;
      sheet.addRow({
        createdAt: it.createdAt.toISOString(),
        actorType: it.actorType,
        actorName:
          lookupRow?.name ?? (meta.actorName as string | undefined) ?? '',
        actorEmail:
          lookupRow?.email ?? (meta.email as string | undefined) ?? '',
        actorId: it.actorId ?? '',
        action: it.action,
        target: it.target ?? '',
        method: (meta.method as string | undefined) ?? '',
        path: (meta.path as string | undefined) ?? '',
        statusCode: (meta.statusCode as number | undefined) ?? '',
        durationMs: (meta.durationMs as number | undefined) ?? '',
        ip: (meta.ip as string | undefined) ?? '',
        deviceType: (meta.deviceType as string | undefined) ?? '',
        userAgent: (meta.userAgent as string | undefined) ?? '',
        tenantId: it.tenantId ?? '',
        metadataJson: it.metadata ? JSON.stringify(it.metadata) : '',
      });
    }

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const filename = `loglar-${trTodayKey()}.xlsx`;

    void this.audit.log({
      actorType: 'admin',
      actorId: actor.id,
      tenantId,
      action: 'AUDIT_LOG_EXPORTED',
      target: 'audit-logs',
      metadata: {
        kind: 'audit-logs',
        count: items.length,
        filter,
        actorEmail: actor.email ?? null,
      },
    });

    return { buffer, filename };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Müşteri dışa aktarımları (bayi kazanımı / pazarlama)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Tüm müşterileri sipariş metrikleriyle birleştirir. Sorgular groupBy/indexli
   * olduğundan admin-tetikli export için elverişlidir (hot-path değildir).
   */
  private async gatherCustomerMetrics(
    tenantId: string,
  ): Promise<EnrichedCustomer[]> {
    const EXPORT_ROW_CAP = 50_000;

    const customers = await this.prisma.customer.findMany({
      orderBy: { createdAt: 'desc' },
      take: EXPORT_ROW_CAP,
      select: {
        id: true,
        bayiNo: true,
        name: true,
        email: true,
        phone: true,
        companyTitle: true,
        contactName: true,
        contactPhone: true,
        contactEmail: true,
        vergiNo: true,
        vergiDairesi: true,
        isActive: true,
        mustChangePassword: true,
        createdAt: true,
        cariBalance: true,
        profitDiscountPercent: true,
        customerStatus: true,
      },
    });

    const [orderStats, spentStats] = await Promise.all([
      // Gerçek sipariş adedi + son sipariş: tamamlanmamış kart denemeleri
      // (awaiting_payment ve paidAt=null iptaller) hariç.
      this.prisma.order.groupBy({
        by: ['customerId'],
        where: {
          tenantId,
          status: { not: 'awaiting_payment' },
          NOT: { status: 'cancelled', paidAt: null },
        },
        _count: { id: true },
        _max: { createdAt: true },
      }),
      // Toplam harcama (iptal/iade hariç brüt).
      this.prisma.order.groupBy({
        by: ['customerId'],
        where: {
          tenantId,
          status: { notIn: ['cancelled', 'refunded', 'awaiting_payment'] },
        },
        _sum: { total: true },
      }),
    ]);

    const ordersCountMap = new Map<string, number>();
    const lastOrderMap = new Map<string, Date | null>();
    for (const r of orderStats) {
      if (!r.customerId) continue;
      ordersCountMap.set(r.customerId, r._count.id);
      lastOrderMap.set(r.customerId, r._max.createdAt ?? null);
    }
    const spentMap = new Map<string, number>();
    for (const r of spentStats) {
      if (!r.customerId) continue;
      spentMap.set(r.customerId, Number(r._sum.total ?? 0));
    }

    return customers.map((c) => {
      return {
        id: c.id,
        bayiNo: c.bayiNo,
        name: c.name,
        email: c.email,
        phone: c.phone,
        companyTitle: c.companyTitle,
        contactName: c.contactName,
        contactPhone: c.contactPhone,
        contactEmail: c.contactEmail,
        vergiNo: c.vergiNo,
        vergiDairesi: c.vergiDairesi,
        isActive: c.isActive,
        mustChangePassword: c.mustChangePassword,
        createdAt: c.createdAt,
        cariBalance: Number(c.cariBalance),
        profitDiscountPercent: c.profitDiscountPercent,
        adminDiscount: c.customerStatus === 'ADMIN_DISCOUNT',
        ordersCount: ordersCountMap.get(c.id) ?? 0,
        totalSpent: spentMap.get(c.id) ?? 0,
        lastOrderAt: lastOrderMap.get(c.id) ?? null,
      };
    });
  }

  /**
   * Detaylı müşteri Excel'i — bayi kazanımı / yeniden pazarlama için segment
   * sekmeleri: Özet, Tüm Müşteriler, Sipariş Vermeyen, Uyuyan,
   * Pasif/Onay Bekleyen. Her sekmede tam iletişim (ad, bayi ID, e-posta,
   * telefon) + sipariş verisi bulunur.
   */
  async exportCustomers(
    tenantId: string,
    actor: { id: string; email?: string | null },
  ): Promise<{ buffer: Buffer; filename: string; count: number }> {
    const records = await this.gatherCustomerMetrics(tenantId);
    const now = new Date();
    const stamp = formatDateTR(now);

    const neverOrdered = records.filter((r) => r.ordersCount === 0);
    const dormant = records.filter(
      (r) =>
        r.isActive &&
        r.ordersCount > 0 &&
        daysSince(now, latestActivity(r)) > 45,
    );
    const inactive = records.filter((r) => !r.isActive);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Toptan Budur';
    workbook.created = new Date();

    this.renderBandedTable(workbook.addWorksheet('Özet'), {
      title: 'Toptan Budur — Müşteri Analizi (Bayi Kazanımı)',
      subtitle: `Oluşturma: ${stamp}   •   Toplam ${records.length} bayi`,
      summary: 'Pazarlama / yeniden mesajlaşma için segment özetleri',
      columns: [
        { header: 'Segment', key: 'segment', width: 34 },
        { header: 'Bayi Sayısı', key: 'count', width: 14 },
        { header: 'Açıklama', key: 'desc', width: 72 },
      ],
      rows: [
        {
          segment: 'Tüm Müşteriler',
          count: records.length,
          desc: 'Sistemdeki tüm kayıtlı bayiler',
        },
        {
          segment: 'Sipariş Vermeyen Bayiler',
          count: neverOrdered.length,
          desc: 'Hiç gerçek sipariş vermemiş bayiler — aktivasyon hedefi',
        },
        {
          segment: 'Uyuyan Bayiler',
          count: dormant.length,
          desc: 'Aktif ama 45+ gündür sipariş hareketi olmayan bayiler',
        },
        {
          segment: 'Pasif / Onay Bekleyen',
          count: inactive.length,
          desc: 'isActive=false — pasifleştirilmiş veya onay bekleyen bayiler',
        },
      ],
    });

    const addSheet = (
      name: string,
      subtitle: string,
      rows: EnrichedCustomer[],
    ): void => {
      this.renderBandedTable(workbook.addWorksheet(name), {
        title: `Toptan Budur — ${name}`,
        subtitle: `${subtitle}   •   Oluşturma: ${stamp}`,
        summary: `${rows.length} bayi`,
        columns: CUSTOMER_COLUMNS,
        rows: rows.map(customerRow),
        emptyText: 'Bu segmentte bayi yok.',
      });
    };

    addSheet(
      'Tüm Müşteriler',
      'Tüm bayiler — tam iletişim ve kullanım verisi',
      records,
    );
    addSheet(
      'Sipariş Vermeyen Bayiler',
      'Hiç gerçek sipariş vermemiş bayiler',
      neverOrdered,
    );
    addSheet(
      'Uyuyan Bayiler',
      'Aktif ama 45+ gündür hareketsiz bayiler',
      dormant,
    );
    addSheet(
      'Pasif - Onay Bekleyen',
      'Pasif veya onay bekleyen bayiler',
      inactive,
    );

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const filename = `musteri-analizi-${trTodayKey()}.xlsx`;

    void this.audit.log({
      actorType: 'admin',
      actorId: actor.id,
      tenantId,
      action: 'EXPORT',
      target: 'customers',
      metadata: {
        kind: 'customers',
        count: records.length,
        segments: {
          neverOrdered: neverOrdered.length,
          dormant: dormant.length,
          inactive: inactive.length,
        },
        actorEmail: actor.email ?? null,
      },
    });

    return { buffer, filename, count: records.length };
  }

  /**
   * Ortak bantlı tablo renderer'ı: başlık + alt başlık + özet bandı, dondurulmuş
   * başlık satırı (row 5), zebra + kenarlıklı veri satırları, autofilter ve boş
   * durum. Sütun anahtarları addRow objesinin anahtarlarıyla eşleşir.
   */
  private renderBandedTable(
    sheet: ExcelJS.Worksheet,
    cfg: {
      title: string;
      subtitle: string;
      summary: string;
      columns: BandedColumn[];
      rows: Array<Record<string, ExcelJS.CellValue>>;
      emptyText?: string;
    },
  ): void {
    const colCount = cfg.columns.length;
    const lastCol = columnLetter(colCount);

    sheet.columns = cfg.columns.map((c) => ({
      key: c.key,
      width: c.width,
      style: c.numFmt ? { numFmt: c.numFmt } : {},
    }));

    // Başlık bandı
    sheet.mergeCells(`A1:${lastCol}1`);
    const titleCell = sheet.getCell('A1');
    titleCell.value = cfg.title;
    titleCell.font = {
      name: 'Calibri',
      size: 16,
      bold: true,
      color: { argb: 'FFFFFFFF' },
    };
    titleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    titleCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1267F4' },
    };
    sheet.getRow(1).height = 30;

    sheet.mergeCells(`A2:${lastCol}2`);
    const subtitleCell = sheet.getCell('A2');
    subtitleCell.value = cfg.subtitle;
    subtitleCell.font = {
      name: 'Calibri',
      size: 10.5,
      color: { argb: 'FFFFFFFF' },
    };
    subtitleCell.alignment = {
      vertical: 'middle',
      horizontal: 'left',
      indent: 1,
    };
    subtitleCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0B3FA3' },
    };
    sheet.getRow(2).height = 20;

    sheet.getRow(3).height = 6;

    sheet.mergeCells(`A4:${lastCol}4`);
    const summaryCell = sheet.getCell('A4');
    summaryCell.value = cfg.summary;
    summaryCell.font = { bold: true, size: 11, color: { argb: 'FF0B3FA3' } };
    summaryCell.alignment = { vertical: 'middle', indent: 1 };
    sheet.getRow(4).height = 20;

    // Başlık satırı (row 5, dondurulmuş)
    const headerRow = sheet.getRow(5);
    cfg.columns.forEach((c, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = c.header;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10.5 };
      cell.alignment = {
        vertical: 'middle',
        horizontal: 'center',
        wrapText: true,
      };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF0F172A' },
      };
      cell.border = thinBorder('FF1E293B');
    });
    headerRow.height = 26;
    sheet.views = [{ state: 'frozen', ySplit: 5 }];

    cfg.rows.forEach((r, idx) => {
      const row = sheet.addRow(r);
      const zebra = idx % 2 === 1;
      for (let col = 1; col <= colCount; col++) {
        const cell = row.getCell(col);
        cell.border = thinBorder('FFE2E8F0');
        cell.alignment = { vertical: 'middle' };
        if (zebra) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF8FAFC' },
          };
        }
      }
      row.height = 18;
    });

    if (cfg.rows.length === 0) {
      const emptyRow = sheet.addRow({});
      sheet.mergeCells(`A${emptyRow.number}:${lastCol}${emptyRow.number}`);
      const cell = sheet.getCell(`A${emptyRow.number}`);
      cell.value = cfg.emptyText ?? 'Kayıt yok.';
      cell.font = { italic: true, color: { argb: 'FF64748B' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      emptyRow.height = 30;
    }

    sheet.autoFilter = {
      from: { row: 5, column: 1 },
      to: { row: 5, column: colCount },
    };
  }
}

// ─── Excel yardımcıları (sipariş dökümü / cari hesap görünümü) ──────────────

const ADMIN_STATUS_LABEL: Record<string, string> = {
  paid: 'Ödendi',
  preparing: 'Hazırlanıyor',
  processing: 'İşleniyor',
  shipped: 'Kargoya Verildi',
  delivered: 'Teslim Edildi',
  cancelled: 'İptal Edildi',
  returned: 'İade Edildi',
  refunded: 'İade Edildi',
};

const MARKETPLACE_LABELS: Record<string, string> = {
  self: 'Kendim İçin',
  other: 'Diğer Satış Kanalı',
};

function thinBorder(color: string): ExcelJS.Borders {
  const side: Partial<ExcelJS.Border> = {
    style: 'thin',
    color: { argb: color },
  };
  return {
    top: side,
    left: side,
    bottom: side,
    right: side,
    diagonal: side,
  } as ExcelJS.Borders;
}

function statusFill(status: string): { bg: string; fg: string } {
  switch (status) {
    case 'shipped':
    case 'delivered':
      return { bg: 'FFDCFCE7', fg: 'FF14532D' };
    case 'refunded':
    case 'returned':
      return { bg: 'FFE0E7FF', fg: 'FF312E81' };
    case 'paid':
    case 'preparing':
    case 'processing':
      return { bg: 'FFFEF3C7', fg: 'FF78350F' };
    case 'cancelled':
      return { bg: 'FFFEE2E2', fg: 'FF7F1D1D' };
    default:
      return { bg: 'FFF1F5F9', fg: 'FF0F172A' };
  }
}

/**
 * Kargo firması kodlarının Türkçe etiketleri. Order.cargoCompany lowercase
 * kod tutar; etiket bulunamazsa ham değer gösterilir.
 */
const CARGO_LABELS: Record<string, string> = {
  aras: 'Aras Kargo',
  surat: 'Sürat Kargo',
  ptt: 'PTT Kargo',
  dhl: 'DHL',
  mng: 'MNG Kargo',
  yurtici: 'Yurtiçi Kargo',
  ups: 'UPS',
  fedex: 'FedEx',
  sendeo: 'Sendeo',
  hepsijet: 'HepsiJET',
  trendyol: 'Trendyol Express',
};

function formatDateTR(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function buildOrdersSubtitle(
  filter: OrdersExportFilter,
  orderCount: number,
  lineCount: number,
  supplierName: string | null,
): string {
  const parts: string[] = [`Oluşturma: ${formatDateTR(new Date())}`];
  if (filter.from || filter.to) {
    parts.push(`Tarih: ${filter.from ?? '...'} → ${filter.to ?? '...'}`);
  }
  if (filter.status) {
    parts.push(`Durum: ${ADMIN_STATUS_LABEL[filter.status] ?? filter.status}`);
  }
  if (supplierName) {
    parts.push(`Tedarikçi: "${supplierName}"`);
  }
  if (filter.customer && filter.customer.trim()) {
    parts.push(`Bayi: "${filter.customer.trim()}"`);
  }
  parts.push(`${orderCount} sipariş • ${lineCount} kalem`);
  return parts.join('   •   ');
}

// ─── Müşteri export yardımcıları ────────────────────────────────────────────

/** gatherCustomerMetrics çıktısı — bir bayinin sipariş profili. */
interface EnrichedCustomer {
  id: string;
  bayiNo: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  companyTitle: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  vergiNo: string | null;
  vergiDairesi: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  createdAt: Date;
  cariBalance: number;
  profitDiscountPercent: number;
  adminDiscount: boolean;
  ordersCount: number;
  totalSpent: number;
  lastOrderAt: Date | null;
}

interface BandedColumn {
  header: string;
  key: string;
  width: number;
  numFmt?: string;
}

const MONEY_FMT = '#,##0.00';
const DATE_FMT = 'dd.mm.yyyy';
const DATETIME_FMT = 'dd.mm.yyyy hh:mm';

const CUSTOMER_COLUMNS: BandedColumn[] = [
  { header: 'Bayi ID', key: 'bayiNo', width: 16 },
  { header: 'Müşteri Adı', key: 'name', width: 28 },
  { header: 'Firma Ünvanı', key: 'companyTitle', width: 26 },
  { header: 'E-posta', key: 'email', width: 30 },
  { header: 'Telefon', key: 'phone', width: 16 },
  { header: 'Yetkili Kişi', key: 'contactName', width: 20 },
  { header: 'Yetkili Telefon', key: 'contactPhone', width: 16 },
  { header: 'Yetkili E-posta', key: 'contactEmail', width: 26 },
  { header: 'Vergi No', key: 'vergiNo', width: 15 },
  { header: 'Vergi Dairesi', key: 'vergiDairesi', width: 18 },
  { header: 'Durum', key: 'durum', width: 13 },
  { header: 'Kayıt Tarihi', key: 'createdAt', width: 16, numFmt: DATE_FMT },
  { header: 'Sipariş Sayısı', key: 'ordersCount', width: 12 },
  { header: 'Toplam Harcama (₺)', key: 'totalSpent', width: 16, numFmt: MONEY_FMT },
  { header: 'Son Sipariş', key: 'lastOrderAt', width: 16, numFmt: DATE_FMT },
  { header: 'Cari Bakiye (₺)', key: 'cariBalance', width: 14, numFmt: MONEY_FMT },
  { header: 'Kâr İnd. %', key: 'profitDiscount', width: 10 },
  { header: 'Admin İnd.', key: 'adminDiscount', width: 10 },
];

/** 1→A, 26→Z, 27→AA. ExcelJS mergeCells adres üretimi için. */
function columnLetter(n: number): string {
  let s = '';
  let x = n;
  while (x > 0) {
    const rem = (x - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

function customerStatusLabel(r: EnrichedCustomer): string {
  if (!r.isActive) return r.mustChangePassword ? 'Onay Bekliyor' : 'Pasif';
  return 'Aktif';
}

/** Bir bayinin en son hareketi (sipariş bazlı). */
function latestActivity(r: EnrichedCustomer): Date | null {
  return r.lastOrderAt ?? null;
}

/** now ile then arasındaki tam gün sayısı; then null ise +Infinity. */
function daysSince(now: Date, then: Date | null): number {
  if (!then) return Number.POSITIVE_INFINITY;
  return Math.floor((now.getTime() - then.getTime()) / 86_400_000);
}

function customerRow(r: EnrichedCustomer): Record<string, ExcelJS.CellValue> {
  return {
    bayiNo: r.bayiNo ?? '—',
    name: r.name || '—',
    companyTitle: r.companyTitle ?? '',
    email: r.email ?? '',
    phone: r.phone ?? '',
    contactName: r.contactName ?? '',
    contactPhone: r.contactPhone ?? '',
    contactEmail: r.contactEmail ?? '',
    vergiNo: r.vergiNo ?? '',
    vergiDairesi: r.vergiDairesi ?? '',
    durum: customerStatusLabel(r),
    createdAt: r.createdAt ?? '',
    ordersCount: r.ordersCount,
    totalSpent: r.totalSpent,
    lastOrderAt: r.lastOrderAt ?? '',
    cariBalance: r.cariBalance,
    profitDiscount: r.profitDiscountPercent,
    adminDiscount: r.adminDiscount ? 'Evet' : 'Hayır',
  };
}

