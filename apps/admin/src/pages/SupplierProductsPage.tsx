import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRequireAuth } from "../lib/auth";
import { useDebounce } from "../lib/useDebounce";
import {
  fetchSupplier,
  fetchSupplierProducts,
  syncSupplier,
} from "../lib/suppliers";
import { formatTRY } from "../lib/products";
import { useToast } from "../components/Toast";
import { useDocumentTitle } from "../lib/useDocumentTitle";

const PAGE_SIZE = 50;

export default function SupplierProductsPage(): React.ReactElement | null {
  useDocumentTitle("Tedarikçi Ürünleri");
  const authed = useRequireAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const sourceBrand = searchParams.get("sourceBrand") ?? undefined;

  const [qInput, setQInput] = useState<string>("");
  const debouncedQ = useDebounce(qInput, 300);
  const [page, setPage] = useState<number>(1);
  const [syncing, setSyncing] = useState<boolean>(false);

  const clearBrandFilter = (): void => {
    const next = new URLSearchParams(searchParams);
    next.delete("sourceBrand");
    setSearchParams(next, { replace: true });
    setPage(1);
  };

  const supplierQuery = useQuery({
    queryKey: ["supplier", id],
    queryFn: () => (id ? fetchSupplier(id) : Promise.reject(new Error("missing id"))),
    enabled: authed && Boolean(id),
  });

  const productsQuery = useQuery({
    queryKey: ["supplier-products", id, debouncedQ, page, sourceBrand],
    queryFn: () =>
      id
        ? fetchSupplierProducts(id, {
            page,
            pageSize: PAGE_SIZE,
            q: debouncedQ.trim().length > 0 ? debouncedQ.trim() : undefined,
            sourceBrand,
          })
        : Promise.reject(new Error("missing id")),
    enabled: authed && Boolean(id),
  });

  const handleSync = async (): Promise<void> => {
    if (!id) return;
    setSyncing(true);
    try {
      await syncSupplier(id);
      toast.push("success", "Senkronizasyon başlatıldı");
      void queryClient.invalidateQueries({ queryKey: ["supplier-products", id] });
      void queryClient.invalidateQueries({ queryKey: ["supplier", id] });
    } catch (err) {
      toast.push("error", err instanceof Error ? err.message : "Senkron başarısız");
    } finally {
      setSyncing(false);
    }
  };

  const supplier = supplierQuery.data;
  const data = productsQuery.data;
  const products = data?.data ?? [];
  const meta = data?.meta;

  return (
    <div>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <Link
            to="/suppliers"
            className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] underline"
          >
            ← Tedarikçiler
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-[var(--color-text)]">
            {supplier ? supplier.name : "Tedarikçi"}
          </h1>
          {supplier ? (
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              %{supplier.marginPercent} marj · {meta ? `${meta.total.toLocaleString("tr-TR")} ürün` : "—"}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {id ? (
            <Link
              to={`/suppliers/${id}/edit`}
              className="rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm hover:bg-[var(--color-surface-muted)]"
            >
              Düzenle
            </Link>
          ) : null}
          <button
            type="button"
            onClick={() => void handleSync()}
            disabled={syncing}
            className="rounded-md bg-[var(--color-brand-blue)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-brand-navy)] disabled:opacity-60"
          >
            {syncing ? "Senkron çalışıyor…" : "Test Senkron"}
          </button>
        </div>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={qInput}
          onChange={(e) => {
            setQInput(e.target.value);
            setPage(1);
          }}
          placeholder="Ürün adı, SKU veya barkod ara…"
          className="w-72 rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]"
        />
        {sourceBrand ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-brand-blue)] bg-[var(--color-brand-blue)]/5 px-3 py-1 text-xs text-[var(--color-brand-blue)]">
            Marka: {sourceBrand}
            <button
              type="button"
              onClick={clearBrandFilter}
              className="text-[var(--color-brand-blue)] hover:opacity-70"
              aria-label="Marka filtresini kaldır"
              title="Marka filtresini kaldır"
            >
              ✕
            </button>
          </span>
        ) : null}
      </div>

      {productsQuery.isError ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {productsQuery.error instanceof Error
            ? productsQuery.error.message
            : "Veri alınamadı"}
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--color-border)] bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
                <tr>
                  <th className="w-16 px-3 py-2 text-left">Görsel</th>
                  <th className="px-3 py-2 text-left">İsim</th>
                  <th className="px-3 py-2 text-left">Marka</th>
                  <th className="px-3 py-2 text-right">Alış fiyatı</th>
                  <th className="px-3 py-2 text-right">Satış fiyatı</th>
                  <th className="px-3 py-2 text-right text-emerald-700">
                    Kâr
                    <span className="block text-[10px] font-normal text-emerald-600">
                      net kdvsiz
                    </span>
                  </th>
                  <th className="px-3 py-2 text-right">Stok</th>
                </tr>
              </thead>
              <tbody>
                {productsQuery.isLoading ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-[var(--color-text-muted)]">
                      Yükleniyor…
                    </td>
                  </tr>
                ) : products.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-[var(--color-text-muted)]">
                      Bu kaynak için ürün bulunmuyor. "Test Senkron" çalıştırın.
                    </td>
                  </tr>
                ) : (
                  products.map((p) => (
                    <tr
                      key={p.id}
                      className="border-t border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]"
                    >
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
                        {p.sku ? (
                          <div className="text-xs text-[var(--color-text-muted)]">{p.sku}</div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-[var(--color-text-muted)]">{p.brand ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <div className="text-[var(--color-text)]">{formatTRY(p.costPrice)}</div>
                        <div className="text-[10px] font-normal text-[var(--color-text-muted)]">
                          KDV hariç
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <div className="font-medium text-[var(--color-text)]">{formatTRY(p.price)}</div>
                        <div className="text-[10px] font-normal text-[var(--color-text-muted)]">
                          KDV hariç
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium text-emerald-700">
                        {formatTRY(p.price - p.costPrice)}
                      </td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums ${
                          p.stock === 0 ? "text-red-600 font-medium" : ""
                        }`}
                      >
                        {p.stock}
                      </td>
                    </tr>
                  ))
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
    </div>
  );
}
