import { CatalogSidebar } from "@/components/CatalogSidebar";
import { CatalogCategoriesPanel } from "@/components/CatalogCategoriesPanel";
import { CatalogToolbar } from "@/components/CatalogToolbar";
import { ProductCard } from "@/components/ProductCard";
import { Pagination } from "@/components/Pagination";
import {
  fetchCorrectCategories,
  fetchProducts,
  type CatalogQuery,
  type CategoryNode,
} from "@/lib/api";
import { readCategoryVisibility } from "@/lib/catalog-prefs.server";
import { getAdminDiscountSessionCookie } from "@/lib/auth-server";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;

function pickFirst(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

/** V3: doğru kategori ağacında slug → tam yol (ürün filtresi path ile yapılır). */
function findCategoryPathBySlug(
  nodes: CategoryNode[],
  slug: string,
): string | undefined {
  for (const n of nodes) {
    if (n.slug === slug) return n.path;
    if (n.children) {
      const found = findCategoryPathBySlug(n.children, slug);
      if (found) return found;
    }
  }
  return undefined;
}

function toCatalogQuery(sp: SP): CatalogQuery {
  return {
    kategori: pickFirst(sp.kategori),
    q: pickFirst(sp.q),
    marka: sp.marka,
    min: pickFirst(sp.min),
    max: pickFirst(sp.max),
    sirala: pickFirst(sp.sirala),
    sayfa: pickFirst(sp.sayfa),
    stoklu: pickFirst(sp.stoklu),
  };
}

export default async function KatalogPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const query = toCatalogQuery(sp);
  // ADMIN_DISCOUNT müşteri ise dedup'suz (tüm varyant) liste için oturum
  // cookie'sini taşı; aksi halde `null` → public, cache'li davranış korunur.
  const sessionCookie = await getAdminDiscountSessionCookie();
  // V3: DOĞRU kategori ağacını çek; aktif kategorinin slug'ından yolunu çözüp
  // ürünleri canonicalCategoryPath ile filtrele. categorySlug GÖNDERİLMEZ.
  const [categories, categoryVisibility] = await Promise.all([
    fetchCorrectCategories(),
    readCategoryVisibility(),
  ]);
  const cats = categories ?? [];
  const canonicalPath = query.kategori
    ? findCategoryPathBySlug(cats, query.kategori)
    : undefined;
  // canonicalPath bulunduysa DOĞRU kategori filtresi; bulunamadıysa (eski
  // slug'lı linkler — landing kartları, ürün breadcrumb) eski categorySlug
  // davranışına düşülür → hiçbir eski link kırılmaz.
  const productQuery: CatalogQuery = canonicalPath
    ? { ...query, kategori: undefined, canonicalPath }
    : query;
  const list = await fetchProducts(productQuery, 60, sessionCookie);

  const products = list?.data ?? [];
  const meta =
    list?.meta ?? {
      total: products.length,
      page: 1,
      pageSize: 24,
      totalPages: 1,
    };

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--brand-navy)]">
            Katalog
          </h1>
          <p className="text-sm text-[var(--text-muted)]">
            Tüm ürünleri filtreleyerek inceleyin.
          </p>
        </div>
        <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
          <CatalogCategoriesPanel initial={categoryVisibility}>
            <CatalogSidebar
              categories={cats}
              active={{
                kategori: query.kategori,
                min: query.min,
                max: query.max,
                stoklu: query.stoklu,
              }}
            />
          </CatalogCategoriesPanel>
          <section className="min-w-0 flex-1">
            <CatalogToolbar total={meta.total} />
            {products.length === 0 ? (
              <div className="mt-12 rounded-lg border border-dashed border-[var(--border)] bg-white p-12 text-center">
                <p className="text-base font-medium text-[var(--text)]">
                  Sonuç bulunamadı
                </p>
                <p className="mt-1 text-sm text-[var(--text-muted)]">
                  Filtreleri değiştirip tekrar deneyin.
                </p>
              </div>
            ) : (
              <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {products.map((p) => (
                  <ProductCard key={p.id ?? p.slug} product={p} />
                ))}
              </div>
            )}
            <Pagination
              current={meta.page ?? 1}
              totalPages={meta.totalPages ?? 1}
              searchParams={sp}
            />
          </section>
      </div>
    </main>
  );
}
