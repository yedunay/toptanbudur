import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRequireAuth } from "../lib/auth";
import { useDebounce } from "../lib/useDebounce";
import {
  deleteSupplier,
  fetchSuppliers,
  formatRelativeTime,
  syncSupplier,
  type Supplier,
  type SupplierFilters,
  type SuppliersResponse,
} from "../lib/suppliers";
import { useToast } from "../components/Toast";
import ConfirmDialog from "../components/ConfirmDialog";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import SupplierBalanceStrip from "../components/SupplierBalanceStrip";
import SupplierBalanceModal from "../components/SupplierBalanceModal";
import {
  fetchSupplierBalanceSummary,
  type SupplierBalanceRow,
} from "../lib/supplier-balance";
import { formatTRY } from "../lib/products";

const PAGE_SIZE = 25;

export default function SuppliersPage(): React.ReactElement | null {
  useDocumentTitle("Tedarikçiler");
  const authed = useRequireAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const initialQ = searchParams.get("q") ?? "";
  const initialPage = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);

  const [qInput, setQInput] = useState<string>(initialQ);
  const debouncedQ = useDebounce(qInput, 300);
  const [page, setPage] = useState<number>(initialPage);

  const [confirmDelete, setConfirmDelete] = useState<Supplier | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [balanceTarget, setBalanceTarget] = useState<{ id: string; name?: string } | null>(
    null,
  );
const filters: SupplierFilters = useMemo(
    () => ({
      page,
      pageSize: PAGE_SIZE,
      q: debouncedQ.trim().length > 0 ? debouncedQ.trim() : undefined,
    }),
    [page, debouncedQ],
  );

  useEffect(() => {
    const next = new URLSearchParams();
    if (debouncedQ.trim()) next.set("q", debouncedQ.trim());
    if (page > 1) next.set("page", String(page));
    setSearchParams(next, { replace: true });
  }, [debouncedQ, page, setSearchParams]);

  const suppliersQuery = useQuery<SuppliersResponse>({
    queryKey: ["suppliers", filters],
    queryFn: () => fetchSuppliers(filters),
    enabled: authed,
  });

  // Bakiye özeti — şerit ile aynı queryKey'i paylaşır (tek istek).
  const balanceQuery = useQuery({
    queryKey: ["supplier-balance", "summary"],
    queryFn: fetchSupplierBalanceSummary,
    enabled: authed,
  });

  const balanceById = useMemo(() => {
    const map = new Map<string, SupplierBalanceRow>();
    for (const row of balanceQuery.data?.suppliers ?? []) {
      map.set(row.supplierId, row);
    }
    return map;
  }, [balanceQuery.data]);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteSupplier(id),
    onSuccess: () => {
      toast.push("success", "Tedarikçi silindi");
      void queryClient.invalidateQueries({ queryKey: ["suppliers"] });
    },
    onError: (err) => {
      toast.push("error", err instanceof Error ? err.message : "Silme başarısız");
    },
  });

