import type { Metadata } from "next";
import Link from "next/link";
import { AddToCartButton } from "@/components/AddToCartButton";
import { ProductGallery } from "@/components/ProductGallery";
import { ProductUnavailable } from "@/components/ProductUnavailable";
import {
  fetchProduct,
  isInStock,
  productImages,
  sanitizeDescription,
} from "@/lib/api";
import { ProductPrice } from "@/components/ProductPrice";

export const revalidate = 60;

type Params = { slug: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await fetchProduct(slug);
  if (!product) return { title: "Ürün bulunamadı — Toptan Budur" };
  const meta = sanitizeDescription(product.description);
  return {
    title: `${product.name} — Toptan Budur`,
    description: meta ? meta.slice(0, 160) : undefined,
  };
}

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  const product = await fetchProduct(slug);
  if (!product) {
    return <ProductUnavailable reason="not_found" />;
  }

  const inStock = isInStock(product);
  if (!inStock) {
    return (
      <ProductUnavailable reason="out_of_stock" productName={product.name} />
    );
  }

  const stockCount =
    typeof product.stock === "number" && product.stock > 0
      ? Math.floor(product.stock)
      : null;

  const images = productImages(product);
  const path = product.categoryPath ?? [];
  const safeDescription = sanitizeDescription(product.description);

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
        <nav className="mb-6 flex flex-wrap items-center gap-1 text-sm text-[var(--text-muted)]">
          <Link href="/katalog" className="hover:text-[var(--brand-navy)]">
            Katalog
          </Link>
          {path.map((c) => (
            <span key={c.slug} className="flex items-center gap-1">
              <span>/</span>
              <Link
                href={`/katalog?kategori=${encodeURIComponent(c.slug)}`}
                className="hover:text-[var(--brand-navy)]"
              >
                {c.name}
              </Link>
            </span>
          ))}
        </nav>

        <div className="grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <ProductGallery images={images} alt={product.name} />
          </div>

          <div className="lg:col-span-7">
            {product.brand && (
              <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                {product.brand}
              </div>
            )}
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-[var(--brand-navy)] sm:text-3xl">
              {product.name}
            </h1>
            <div className="mt-4 flex items-center gap-3">
              <ProductPrice
                price={product.price}
                currency={product.currency ?? "TRY"}
                supplierId={product.supplierId}
                slug={product.slug}
                size="lg"
              />
              <span
                className={`rounded px-2 py-1 text-xs font-medium ${
                  inStock
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-red-100 text-red-700"
                }`}
              >
                {inStock
                  ? stockCount != null
                    ? `Stokta · ${stockCount} adet`
                    : "Stokta"
                  : "Tükendi"}
              </span>
            </div>

            <AddToCartButton product={product} disabled={!inStock} />

            <section className="mt-8">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Ürün açıklaması
              </h2>
              <p className="whitespace-pre-line text-sm leading-relaxed text-[var(--text)]">
                {safeDescription
                  ? safeDescription
                  : "Bu ürün için detaylı açıklama henüz eklenmedi."}
              </p>
            </section>

            <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-2 border-t border-[var(--border)] pt-4 text-sm">
              {product.brand && (
                <>
                  <dt className="text-[var(--text-muted)]">Marka</dt>
                  <dd className="font-medium text-[var(--text)]">{product.brand}</dd>
                </>
              )}
              {product.sku && (
                <>
                  <dt className="text-[var(--text-muted)]">Stok Kodu</dt>
                  <dd className="font-medium text-[var(--text)] break-all">
                    {product.sku}
                  </dd>
                </>
              )}
              {product.publicBarcode && (
                <>
                  <dt className="text-[var(--text-muted)]">Barkod</dt>
                  <dd className="font-medium text-[var(--text)] break-all">
                    {product.publicBarcode}
                  </dd>
                </>
              )}
              {product.mpn && (
                <>
                  <dt className="text-[var(--text-muted)]">MPN</dt>
                  <dd className="font-medium text-[var(--text)] break-all">
                    {product.mpn}
                  </dd>
                </>
              )}
              <dt className="text-[var(--text-muted)]">Stok durumu</dt>
              <dd className="font-medium text-[var(--text)]">
                {inStock
                  ? stockCount != null
                    ? `Stokta · ${stockCount} adet`
                    : "Stokta"
                  : "Tükendi"}
              </dd>
              {path.length > 0 && (
                <>
                  <dt className="text-[var(--text-muted)]">Kategori</dt>
                  <dd className="font-medium text-[var(--text)]">
                    {path.map((c) => c.name).join(" / ")}
                  </dd>
                </>
              )}
            </dl>
        </div>
      </div>
    </main>
  );
}
