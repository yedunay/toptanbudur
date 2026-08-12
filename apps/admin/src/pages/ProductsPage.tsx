import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRequireAuth } from "../lib/auth";
import { useDebounce } from "../lib/useDebounce";
import {
  bulkDeleteProducts,
  bulkUpdateProducts,
  fetchProducts,
  formatTRY,
  netMargin,
  patchProduct,
  withKdv,
  type BulkPatch,
  type Product,
  type ProductFilters,
  type ProductPatch,
  type ProductsResponse,
} from "../lib/products";
import ProductEditModal from "../components/ProductEditModal";
import ProductCreateModal from "../components/ProductCreateModal";
import BulkPriceModal from "../components/BulkPriceModal";
import ExportModal, { type ExportField } from "../components/ExportModal";
import { useToast } from "../components/Toast";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import {
  exportFromBackend,
  exportRowsAsCsv,
  isMissingEndpoint,
} from "../lib/exporting";
import { fetchSuppliers } from "../lib/suppliers";
import { canAccess } from "../lib/permissions";

const PAGE_SIZE = 50;
const BULK_CONFIRM_THRESHOLD = 50;

interface FilterState {
  q: string;
  inStock: boolean;
  page: number;
  supplierId: string;
  categorySlug: string;
}

function readFilters(params: URLSearchParams): FilterState {
  const pageRaw = Number(params.get("page") ?? "1");
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
  return {
    q: params.get("q") ?? "",
    inStock: params.get("inStock") === "true",
    page,
    supplierId: params.get("supplierId") ?? "",
    categorySlug: params.get("categorySlug") ?? "",
  };
}

function writeFilters(filters: FilterState): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q.trim().length > 0) params.set("q", filters.q.trim());
  if (filters.inStock) params.set("inStock", "true");
  if (filters.supplierId) params.set("supplierId", filters.supplierId);
  if (filters.categorySlug) params.set("categorySlug", filters.categorySlug);
  if (filters.page > 1) params.set("page", String(filters.page));
  return params;
}

