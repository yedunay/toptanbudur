import Link from "next/link";
import {
  isInStock,
  productImage,
  type Product,
} from "@/lib/api";
import { ProductPrice } from "@/components/ProductPrice";
import { ProductImage } from "@/components/ProductImage";

export function ProductCard({ product }: { product: Product }) {
  const img = productImage(product);
  const inStock = isInStock(product);
  return (
    <Link
      href={`/katalog/${encodeURIComponent(product.slug)}`}
      className="group flex flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-white transition hover:-translate-y-0.5 hover:shadow-lg"
      aria-label={inStock ? product.name : `${product.name} (tükendi)`}
    >
      <div className="relative aspect-square w-full overflow-hidden bg-white">
        <div
          className={`absolute inset-0 flex items-center justify-center p-2 ${
            inStock ? "" : "opacity-60 grayscale"
          }`}
        >
          <ProductImage
            key={`${product.id ?? product.slug}-${img ?? "none"}`}
            src={img}
            alt={product.name}
            width={480}
            height={480}
            className="max-h-full max-w-full object-contain transition duration-300 group-hover:scale-[1.04]"
            sizes="(min-width: 1024px) 22vw, (min-width: 640px) 33vw, 50vw"
            unoptimized
          />
        </div>
        {!inStock && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 grid place-items-center bg-white/40"
          >
            <span className="rounded-md bg-[var(--brand-navy)]/90 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-white">
              Tükendi
            </span>
          </div>
        )}
        <span
          className={`absolute left-2 top-2 rounded px-2 py-0.5 text-[11px] font-medium ${
            inStock
              ? "bg-emerald-100 text-emerald-700"
              : "bg-gray-200 text-gray-700"
          }`}
        >
          {inStock ? "Stokta" : "Tükendi"}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <h3 className="line-clamp-2 text-sm font-medium text-[var(--text)]">
          {product.name}
        </h3>
        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <ProductPrice
            price={product.price}
            currency={product.currency ?? "TRY"}
            supplierId={product.supplierId}
            slug={product.slug}
          />
          {!inStock && (
            <span className="text-[11px] font-medium text-[var(--text-muted)]">
              Sepete eklenemez
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
