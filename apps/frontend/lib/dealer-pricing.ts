import type { Customer } from "@/lib/auth";
import type { CartItem } from "@/lib/cart";

/** Para tutarını 2 ondalığa yuvarlar — backend `decimalRound2` ile aynı. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Bir bayinin (login'li müşteri) verilen tedarikçi için geçerli indirim
 * yüzdesini döndürür.
 *
 * Öncelik: tedarikçiye özel indirim > genel indirim > 0.
 * Sonuç her zaman 0–100 aralığına sabitlenir.
 *
 * Bu mantık backend `orders.service.ts` (`effectiveDiscount`) ve
 * `ProductPrice.tsx` ile BİREBİR aynıdır — sepet/ödeme ekranındaki
 * tutarların siparişin gerçek toplamıyla eşleşmesi buna bağlıdır.
 *
 * NOT: ADMIN_DISCOUNT müşterisinde bu fonksiyon kullanılmamalıdır;
 * çağıran taraf `cartItemUnitPrice` üzerinden geçer, o da admin fiyatını
 * doğrudan ikame eder.
 */
export function effectiveDiscountPercent(
  customer: Customer | null | undefined,
  supplierId: string | null | undefined,
): number {
  if (!customer) return 0;
  // Yalnız LEGACY "liste fiyatından" (off-list) indirim. Maliyet ve Kâr İndirimi
  // backend `effectivePriceBySlug` ile gelir (cartItemUnitPrice onu önceler) →
  // bu fonksiyon yalnız o harita boşken çağrılır. Önceliği motorla aynı tutmak
  // için Kâr İndirimi devredeyken off-list UYGULANMAZ (tam fiyat).
  const row =
    supplierId != null
      ? (customer.supplierDiscounts ?? []).find(
          (d) => d.supplierId === supplierId,
        )
      : undefined;
  let raw = 0;
  if (row) {
    raw = (row.profitDiscountPercent ?? 0) > 0 ? 0 : row.discountPercent;
  } else if ((customer.profitDiscountPercent ?? 0) > 0) {
    raw = 0; // global Kâr İndirimi → backend hesaplar
  } else {
    raw = customer.discountPercent ?? 0; // legacy global off-list
  }
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(100, raw));
}

/**
 * ADMIN_DISCOUNT müşterileri için backend `/me/pricing/effective` çağrısından
 * dönen slug→effectivePrice eşlemesi. Provider tarafından doldurulur.
 *
 * STANDARD müşterilerde her zaman boş/undefined geçilebilir.
 */
export type EffectivePriceBySlug = Readonly<Record<string, number>> | null | undefined;

/**
 * Sepetteki bir kalemin uygulanmış birim fiyatı (KDV hariç).
 *
 * Slug için effective price (maliyet) varsa o kullanılır — bu, backend'in
 * `costPrice` üzerinden hesapladığı fiyatla birebir aynıdır. Bu harita yalnızca
 * admin-fiyatlı slug'larda dolu gelir: global ADMIN_DISCOUNT'ta tüm slug'lar,
 * tedarikçi-bazlı Admin İndirimi'nde yalnız o tedarikçinin slug'ları. Diğer tüm
 * durumlarda standart bayi indirimi akışı uygulanır.
 *
 * İndirim yoksa ham fiyat aynen döner. İndirim varsa sonuç, backend'in
 * kalem-başı yuvarlamasıyla (`decimalRound2`) uyumlu olsun diye 2 ondalığa
 * yuvarlanır.
 */
export function cartItemUnitPrice(
  item: CartItem,
  customer: Customer | null | undefined,
  effectivePriceBySlug?: EffectivePriceBySlug,
): number {
  // Admin fiyatı (maliyet) yalnızca backend'in admin-fiyat döndürdüğü slug'larda
  // dolu gelir → global statüden bağımsız, slug bazında uygulanır. Harita yoksa
  // veya bu slug admin kapsamı dışındaysa normal bayi indirimi akışına düşer.
  if (effectivePriceBySlug && item.slug) {
    const adminPrice = effectivePriceBySlug[item.slug];
    if (
      typeof adminPrice === "number" &&
      Number.isFinite(adminPrice) &&
      adminPrice > 0
    ) {
      return round2(adminPrice);
    }
  }
  const discount = effectiveDiscountPercent(customer, item.supplier?.id ?? null);
  if (discount <= 0) return item.price;
  return round2(item.price * (1 - discount / 100));
}

/**
 * Verilen sepet kalemlerinin bayi indirimli ara toplamı (KDV hariç).
 * KDV ve genel toplam bu değerin üzerinden hesaplanmalıdır.
 */
export function cartSubtotal(
  items: readonly CartItem[],
  customer: Customer | null | undefined,
  effectivePriceBySlug?: EffectivePriceBySlug,
): number {
  return items.reduce(
    (sum, item) =>
      sum + cartItemUnitPrice(item, customer, effectivePriceBySlug) * item.qty,
    0,
  );
}
