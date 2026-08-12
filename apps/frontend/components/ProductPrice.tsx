"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { formatPrice } from "@/lib/api";
import { useCustomer } from "@/lib/auth";
import { useEffectivePrice } from "@/components/EffectivePricesProvider";

interface ProductPriceProps {
  price?: number | string | null;
  currency?: string | null;
  supplierId?: string | null;
  /** ADMIN_DISCOUNT müşterilerde admin indirimli fiyatı çekmek için gerekli. */
  slug?: string | null;
  size?: "sm" | "lg";
  className?: string;
}

function toNumber(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(n)) return null;
  return n;
}

export function ProductPrice({
  price,
  currency,
  supplierId,
  slug,
  size = "sm",
  className,
}: ProductPriceProps) {
  const { customer, loading } = useCustomer();
  const pathname = usePathname();
  const base = toNumber(price);
  const cur = currency ?? "TRY";
  const isLg = size === "lg";
  const adminEffective = useEffectivePrice(slug ?? null);
  // GLOBAL Admin İndirimi müşterisinde etiket "Admin İndirimi"; diğer tüm
  // indirimlerde (Kâr İndirimi / tedarikçi / off-list) "Özel Bayi İndirimi".
  const discountLabel =
    customer?.customerStatus === "ADMIN_DISCOUNT"
      ? "Admin İndirimi"
      : "Özel Bayi İndirimi";

  // Bayi-only fiyatlandırma: giriş yapmamış ziyaretçilere fiyat yerine
  // "Bayilik Özel — Giriş yapın" rozeti gösterilir. `loading` sırasında
  // hydration mismatch'i önlemek için yer tutucu döndürülür.
  if (loading) {
    return (
      <span
        aria-hidden
        className={`inline-block h-5 w-24 rounded bg-[var(--surface-muted)] ${
          isLg ? "h-8 w-40" : ""
        } ${className ?? ""}`}
      />
    );
  }

  if (!customer) {
    const next = pathname && pathname.startsWith("/") ? pathname : "/katalog";
    return (
      <Link
        href={`/giris?next=${encodeURIComponent(next)}`}
        onClick={(e) => e.stopPropagation()}
        className={`inline-flex items-center rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-2.5 py-1 text-[var(--text-muted)] transition hover:border-[var(--brand-blue)]/50 hover:text-[var(--brand-navy)] ${
          isLg ? "text-sm" : "text-xs"
        } ${className ?? ""}`}
      >
        Fiyat görmek için giriş yapın
      </Link>
    );
  }

  if (base == null) {
    return <span className={className}>{formatPrice(price, cur)}</span>;
  }

  // Admin fiyatı (maliyet): adminEffective yalnız backend'in admin döndürdüğü
  // slug'larda gelir — global ADMIN_DISCOUNT'ta tüm ürünler, tedarikçi-bazlı
  // Admin İndirimi'nde yalnız o tedarikçinin ürünleri. customerStatus'a bakmadan,
  // fiyat VARSA gösterilir (yüklenmediyse normal akışa düşer, flicker). Bu fiyat
  // sepet+backend ile birebir aynıdır (gösterilen = tahsil edilen). Maliyet liste
  // fiyatının üstündeyse (nadir anomali) üstü çizili/indirim rozeti GÖSTERİLMEZ;
  // yalnız gerçek fiyat yazılır.
  if (adminEffective != null) {
    const cheaper = adminEffective < base;
    return (
      <span className={`flex flex-col ${className ?? ""}`}>
        {cheaper ? (
          <span
            className={`text-xs text-[var(--text-muted)] line-through ${
              isLg ? "text-sm" : ""
            }`}
          >
            {formatPrice(base, cur)}
          </span>
        ) : null}
        <span
          className={`font-semibold text-[var(--brand-navy)] ${
            isLg ? "text-3xl font-bold" : "text-lg"
          }`}
        >
          {formatPrice(adminEffective, cur)}
        </span>
        {cheaper ? (
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--brand-blue)]">
            {discountLabel}
          </span>
        ) : null}
      </span>
    );
  }

  // Bu noktaya yalnız backend'in özel (maliyet/Kâr İndirimi) fiyat DÖNMEDİĞİ
  // slug'larda gelinir. Etkin indirim önceliği motorla (orders.service) AYNI:
  // Kâr İndirimi backend'de hesaplanır → buraya geldiyse Kâr İndirimi devrede
  // değildir (ya da maliyet yok → tam fiyat). Burada YALNIZ legacy "liste
  // fiyatından" (off-list) indirim uygulanır; gösterilen = tahsil edilen.
  const row = supplierId
    ? (customer.supplierDiscounts ?? []).find((d) => d.supplierId === supplierId)
    : undefined;
  let rawDiscount = 0;
  if (row) {
    // Tedarikçi override'ı: Kâr İndirimi varsa client off-list uygulanmaz.
    rawDiscount = (row.profitDiscountPercent ?? 0) > 0 ? 0 : row.discountPercent;
  } else if ((customer.profitDiscountPercent ?? 0) > 0) {
    rawDiscount = 0; // global Kâr İndirimi backend'de hesaplanır
  } else {
    rawDiscount = customer.discountPercent ?? 0; // legacy global off-list
  }
  const discount = Math.max(0, Math.min(100, rawDiscount));

  const discounted = discount > 0 ? base * (1 - discount / 100) : base;

  if (discount > 0) {
    return (
      <span className={`flex flex-col ${className ?? ""}`}>
        <span
          className={`text-xs text-[var(--text-muted)] line-through ${
            isLg ? "text-sm" : ""
          }`}
        >
          {formatPrice(base, cur)}
        </span>
        <span
          className={`font-semibold text-[var(--brand-navy)] ${
            isLg ? "text-3xl font-bold" : "text-lg"
          }`}
        >
          {formatPrice(discounted, cur)}
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--brand-blue)]">
          {discountLabel}
        </span>
      </span>
    );
  }

  return (
    <span
      className={`font-semibold text-[var(--brand-navy)] ${
        isLg ? "text-3xl font-bold" : "text-lg"
      } ${className ?? ""}`}
    >
      {formatPrice(base, cur)}
    </span>
  );
}
