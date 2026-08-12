import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRequireAuth } from "../lib/auth";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { fetchSupplier } from "../lib/suppliers";
import {
  fetchSupplierBrands,
  saveSupplierBrands,
  type SupplierBrandMapping,
} from "../lib/supplierBrands";
import { useToast } from "../components/Toast";

const inputClass =
  "block w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]";

export default function SupplierBrandsPage(): React.ReactElement | null {
  const { id } = useParams<{ id: string }>();
  useDocumentTitle("Marka Eşleştirme");
  const authed = useRequireAuth();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [rows, setRows] = useState<SupplierBrandMapping[]>([]);
  const [filter, setFilter] = useState<string>("");

  const supplierQuery = useQuery({
    queryKey: ["supplier", id],
    queryFn: () => (id ? fetchSupplier(id) : Promise.reject(new Error("missing id"))),
    enabled: authed && Boolean(id),
  });

  const brandsQuery = useQuery({
    queryKey: ["supplier-brands", id],
    queryFn: () =>
      id ? fetchSupplierBrands(id) : Promise.reject(new Error("missing id")),
    enabled: authed && Boolean(id),
  });

  useEffect(() => {
    if (brandsQuery.data) {
      // Sıralama: önce gizlenmemiş + sourceBrandName alfabetik
      const sorted = [...brandsQuery.data].sort((a, b) =>
        a.sourceBrandName.localeCompare(b.sourceBrandName, "tr"),
      );
      setRows(sorted);
    }
  }, [brandsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      id
        ? saveSupplierBrands(id, rows)
        : Promise.reject(new Error("missing id")),
    onSuccess: (res) => {
      const savedCount = res?.updated ?? rows.length;
      const hiddenCount = res?.hidden ?? 0;
      toast.push(
        "success",
        hiddenCount > 0
          ? `${savedCount} marka kaydedildi · ${hiddenCount.toLocaleString(
              "tr-TR",
            )} ürün gizlendi`
          : `${savedCount} marka eşleştirmesi kaydedildi`,
      );
      void queryClient.invalidateQueries({ queryKey: ["supplier-brands", id] });
    },
    onError: (err) => {
      toast.push(
        "error",
        err instanceof Error ? err.message : "Kayıt başarısız",
      );
    },
  });

  const updateRow = (index: number, patch: Partial<SupplierBrandMapping>): void => {
    setRows((prev) =>
      prev.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    );
  };

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (q.length === 0) return rows.map((r, i) => ({ row: r, index: i }));
    return rows
      .map((r, i) => ({ row: r, index: i }))
      .filter(
        ({ row }) =>
          row.sourceBrandName.toLowerCase().includes(q) ||
          (row.targetBrandName ?? "").toLowerCase().includes(q),
      );
  }, [rows, filter]);

  const supplier = supplierQuery.data;

  if (!authed) return null;

  return (
    <div className="max-w-5xl">
      <header className="mb-6">
        <Link
          to="/suppliers"
          className="text-sm text-[var(--color-brand-blue)] hover:underline"
        >
          ← Tedarikçiler
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-[var(--color-text)]">
          Marka eşleştirme
          {supplier ? (
            <span className="ml-2 text-base font-normal text-[var(--color-text-muted)]">
              · {supplier.name}
            </span>
          ) : null}
        </h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Tedarikçi XML'indeki marka adlarını kendi sisteminizdeki marka adıyla
          eşleştirin. <strong>Marka adına</strong> (veya ürün sayısına) tıklayarak
          o markanın ürünlerini görebilirsiniz. <strong>Hedef marka boş
          bırakılırsa</strong> kaynak marka olduğu gibi kullanılır. <strong>Gizle</strong> işaretlenip kaydedilirse
          o markanın tüm ürünleri anında pasifleştirilir — mağaza vitrininde
          listelenmez. Gizleme kaldırılınca ürünler bir sonraki
          senkronizasyonda yeniden aktifleşir.
        </p>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Marka ara…"
          className="w-72 rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]"
        />
        <span className="text-xs text-[var(--color-text-muted)]">
          Toplam {rows.length} marka
        </span>
        {rows.length > 0 && (
          <button
            type="button"
            onClick={() =>
              setRows((prev) =>
                prev.map((r) => ({ ...r, targetBrandName: "Toptan Budur" })),
              )
            }
            className="rounded-md border border-[var(--color-brand-blue)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--color-brand-blue)] hover:bg-blue-50"
            title="Tüm hedef marka alanlarını 'Toptan Budur' olarak doldurur"
          >
            Tümünü &ldquo;Toptan Budur&rdquo; yap
          </button>
        )}
        {rows.some((r) => r.targetBrandName === "Toptan Budur") && (
          <button
            type="button"
            onClick={() =>
              setRows((prev) =>
                prev.map((r) =>
                  r.targetBrandName === "Toptan Budur"
                    ? { ...r, targetBrandName: null }
                    : r,
                ),
              )
            }
            className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)]"
          >
            Tümünü temizle
          </button>
        )}
      </div>

      {brandsQuery.isError ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 flex items-center justify-between">
          <span>
            {brandsQuery.error instanceof Error
              ? brandsQuery.error.message
              : "Marka listesi alınamadı"}
          </span>
          <button
            type="button"
            onClick={() => void brandsQuery.refetch()}
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
                  <th className="px-3 py-2 text-left">Kaynak Marka (XML)</th>
                  <th className="px-3 py-2 text-left">Hedef Marka</th>
                  <th className="px-3 py-2 text-right">Ürün</th>
                  <th className="px-3 py-2 text-center">Gizle</th>
                </tr>
              </thead>
              <tbody>
                {brandsQuery.isLoading ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-3 py-8 text-center text-[var(--color-text-muted)]"
                    >
                      Yükleniyor…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-3 py-8 text-center text-[var(--color-text-muted)]"
                    >
                      Bu tedarikçi için henüz marka bulunamadı. Bir senkronizasyon
                      çalıştırdıktan sonra tekrar deneyin.
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-3 py-8 text-center text-[var(--color-text-muted)]"
                    >
                      Aramanızla eşleşen marka yok.
                    </td>
                  </tr>
                ) : (
                  filtered.map(({ row, index }) => (
                    <tr
                      key={`${row.sourceBrandName}-${index}`}
                      className="border-t border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]"
                    >
                      <td className="px-3 py-2 font-medium text-[var(--color-text)]">
                        {id && (row.productCount ?? 0) > 0 ? (
                          <Link
                            to={`/suppliers/${id}/products?sourceBrand=${encodeURIComponent(
                              row.sourceBrandName,
                            )}`}
                            className="text-[var(--color-brand-blue)] hover:underline"
                            title={`"${row.sourceBrandName}" markasının ürünlerini göster`}
                          >
                            {row.sourceBrandName || "(boş)"}
                          </Link>
                        ) : row.sourceBrandName ? (
                          row.sourceBrandName
                        ) : (
                          <span className="italic text-[var(--color-text-muted)]">
                            (boş)
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={row.targetBrandName ?? ""}
                            onChange={(e) =>
                              updateRow(index, {
                                targetBrandName: e.target.value || null,
                              })
                            }
                            placeholder={`Boş = "${row.sourceBrandName}" kullan`}
                            className={inputClass}
                            disabled={row.hidden}
                          />
                          {!row.hidden && row.targetBrandName !== "Toptan Budur" && (
                            <button
                              type="button"
                              onClick={() =>
                                updateRow(index, { targetBrandName: "Toptan Budur" })
                              }
                              className="shrink-0 rounded border border-[var(--color-brand-blue)] px-2 py-1 text-[11px] font-medium text-[var(--color-brand-blue)] hover:bg-blue-50 whitespace-nowrap"
                              title="Bu markayı 'Toptan Budur' olarak eşleştir"
                            >
                              AB
                            </button>
                          )}
                          {!row.hidden && row.targetBrandName && (
                            <button
                              type="button"
                              onClick={() =>
                                updateRow(index, { targetBrandName: null })
                              }
                              className="shrink-0 rounded border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)]"
                              title="Hedef markayı temizle — orijinal XML adı kullanılır"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-[var(--color-text-muted)]">
                        {id && (row.productCount ?? 0) > 0 ? (
                          <Link
                            to={`/suppliers/${id}/products?sourceBrand=${encodeURIComponent(
                              row.sourceBrandName,
                            )}`}
                            className="text-[var(--color-brand-blue)] hover:underline"
                            title={`"${row.sourceBrandName}" markasındaki ürünleri göster`}
                          >
                            {(row.productCount ?? 0).toLocaleString("tr-TR")}
                          </Link>
                        ) : (
                          (row.productCount ?? 0).toLocaleString("tr-TR")
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={row.hidden}
                          onChange={(e) =>
                            updateRow(index, { hidden: e.target.checked })
                          }
                          className="h-4 w-4"
                          aria-label={`${row.sourceBrandName} markasını gizle`}
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center justify-end gap-2">
        <Link
          to="/suppliers"
          className="rounded-md border border-[var(--color-border)] bg-white px-4 py-2 text-sm hover:bg-[var(--color-surface-muted)]"
        >
          Geri dön
        </Link>
        <button
          type="button"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || rows.length === 0}
          className="rounded-md bg-[var(--color-brand-blue)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-brand-navy)] disabled:opacity-60"
        >
          {saveMutation.isPending ? "Kaydediliyor…" : "Tümünü kaydet"}
        </button>
      </div>
    </div>
  );
}