const handleSync = async (supplier: Supplier): Promise<void> => {
    setSyncingId(supplier.id);
    try {
      await syncSupplier(supplier.id);
      toast.push("success", `${supplier.name} senkronizasyonu başlatıldı`);
      void queryClient.invalidateQueries({ queryKey: ["suppliers"] });
    } catch (err) {
      toast.push("error", err instanceof Error ? err.message : "Senkron başarısız");
    } finally {
      setSyncingId(null);
    }
  };

  const data = suppliersQuery.data;
  const suppliers = data?.data ?? [];
  const meta = data?.meta;

  return (
    <div>
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--color-text)]">Tedarikçiler</h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            {meta ? `${meta.total.toLocaleString("tr-TR")} tedarikçi` : "Yükleniyor…"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/suppliers/new"
            className="rounded-md bg-[var(--color-brand-blue)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-brand-navy)]"
          >
            Yeni Tedarikçi Ekle
          </Link>
        </div>
      </header>

      <SupplierBalanceStrip
        className="mb-4"
        onManageSupplier={(id) => setBalanceTarget({ id })}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={qInput}
          onChange={(e) => {
            setQInput(e.target.value);
            setPage(1);
          }}
          placeholder="Ad, kod, e-posta veya marka ara..."
          className="w-72 rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]"
        />
      </div>

      {suppliersQuery.isError ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 flex items-center justify-between">
          <span>
            {suppliersQuery.error instanceof Error
              ? suppliersQuery.error.message
              : "Veri alınamadı"}
          </span>
          <button
            type="button"
            onClick={() => void suppliersQuery.refetch()}
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
                  <th className="px-3 py-2 text-left">Ad</th>
                  <th className="px-3 py-2 text-center">Feed</th>
                  <th className="px-3 py-2 text-center">Durum</th>
                  <th className="px-3 py-2 text-left">Son senkron</th>
                  <th className="px-3 py-2 text-right">Bakiye</th>
                  <th className="px-3 py-2 text-right">Ürün</th>
                  <th className="px-3 py-2 text-right">Marj %</th>
                  <th className="px-3 py-2 text-right">İşlem</th>
                </tr>
              </thead>
              <tbody>
                {suppliersQuery.isLoading ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-3 py-8 text-center text-[var(--color-text-muted)]"
                    >
                      Yükleniyor…
                    </td>
                  </tr>
                ) : suppliers.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-3 py-8 text-center text-[var(--color-text-muted)]"
                    >
                      Henüz tedarikçi eklenmemiş.{" "}
                      <Link
                        to="/suppliers/new"
                        className="text-[var(--color-brand-blue)] underline"
                      >
                        Yeni ekle
                      </Link>
                      .
                    </td>
                  </tr>
                ) : (
                  suppliers.map((s) => (
                    <tr
                      key={s.id}
                      className="border-t border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]"
                    >
                      <td className="px-3 py-2 font-medium">
                        <Link
                          to={`/suppliers/${s.id}/products`}
                          className="hover:underline"
                        >
                          {s.name}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-0.5 text-xs tabular-nums">
                          {s.feedCount} feed
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <div className="inline-flex flex-wrap items-center justify-center gap-1">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                              s.isActive
                                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                : "bg-gray-100 text-gray-600 border border-gray-200"
                            }`}
                          >
                            {s.isActive ? "Aktif" : "Pasif"}
                          </span>
                          {!s.includeInOwnFeed ? (
                            <span
                              className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700"
                              title="Bu tedarikçinin ürünleri kendi XML feed'imize dahil edilmiyor"
                            >
                              XML Hariç
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-[var(--color-text-muted)]">
                        {formatRelativeTime(s.lastSyncAt)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {(() => {
                          const bal = balanceById.get(s.id);
                          if (!bal) {
                            return (
                              <span className="text-[var(--color-text-muted)]">—</span>
                            );
                          }
                          return (
                            <span
                              className={
                                bal.isLow
                                  ? "font-semibold text-rose-600"
                                  : "text-[var(--color-text)]"
                              }
                              title={bal.isLow ? "Düşük bakiye" : undefined}
                            >
                              {formatTRY(bal.balance)}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {(s.productCount ?? 0).toLocaleString("tr-TR")}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        %{s.marginPercent}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => navigate(`/suppliers/${s.id}/edit`)}
                            className="rounded-md border border-[var(--color-border)] bg-white px-2.5 py-1 text-xs hover:bg-[var(--color-surface-muted)]"
                          >
                            Düzenle
                          </button>
                          <button
                            type="button"
                            onClick={() => navigate(`/suppliers/${s.id}/brands`)}
                            className="rounded-md border border-[var(--color-border)] bg-white px-2.5 py-1 text-xs hover:bg-[var(--color-surface-muted)]"
                            title="Marka eşleştirme"
                          >
                            Markalar
                          </button>
                          <button
                            type="button"
                            onClick={() => setBalanceTarget({ id: s.id, name: s.name })}
                            className="rounded-md border border-[var(--color-border)] bg-white px-2.5 py-1 text-xs hover:bg-[var(--color-surface-muted)]"
                            title="Tedarikçi cüzdan bakiyesi"
                          >
                            Bakiye
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleSync(s)}
                            disabled={syncingId === s.id}
                            className="rounded-md border border-[var(--color-border)] bg-white px-2.5 py-1 text-xs hover:bg-[var(--color-surface-muted)] disabled:opacity-50"
                          >
                            {syncingId === s.id ? "Senkron…" : "Test Senkron"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDelete(s)}
                            className="rounded-md border border-red-200 bg-white px-2.5 py-1 text-xs text-red-700 hover:bg-red-50"
                          >
                            Sil
                          </button>
                        </div>
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
                  disabled={meta.page <= 1 || suppliersQuery.isFetching}
                  className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1 text-xs hover:bg-white/70 disabled:opacity-50"
                >
                  Önceki
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={meta.page >= meta.totalPages || suppliersQuery.isFetching}
                  className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1 text-xs hover:bg-white/70 disabled:opacity-50"
                >
                  Sonraki
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {confirmDelete ? (
        <ConfirmDialog
          title="Tedarikçi sil"
          message={`"${confirmDelete.name}" tedarikçisi ve tüm feed'leri silinecek. Devam edilsin mi?`}
          confirmLabel="Sil"
          destructive
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            const id = confirmDelete.id;
            setConfirmDelete(null);
            deleteMutation.mutate(id);
          }}
        />
      ) : null}

      {balanceTarget ? (
        <SupplierBalanceModal
          supplierId={balanceTarget.id}
          supplierName={balanceTarget.name}
          onClose={() => setBalanceTarget(null)}
        />
      ) : null}
    </div>
  );
}