export default function ProductsPage(): React.ReactElement | null {
  useDocumentTitle("Ürünler");
  const authed = useRequireAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const initial = useMemo(() => readFilters(searchParams), [searchParams]);
  const [qInput, setQInput] = useState<string>(initial.q);
  const debouncedQ = useDebounce(qInput, 300);
  const [inStock, setInStock] = useState<boolean>(initial.inStock);
  const [page, setPage] = useState<number>(initial.page);
  const [supplierId, setSupplierId] = useState<string>(initial.supplierId);
  const [categorySlug, setCategorySlug] = useState<string>(initial.categorySlug);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Product | null>(null);
  const [showBulkPrice, setShowBulkPrice] = useState<boolean>(false);
  const [showExport, setShowExport] = useState<boolean>(false);
  const [showCreate, setShowCreate] = useState<boolean>(false);

  // Sync URL when filters change
  useEffect(() => {
    const next = writeFilters({
      q: debouncedQ,
      inStock,
      page,
      supplierId,
      categorySlug,
    });
    setSearchParams(next, { replace: true });
  }, [debouncedQ, inStock, page, supplierId, categorySlug, setSearchParams]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
    setSelectedIds(new Set());
  }, [debouncedQ, inStock, supplierId, categorySlug]);

  const queryFilters: ProductFilters = {
    page,
    pageSize: PAGE_SIZE,
    q: debouncedQ.trim().length > 0 ? debouncedQ.trim() : undefined,
    inStock: inStock || undefined,
    supplierId: supplierId || undefined,
    categorySlug: categorySlug || undefined,
  };

  const productsQuery = useQuery<ProductsResponse>({
    queryKey: ["products", queryFilters],
    queryFn: () => fetchProducts(queryFilters),
    enabled: authed,
  });

  // Tedarikçi listesi — filtre + export modalındaki dropdown için.
  // Bu uç 'suppliers' sayfa iznine bağlı: izinsiz çalışanda 403 döner, dropdown
  // boş kalırdı. Sorguyu hiç atmayıp ilgili filtreleri de gizliyoruz.
  const canSeeSuppliers = canAccess("suppliers");
  const suppliersForFilter = useQuery({
    queryKey: ["suppliers", "for-filter"],
    queryFn: () => fetchSuppliers({ pageSize: 100 }),
    enabled: authed && canSeeSuppliers,
    staleTime: 5 * 60_000,
  });
  const supplierOptions = (suppliersForFilter.data?.data ?? []).map((s) => ({
    value: s.id,
    label: s.name,
  }));

  const patchMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ProductPatch }) =>
      patchProduct(id, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });

  const bulkMutation = useMutation({
    mutationFn: ({ ids, patch }: { ids: string[]; patch: BulkPatch }) =>
      bulkUpdateProducts(ids, patch),
    onSuccess: () => {
      setSelectedIds(new Set());
      void queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => bulkDeleteProducts(ids),
    onSuccess: (res) => {
      setSelectedIds(new Set());
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      toast.push("success", `${res.deleted} ürün silindi`);
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Silme başarısız";
      toast.push("error", message);
    },
  });

  const handleBulkDelete = (): void => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const confirmed = window.confirm(
      `${ids.length} ürün kalıcı olarak silinecek. Bu işlem geri alınamaz. Devam edilsin mi?`,
    );
    if (!confirmed) return;
    bulkDeleteMutation.mutate(ids);
  };

  const data = productsQuery.data;
  const products: Product[] = data?.data ?? [];
  const meta = data?.meta;

  const allOnPageSelected =
    products.length > 0 && products.every((p) => selectedIds.has(p.id));
  const someOnPageSelected =
    products.some((p) => selectedIds.has(p.id)) && !allOnPageSelected;

  const togglePageSelection = (): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) {
        for (const p of products) next.delete(p.id);
      } else {
        for (const p of products) next.add(p.id);
      }
      return next;
    });
  };

  const toggleOne = (id: string): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleToggleActive = (product: Product): void => {
    patchMutation.mutate({
      id: product.id,
      patch: { isActive: !product.isActive },
    });
  };

  const handleBulk = async (patch: BulkPatch): Promise<void> => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (ids.length >= BULK_CONFIRM_THRESHOLD) {
      const confirmed = window.confirm(`${ids.length} ürün güncellenecek, devam?`);
      if (!confirmed) return;
    }
    await bulkMutation.mutateAsync({ ids, patch });
  };

  const selectedCount = selectedIds.size;
  const isError = productsQuery.isError;
  const errorMessage =
    productsQuery.error instanceof Error
      ? productsQuery.error.message
      : "Veri alınamadı";

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--color-text)]">Ürünler</h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            {meta ? `${meta.total.toLocaleString("tr-TR")} ürün` : "Yükleniyor…"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/categories"
            className="rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm hover:bg-[var(--color-surface-muted)] inline-flex items-center gap-1.5"
            title="Kategori ağacını yönet"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 3h7v7H3z" />
              <path d="M14 3h7v7h-7z" />
              <path d="M14 14h7v7h-7z" />
              <path d="M3 14h7v7H3z" />
            </svg>
            Kategoriler
          </Link>
          <button
            type="button"
            onClick={() => setShowExport(true)}
            className="rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm hover:bg-[var(--color-surface-muted)]"
          >
            Excel'e Aktar
          </button>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="rounded-md bg-[var(--color-brand-blue)] px-3 py-2 text-sm text-white hover:bg-[var(--color-brand-navy)] inline-flex items-center gap-1.5"
          >
            <span aria-hidden="true">+</span> Yeni Ürün
          </button>
        </div>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          placeholder="Ürün adı, SKU veya barkod ara…"
          className="w-72 rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]"
        />
        {canSeeSuppliers ? (
          <select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className="rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm"
            aria-label="Tedarikçi filtresi"
          >
            <option value="">Tüm tedarikçiler</option>
            {supplierOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        ) : null}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={inStock}
            onChange={(e) => setInStock(e.target.checked)}
            className="h-4 w-4 rounded border-[var(--color-border)]"
          />
          <span>Sadece stokta</span>
        </label>
        {categorySlug ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-brand-blue)] bg-[var(--color-brand-blue)]/5 px-3 py-1 text-xs text-[var(--color-brand-blue)]">
            Kategori: {categorySlug}
            <button
              type="button"
              onClick={() => setCategorySlug("")}
              className="text-[var(--color-brand-blue)] hover:opacity-70"
              aria-label="Kategori filtresini kaldır"
              title="Kategori filtresini kaldır"
            >
              ✕
            </button>
          </span>
        ) : null}
        <span className="ml-auto text-xs text-[var(--color-text-muted)]">
          Sayfa başına {PAGE_SIZE}
        </span>
      </div>

      {selectedCount > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-[var(--color-brand-blue)] bg-[var(--color-brand-blue)]/5 px-4 py-2 text-sm">
          <span className="font-medium">{selectedCount} ürün seçildi</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleBulk({ isActive: true })}
              disabled={bulkMutation.isPending}
              className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs hover:bg-[var(--color-surface-muted)] disabled:opacity-50"
            >
              Stoğa al (Aktif)
            </button>
            <button
              type="button"
              onClick={() => void handleBulk({ isActive: false })}
              disabled={bulkMutation.isPending}
              className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs hover:bg-[var(--color-surface-muted)] disabled:opacity-50"
            >
              Pasifle
            </button>
            <button
              type="button"
              onClick={() => setShowBulkPrice(true)}
              disabled={bulkMutation.isPending}
              className="rounded-md bg-[var(--color-brand-blue)] px-3 py-1.5 text-xs text-white hover:bg-[var(--color-brand-navy)] disabled:opacity-50"
            >
              Toplu fiyat
            </button>
            <button
              type="button"
              onClick={handleBulkDelete}
              disabled={bulkDeleteMutation.isPending}
              className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              {bulkDeleteMutation.isPending ? "Siliniyor…" : "Sil"}
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] underline"
            >
              Seçimi temizle
            </button>
          </div>
        </div>
      ) : null}

      {isError ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 flex items-center justify-between">
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={() => void productsQuery.refetch()}
            className="rounded-md border border-red-300 bg-white px-3 py-1 text-xs text-red-700 hover:bg-red-100"
          >
            Tekrar dene
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--color-border)] bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
                <tr>
                  <th className="w-10 px-3 py-2 text-left">
                    <input
                      type="checkbox"
                      checked={allOnPageSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someOnPageSelected;
                      }}
                      onChange={togglePageSelection}
                      className="h-4 w-4"
                      aria-label="Tüm sayfayı seç"
                    />
                  </th>
                  <th className="w-16 px-3 py-2 text-left">Görsel</th>
                  <th className="px-3 py-2 text-left">İsim</th>
                  <th className="px-3 py-2 text-left">Tedarikçi</th>
                  <th className="px-3 py-2 text-left">Marka</th>
                  <th className="px-3 py-2 text-left">Kategori</th>
                  <th className="px-3 py-2 text-right">Geliş Fiyatı</th>
                  <th className="px-3 py-2 text-right">Fiyat</th>
                  <th className="px-3 py-2 text-right">Kar Marjı</th>
                  <th className="px-3 py-2 text-right">Stok</th>
                  <th className="px-3 py-2 text-center">Aktif</th>
                  <th className="px-3 py-2 text-right">İşlem</th>
                </tr>
              </thead>
              <tbody>
                {productsQuery.isLoading ? (
                  <tr>
                    <td colSpan={12} className="px-3 py-8 text-center text-[var(--color-text-muted)]">
                      Yükleniyor…
                    </td>
                  </tr>
                ) : products.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="px-3 py-8 text-center text-[var(--color-text-muted)]">
                      Ürün bulunamadı
                    </td>
                  </tr>
                ) : (
                  products.map((p) => {
                    const checked = selectedIds.has(p.id);
                    return (
                      <tr
                        key={p.id}
                        className="border-t border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]"
                      >
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleOne(p.id)}
                            className="h-4 w-4"
                            aria-label={`${p.name} seç`}
                          />
                        </td>
                        <td className="px-3 py-2">
                          {p.imageUrl ? (
                            <img
                              src={p.imageUrl}
                              alt=""
                              width={48}
                              height={48}
                              loading="lazy"
                              className="h-12 w-12 rounded-md object-cover bg-[var(--color-surface-muted)]"
                            />
                          ) : (
                            <div className="h-12 w-12 rounded-md bg-[var(--color-surface-muted)] border border-[var(--color-border)]" />
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-medium text-[var(--color-text)] line-clamp-2">
                            {p.name}
                          </div>
                          {p.internalCode || p.publicBarcode || p.externalCode || p.barcode ? (
                            <div className="mt-0.5 space-y-0.5 text-xs font-mono text-[var(--color-text-muted)]">
                              {/* Site (Toptan Budur) kodları — müşteriye gösterilen */}
                              {p.internalCode || p.publicBarcode ? (
                                <div title="Site kodları — müşteriye gösterilir">
                                  <span className="font-sans">Site:</span>{" "}
                                  {p.internalCode ? <span>Stok {p.internalCode}</span> : null}
                                  {p.internalCode && p.publicBarcode ? <span> · </span> : null}
                                  {p.publicBarcode ? <span>Barkod {p.publicBarcode}</span> : null}
                                </div>
                              ) : null}
                              {/* Tedarikçi kodları — yalnızca admin görür, müşteriye asla gösterilmez */}
                              {p.externalCode || p.barcode ? (
                                <div title="Tedarikçi kodları — yalnızca admin görür, müşteriye gösterilmez">
                                  <span className="font-sans">Tedarikçi:</span>{" "}
                                  {p.externalCode ? <span>Stok {p.externalCode}</span> : null}
                                  {p.externalCode && p.barcode ? <span> · </span> : null}
                                  {p.barcode ? <span>Barkod {p.barcode}</span> : null}
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-[var(--color-text-muted)]">
                          {p.supplier?.name ?? p.supplierName ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-[var(--color-text-muted)]">{p.brand ?? "—"}</td>
                        <td className="px-3 py-2 text-[var(--color-text-muted)]">
                          {p.categoryName ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          <div className="text-[var(--color-text-muted)]">
                            {formatTRY(withKdv(p.costPrice))}
                          </div>
                          <div className="text-xs text-[var(--color-text-muted)]">
                            KDV hariç {formatTRY(p.costPrice)}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          <div>{formatTRY(withKdv(p.price))}</div>
                          <div className="text-xs text-[var(--color-text-muted)]">
                            KDV hariç {formatTRY(p.price)}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {(() => {
                            const { diff, pct } = netMargin(p.price, p.costPrice);
                            const tone =
                              diff > 0
                                ? "text-emerald-600"
                                : diff < 0
                                  ? "text-red-600"
                                  : "text-[var(--color-text-muted)]";
                            return (
                              <>
                                <div className={`font-medium ${tone}`}>{formatTRY(diff)}</div>
                                <div className="text-xs text-[var(--color-text-muted)]">
                                  {pct === null ? "—" : `%${pct.toFixed(1)}`}
                                </div>
                              </>
                            );
                          })()}
                        </td>
                        <td
                          className={`px-3 py-2 text-right tabular-nums ${
                            p.stock === 0 ? "text-red-600 font-medium" : ""
                          }`}
                        >
                          {p.stock}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <button
                            type="button"
                            onClick={() => handleToggleActive(p)}
                            disabled={patchMutation.isPending}
                            aria-pressed={p.isActive}
                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                              p.isActive ? "bg-[var(--color-brand-blue)]" : "bg-gray-300"
                            } disabled:opacity-50`}
                          >
                            <span
                              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                p.isActive ? "translate-x-4" : "translate-x-1"
                              }`}
                            />
                          </button>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => setEditing(p)}
                            className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1 text-xs hover:bg-[var(--color-surface-muted)]"
                          >
                            Düzenle
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {meta && meta.totalPages > 1 ? (
            <div className="flex items-center justify-between border-t border-[var(--color-border)] bg-[var(--color-surface-muted)] px-4 py-3 text-sm">
              <span className="text-[var(--color-text-muted)]">
                Sayfa {meta.page} / {meta.totalPages}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={meta.page <= 1 || productsQuery.isFetching}
                  className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1 text-xs hover:bg-white/70 disabled:opacity-50"
                >
                  Önceki
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={meta.page >= meta.totalPages || productsQuery.isFetching}
                  className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1 text-xs hover:bg-white/70 disabled:opacity-50"
                >
                  Sonraki
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {showCreate ? (
        <ProductCreateModal
          onClose={() => setShowCreate(false)}
          onCreated={(created) => {
            toast.push(
              "success",
              `Ürün oluşturuldu (Stok ${created.internalCode} · ${created.imageCount} görsel)`,
            );
            void queryClient.invalidateQueries({ queryKey: ["products"] });
          }}
        />
      ) : null}

      {editing ? (
        <ProductEditModal
          product={editing}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            await patchMutation.mutateAsync({ id: editing.id, patch });
          }}
        />
      ) : null}

      {showBulkPrice ? (
        <BulkPriceModal
          count={selectedCount}
          onClose={() => setShowBulkPrice(false)}
          onApply={async (price) => {
            await handleBulk({ price });
          }}
        />
      ) : null}

      {showExport ? (
        <ExportModal
          title="Ürünleri Excel'e aktar"
          description="Filtreleri seçin veya tüm kayıtları indirin."
          fields={
            (
              [
                {
                  key: "q",
                  label: "Arama (ürün/SKU/marka)",
                  type: "text",
                  placeholder: "ör. iPhone 15",
                },
                {
                  key: "supplierId",
                  label: "Tedarikçi",
                  type: "select",
                  options: supplierOptions,
                },
                { key: "categorySlug", label: "Kategori slug", type: "text" },
                { key: "brand", label: "Marka", type: "text" },
                { key: "minPrice", label: "Min fiyat (TL)", type: "number" },
                { key: "maxPrice", label: "Max fiyat (TL)", type: "number" },
                { key: "inStock", label: "Sadece stokta olanlar", type: "checkbox" },
              ] satisfies ReadonlyArray<ExportField>
              // Tedarikçi seçeneği izinsiz çalışanda daima boş kalırdı — hiç çizme.
            ).filter((f) => canSeeSuppliers || f.key !== "supplierId")
          }
          initialValues={{
            q: debouncedQ.trim() || undefined,
            inStock: inStock || undefined,
            supplierId: supplierId || undefined,
          }}
          onClose={() => setShowExport(false)}
          onSubmit={async (values, scope) => {
            const filters =
              scope === "all"
                ? { scope: "all" as const }
                : {
                    scope: "filtered" as const,
                    q: values.q as string | undefined,
                    supplierId: values.supplierId as string | undefined,
                    categorySlug: values.categorySlug as string | undefined,
                    brand: values.brand as string | undefined,
                    minPrice: values.minPrice
                      ? Number(values.minPrice)
                      : undefined,
                    maxPrice: values.maxPrice
                      ? Number(values.maxPrice)
                      : undefined,
                    inStock: Boolean(values.inStock) || undefined,
                  };
            try {
              const result = await exportFromBackend("products", filters);
              if (result.ok) {
                toast.push("success", `${result.filename} indirildi`);
                setShowExport(false);
                return;
              }
              if (result.status === 404 || result.status === 501) {
                // CSV fallback (mevcut sayfadaki veriyle)
                const stamp = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Istanbul" });
                exportRowsAsCsv(
                  products.map((p) => ({
                    id: p.id,
                    sku: p.sku ?? "",
                    barcode: p.barcode ?? "",
                    name: p.name,
                    supplier: p.supplier?.name ?? p.supplierName ?? "",
                    brand: p.brand ?? "",
                    category: p.categoryName ?? "",
                    costPrice: p.costPrice,
                    price: p.price,
                    stock: p.stock,
                    isActive: p.isActive ? "Aktif" : "Pasif",
                  })),
                  [
                    { key: "id", label: "ID" },
                    { key: "sku", label: "SKU" },
                    { key: "barcode", label: "Barkod" },
                    { key: "name", label: "İsim" },
                    { key: "supplier", label: "Tedarikçi" },
                    { key: "brand", label: "Marka" },
                    { key: "category", label: "Kategori" },
                    { key: "costPrice", label: "Geliş Fiyatı" },
                    { key: "price", label: "Fiyat" },
                    { key: "stock", label: "Stok" },
                    { key: "isActive", label: "Durum" },
                  ],
                  `urunler-${stamp}.csv`,
                );
                toast.push(
                  "info",
                  "Backend XLSX endpoint'i hazır değil — geçici CSV indirildi (yalnızca görünen sayfa).",
                );
                setShowExport(false);
                return;
              }
              toast.push("error", `Export hata: HTTP ${result.status}`);
            } catch (err) {
              if (isMissingEndpoint(err)) {
                toast.push("info", "Backend export endpoint'i hazır değil.");
              } else {
                toast.push(
                  "error",
                  err instanceof Error ? err.message : "Export başarısız",
                );
              }
            }
          }}
        />
      ) : null}
    </div>
  );
}
