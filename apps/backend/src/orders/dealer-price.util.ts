import { Prisma } from '@prisma/client';

/**
 * Bayi (müşteri) indirimli birim fiyat — TEK KAYNAK.
 *
 * Bu mantık daha önce orders.service içinde İKİ KEZ kopyalıydı (sipariş-create +
 * fiyat-önizleme). Buraya çıkarıldı ki sipariş, önizleme ve Karşılaştırmalar
 * modülü BİREBİR aynı fiyatı üretsin (frontend/backend drift bug sınıfının
 * backend ayağını kapatır). Formül ve mod çözümü orders.service'teki eski
 * koddan DEĞİŞTİRİLMEDEN taşındı — davranış aynen korunur.
 */

// orders.service'teki dosya-yerel decimalRound2 ile BİREBİR aynı.
function round2(value: Prisma.Decimal): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(2));
}

export type DiscountMode = 'cost' | 'profit' | 'offlist' | 'none';

/**
 * İndirim modu çözümü — öncelik: (global/tedarikçi) Admin İndirimi > tedarikçi
 * satırı (profit>offlist>0) > global Kâr İndirimi > global off-list > yok.
 */
export function resolveDiscountMode(p: {
  isAdminDiscount: boolean;
  supplierAdminDiscount: boolean;
  hasRow: boolean;
  rowProfit: number;
  rowOfflist: number;
  globalProfitDiscountPercent: number;
  globalDiscountPercent: number;
}): { mode: DiscountMode; modePct: number } {
  if (p.isAdminDiscount || p.supplierAdminDiscount) return { mode: 'cost', modePct: 0 };
  if (p.hasRow) {
    if (p.rowProfit > 0) return { mode: 'profit', modePct: p.rowProfit };
    if (p.rowOfflist > 0) return { mode: 'offlist', modePct: p.rowOfflist };
    return { mode: 'none', modePct: 0 }; // tedarikçide açık "0" override → tam fiyat
  }
  if (p.globalProfitDiscountPercent > 0) return { mode: 'profit', modePct: p.globalProfitDiscountPercent };
  if (p.globalDiscountPercent > 0) return { mode: 'offlist', modePct: p.globalDiscountPercent };
  return { mode: 'none', modePct: 0 };
}

/**
 * Uygulanmış birim fiyat (KDV HARİÇ, 2 ondalık). Formül orders.service ile aynı:
 *  - cost   : maliyet fiyatı. Maliyet yoksa NULL → çağıran karar verir
 *             (sipariş: ADMIN_DISCOUNT_NO_COST fırlatır; önizleme: liste fiyatı).
 *  - profit : liste − (liste−maliyet)×pct/100; maliyet yoksa tam liste.
 *  - offlist: liste × (100−pct)/100.
 *  - none   : tam liste.
 */
export function applyDealerDiscount(
  original: Prisma.Decimal,
  cost: Prisma.Decimal | null,
  mode: DiscountMode,
  modePct: number,
): Prisma.Decimal | null {
  if (mode === 'cost') {
    if (!cost || cost.lte(0)) return null;
    return round2(cost);
  }
  if (mode === 'profit') {
    if (!cost || cost.lte(0)) return round2(original);
    const diff = original.sub(cost);
    const profitPortion = diff.gt(0) ? diff : new Prisma.Decimal(0);
    return round2(original.sub(profitPortion.mul(modePct).div(100)));
  }
  if (mode === 'offlist') {
    const discountFactor = new Prisma.Decimal(100 - modePct).div(100);
    return round2(original.mul(discountFactor));
  }
  return round2(original);
}
