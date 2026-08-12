import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AdminMuhasebeService } from '../admin/muhasebe/admin-muhasebe.service';
import { ReceiptsService } from '../receipts/receipts.service';
import { trDayStart, trDayEndExclusive } from '../common/utils/tr-time';

/**
 * Dış Finans API — Muhasebe bölümü projeksiyonu. Admin panelindeki Muhasebe
 * sayfalarının (Cari Hareketler / Tedarikçi Hesabı / Bayi Hesabı) verisini
 * AdminMuhasebeService'ten (TEK doğru kaynak) birebir servis eder. Tek fark:
 * ortakların önce id keşfedebilmesi için sayfalanmış TAM tedarikçi/bayi listesi
 * uçları (arama ucu 20 ile sınırlı olduğundan).
 */

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 50;

function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  const n = Number(v as number);
  if (Number.isFinite(n)) return n;
  const p = parseFloat(String(v));
  return Number.isFinite(p) ? p : 0;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

@Injectable()
export class PartnerAccountingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly muhasebe: AdminMuhasebeService,
    private readonly receipts: ReceiptsService,
  ) {}

  private clampPage(raw: unknown): number {
    const n = parseInt(String(raw ?? ''), 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  private clampPageSize(raw: unknown): number {
    const n = parseInt(String(raw ?? ''), 10);
    if (!Number.isFinite(n)) return DEFAULT_PAGE_SIZE;
    return Math.min(MAX_PAGE_SIZE, Math.max(1, n));
  }

  // ── Tam listeler (id keşfi) ──────────────────────────────────────────────

  /** Sayfalanmış tedarikçi listesi (id + ad). */
  async listSuppliers(
    tenantId: string,
    q?: string,
    pageRaw?: unknown,
    pageSizeRaw?: unknown,
  ) {
    const page = this.clampPage(pageRaw);
    const pageSize = this.clampPageSize(pageSizeRaw);
    const term = (q ?? '').trim();
    const where = {
      tenantId,
      ...(term ? { name: { contains: term, mode: 'insensitive' as const } } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.supplier.count({ where }),
      this.prisma.supplier.findMany({
        where,
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, page, pageSize, tedarikciler: rows };
  }

  /** Sayfalanmış bayi/müşteri listesi (id + künye + cari bakiye). */
  async listCustomers(q?: string, pageRaw?: unknown, pageSizeRaw?: unknown) {
    const page = this.clampPage(pageRaw);
    const pageSize = this.clampPageSize(pageSizeRaw);
    const term = (q ?? '').trim();
    // NOT: Customer tenant'a bağlı DEĞİL (global) — searchCustomers ile birebir.
    const where = term
      ? {
          OR: [
            { name: { contains: term, mode: 'insensitive' as const } },
            { companyTitle: { contains: term, mode: 'insensitive' as const } },
            { email: { contains: term, mode: 'insensitive' as const } },
            { bayiNo: { contains: term, mode: 'insensitive' as const } },
          ],
        }
      : {};
    const [total, rows] = await Promise.all([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({
        where,
        select: {
          id: true,
          name: true,
          companyTitle: true,
          email: true,
          bayiNo: true,
          cariBalance: true,
        },
        orderBy: { name: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      total,
      page,
      pageSize,
      bayiler: rows.map((c) => ({
        id: c.id,
        ad: c.name,
        unvan: c.companyTitle,
        eposta: c.email,
        bayiNo: c.bayiNo,
        cariBakiye: round2(num(c.cariBalance)),
      })),
    };
  }

  // ── Cari hareketler / hesap raporları (AdminMuhasebeService'e delege) ──────

  /** Birleşik cari hareket dökümü (tedarikçi VEYA bayi). */
  ledger(
    tenantId: string,
    typeRaw: string | undefined,
    id: string | undefined,
    opts: { from?: string; to?: string; page?: unknown; pageSize?: unknown },
  ) {
    if (!id || !id.trim()) {
      throw new BadRequestException('id zorunlu (tedarikçi ya da bayi id).');
    }
    const type = typeRaw === 'dealer' ? 'dealer' : 'supplier';
    return this.muhasebe.getLedger(tenantId, type, id.trim(), {
      from: opts.from,
      to: opts.to,
      page: this.clampPage(opts.page),
      pageSize: this.clampPageSize(opts.pageSize),
    });
  }

  /** Tedarikçi hesabı raporu. */
  supplierAccount(
    tenantId: string,
    supplierId: string | undefined,
    opts: { from?: string; to?: string },
  ) {
    if (!supplierId || !supplierId.trim()) {
      throw new BadRequestException('supplierId zorunlu.');
    }
    return this.muhasebe.getSupplierAccountReport(tenantId, supplierId.trim(), {
      from: opts.from,
      to: opts.to,
    });
  }

  /** Bayi hesabı raporu. */
  dealerAccount(
    tenantId: string,
    customerId: string | undefined,
    opts: { from?: string; to?: string },
  ) {
    if (!customerId || !customerId.trim()) {
      throw new BadRequestException('customerId zorunlu.');
    }
    return this.muhasebe.getDealerAccountReport(tenantId, customerId.trim(), {
      from: opts.from,
      to: opts.to,
    });
  }

  // ── Tahsilat Makbuzları (kredi kartı tahsilat makbuzları) ─────────────────

  /** Filtreli + sayfalı makbuz listesi. Tarih (from/to) YYYY-MM-DD. */
  async listReceipts(
    tenantId: string,
    opts: {
      kind?: string;
      customerId?: string;
      from?: string;
      to?: string;
      page?: unknown;
      pageSize?: unknown;
    },
  ) {
    const page = this.clampPage(opts.page);
    const pageSize = this.clampPageSize(opts.pageSize);
    const kind =
      opts.kind === 'order' || opts.kind === 'cari_topup' ? opts.kind : undefined;
    // Admin controller ile aynı TR-takvim sınırları.
    const from = opts.from ? (trDayStart(opts.from) ?? undefined) : undefined;
    const toEnd = opts.to ? trDayEndExclusive(opts.to) : null;
    const to = toEnd ? new Date(toEnd.getTime() - 1) : undefined;

    const { items, total } = await this.receipts.listForAdmin({
      tenantId,
      kind,
      customerId: opts.customerId?.trim() || undefined,
      from,
      to,
      take: pageSize,
      skip: (page - 1) * pageSize,
    });
    return { total, page, pageSize, makbuzlar: items };
  }

  /** Makbuzu olan bayilerin listesi (filtre için). */
  receiptDealers(tenantId: string) {
    return this.receipts.listDealerOptions(tenantId);
  }
}
