import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface EffectivePriceItem {
  slug: string;
  effectivePrice: string;
}

export interface EffectivePricesResult {
  customerStatus: 'STANDARD' | 'ADMIN_DISCOUNT';
  items: EffectivePriceItem[];
}

/**
 * Müşteriye özel "geçerli fiyat" (effectivePrice) — vitrin/sepet gösteriminin
 * backend ile birebir aynı olması için. Alan adı kasıtlı olarak maliyetten kopuk;
 * müşteriye "Özel Bayi İndirimi" etiketiyle gösterilir, ham "maliyet" denmez.
 *
 * Bu servis YALNIZCA backend'in tek-tek hesaplaması gereken modları döndürür:
 *   • 'cost'   = maliyet (Admin İndirimi global/tedarikçi VEYA Kâr İndirimi %100)
 *   • 'profit' = Kâr İndirimi (kardan): maliyet + (liste − maliyet) × (1 − %/100)
 * Bu mantık orders.service.ts ile BİREBİR aynıdır (gösterilen = tahsil edilen).
 *
 * Legacy off-list (liste fiyatından indirim) ve indirimsiz slug'lar item dönmez;
 * frontend onları kendi tarafında (liste × (1 − %/100)) hesaplar.
 */
@Injectable()
export class CustomerPricingService {
  constructor(private readonly prisma: PrismaService) {}

  async getEffectivePrices(
    customerId: string,
    tenantSlug: string,
    slugs: string[],
  ): Promise<EffectivePricesResult> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        customerStatus: true,
        profitDiscountPercent: true,
        supplierDiscounts: {
          select: {
            supplierId: true,
            profitDiscountPercent: true,
            adminDiscount: true,
          },
        },
      },
    });
    if (!customer) throw new NotFoundException('customer not found');

    const status = (customer.customerStatus ?? 'STANDARD') as
      | 'STANDARD'
      | 'ADMIN_DISCOUNT';

    const globalAdmin = status === 'ADMIN_DISCOUNT';
    const globalProfit = clampPct(customer.profitDiscountPercent ?? 0);
    const adminSupplierIds = new Set<string>();
    const supplierProfit = new Map<string, number>();
    const supplierRows = new Set<string>();
    for (const d of customer.supplierDiscounts ?? []) {
      supplierRows.add(d.supplierId);
      if (d.adminDiscount) adminSupplierIds.add(d.supplierId);
      supplierProfit.set(d.supplierId, clampPct(d.profitDiscountPercent ?? 0));
    }

    // Maliyet/Kâr kapsamı yoksa (yalnız legacy off-list / indirimsiz) → boş.
    const hasScope =
      globalAdmin ||
      globalProfit > 0 ||
      adminSupplierIds.size > 0 ||
      [...supplierProfit.values()].some((v) => v > 0);
    if (!hasScope || slugs.length === 0) {
      return { customerStatus: status, items: [] };
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: tenantSlug },
      select: { id: true },
    });
    if (!tenant) throw new NotFoundException('tenant not found');

    const products = await this.prisma.product.findMany({
      where: {
        tenantId: tenant.id,
        slug: { in: slugs },
        active: true,
      },
      select: { slug: true, price: true, costPrice: true, supplierId: true },
    });

    const items: EffectivePriceItem[] = [];
    for (const p of products) {
      const sid = p.supplierId;
      // Modu orders.service.ts ile aynı önceliklerle çöz.
      let mode: 'cost' | 'profit' | 'none' = 'none';
      let pct = 0;
      if (globalAdmin || (sid && adminSupplierIds.has(sid))) {
        mode = 'cost';
      } else if (sid && supplierRows.has(sid)) {
        const rp = supplierProfit.get(sid) ?? 0;
        if (rp > 0) {
          mode = 'profit';
          pct = rp;
        } else {
          mode = 'none'; // tedarikçi override'ı (legacy/0) → frontend hesaplar
        }
      } else if (globalProfit > 0) {
        mode = 'profit';
        pct = globalProfit;
      }
      if (mode === 'none') continue;

      const cost = p.costPrice ? new Prisma.Decimal(p.costPrice) : null;
      if (!cost || cost.lte(0)) continue; // maliyet yoksa effective hesaplanamaz
      if (mode === 'cost') {
        items.push({ slug: p.slug, effectivePrice: cost.toFixed(2) });
        continue;
      }
      // profit: maliyet + (liste − maliyet) × (1 − pct/100); maliyetin altına inmez.
      const list = new Prisma.Decimal(p.price);
      const diff = list.sub(cost);
      const profitPortion = diff.gt(0) ? diff : new Prisma.Decimal(0);
      const eff = list.sub(profitPortion.mul(pct).div(100));
      items.push({ slug: p.slug, effectivePrice: eff.toFixed(2) });
    }

    return { customerStatus: status, items };
  }
}

function clampPct(n: number): number {
  return Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
}
