import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchSupplierProducts,
  updateSupplierCategoryActive,
  updateSupplierCategoryPricing,
  type ProfitTier,
  type SupplierCategory,
} from "../lib/suppliers";
import { formatTRY } from "../lib/products";
import { useToast } from "./Toast";
import KademeliKarEditor from "./KademeliKarEditor";

type CategoryPricingMode = "inherit" | "fixed" | "tiered";

function initialMode(category: SupplierCategory): CategoryPricingMode {
  if (category.profitTypeOverride === "tiered") return "tiered";
  if (
    category.profitTypeOverride === "fixed" ||
    category.marginPercentOverride !== null ||
    category.extraCostTryOverride !== null
  ) {
    return "fixed";
  }
  return "inherit";
}

const PAGE_SIZE = 20;

interface SupplierCategoryDetailModalProps {
  supplierId: string;
  category: SupplierCategory;
  /** Tedarikçinin global kâr marjı (%) — override boşken uygulanan değer. */
  globalMargin: number;
  /** Tedarikçinin global ek kârı (TL) — override boşken uygulanan değer. */
  globalExtra: number;
  onClose: () => void;
}

/** Yüzde/para girişini parse eder: boş → null (globale dön), geçerli sayı → değer. */
function parseOverrideInput(raw: string): number | null | undefined {
  const trimmed = raw.trim().replace(",", ".");
  if (trimmed.length === 0) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return undefined; // geçersiz
  return n;
}

export default function SupplierCategoryDetailModal({
  supplierId,
  category,
  globalMargin,
  globalExtra,
  onClose,
}: SupplierCategoryDetailModalProps): React.ReactElement {
  const queryClient = useQueryClient();
  const toast = useToast();
  const categoriesKey = ["supplier-categories", supplierId] as const;

  const [page, setPage] = useState<number>(1);
  const [mode, setMode] = useState<CategoryPricingMode>(() =>
    initialMode(category),
  );
  const [tiers, setTiers] = useState<ProfitTier[]>(
    Array.isArray(category.profitTiers) ? category.profitTiers : [],
  );
  const [marginInput, setMarginInput] = useState<string>(
    category.marginPercentOverride !== null
      ? String(category.marginPercentOverride)
      : "",
  );
  const [extraInput, setExtraInput] = useState<string>(
    category.extraCostTryOverride !== null
      ? String(category.extraCostTryOverride)
      : "",
  );

  const productsKey = [
    "supplier-category-products",
    supplierId,
    category.code,
    page,
  ] as const;

  const productsQuery = useQuery({
    queryKey: productsKey,
    queryFn: () =>
      fetchSupplierProducts(supplierId, {
        page,
        pageSize: PAGE_SIZE,
        categoryPath: category.code,
      }),
  });

  const activeMutation = useMutation({
    mutationFn: (isActive: boolean) =>
      updateSupplierCategoryActive(supplierId, category.code, isActive),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: categoriesKey });
    },
    onError: (err) =>
      toast.push(
        "error",
        err instanceof Error ? err.message : "Kategori güncellenemedi",
      ),
  });

  const pricingMutation = useMutation({
    mutationFn: (patch: {
      marginPercentOverride?: number | null;
      extraCostTryOverride?: number | null;
      profitTypeOverride?: "fixed" | "tiered" | null;
      profitTiers?: ProfitTier[] | null;
    }) => updateSupplierCategoryPricing(supplierId, category.code, patch),
    onSuccess: (result) => {
      toast.push(
        "success",
        result.repriced > 0
          ? `Fiyatlandırma kaydedildi · ${result.repriced.toLocaleString("tr-TR")} ürün yeniden hesaplandı`
          : "Fiyatlandırma kaydedildi",
      );
      void queryClient.invalidateQueries({ queryKey: categoriesKey });
      void queryClient.invalidateQueries({ queryKey: productsKey });
      void queryClient.invalidateQueries({
        queryKey: ["supplier-products", supplierId],
      });
    },
    onError: (err) =>
      toast.push(
        "error",
        err instanceof Error ? err.message : "Fiyatlandırma kaydedilemedi",
      ),
  });

  const handleSavePricing = (): void => {
    if (mode === "tiered") {
      pricingMutation.mutate({
        profitTypeOverride: "tiered",
        profitTiers: tiers,
      });
      return;
    }
    // Sabit kâr override'ı (boş alan = tedarikçi globali).
    const margin = parseOverrideInput(marginInput);
    const extra = parseOverrideInput(extraInput);
    if (margin === undefined || extra === undefined) {
      toast.push("error", "Geçersiz değer — pozitif bir sayı girin veya boş bırakın");
      return;
    }
    pricingMutation.mutate({
      profitTypeOverride: "fixed",
      profitTiers: null,
      marginPercentOverride: margin,
      extraCostTryOverride: extra,
    });
  };

  const handleResetToGlobal = (): void => {
    setMode("inherit");
    setMarginInput("");
    setExtraInput("");
    setTiers([]);
    pricingMutation.mutate({
      profitTypeOverride: null,
      profitTiers: null,
      marginPercentOverride: null,
      extraCostTryOverride: null,
    });
  };

  // Önizleme: girilen (veya global) değerlerle efektif marj/ek kâr.
  const previewMargin = useMemo(() => {
    const parsed = parseOverrideInput(marginInput);
    return parsed === null || parsed === undefined ? globalMargin : parsed;
  }, [marginInput, globalMargin]);
  const previewExtra = useMemo(() => {
    const parsed = parseOverrideInput(extraInput);
    return parsed === null || parsed === undefined ? globalExtra : parsed;
  }, [extraInput, globalExtra]);

  const data = productsQuery.data;
  const products = data?.data ?? [];
  const meta = data?.meta;

  const hasOverride =
    category.profitTypeOverride !== null ||
    category.marginPercentOverride !== null ||
    category.extraCostTryOverride !== null;
  const active = category.isActive;
  // Kademeli/sabit modda her zaman kaydedilebilir; miras modda yalnız override varsa
  // "Globale döndür" anlamlıdır (Kaydet gizli).
  const canSave = mode !== "inherit";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="category-detail-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl border border-[var(--color-border)] bg-white shadow-xl">
        {/* Header */}
        <div className="flex flex-shrink-0 items-start justify-between gap-4 border-b border-[var(--color-border)] px-6 py-4">
          <div className="min-w-0">
            <h3
              id="category-detail-title"
              className="truncate text-base font-semibold text-[var(--color-text)]"
            >
              {category.name || "—"}
            </h3>
            <p className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]">
              {category.code}
            </p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => activeMutation.mutate(!active)}
              disabled={activeMutation.isPending}
              aria-pressed={active}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition disabled:opacity-60 ${
                active
                  ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                  : "bg-gray-100 text-gray-500 hover:bg-gray-200"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${active ? "bg-emerald-500" : "bg-gray-400"}`}
                aria-hidden
              />
              {active ? "Aktif" : "Pasif"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)]"
              aria-label="Kapat"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden
              >
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* Pricing override */}
          <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-muted)]/40 p-4">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-[var(--color-text)]">
                Kategori bazlı fiyatlandırma
              </h4>
              {hasOverride ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                  Özel fiyat aktif
                </span>
              ) : (
                <span className="text-[11px] text-[var(--color-text-muted)]">
                  Global ayarlar uygulanıyor
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Yalnızca bu kategorideki ürünler etkilenir. "Tedarikçiden miras" =
              tedarikçinin genel ayarı uygulanır.
            </p>

            {/* Mod seçici: Miras / Sabit / Kademeli */}
            <div className="mt-3 inline-flex flex-wrap rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-0.5">
              {(
                [
                  ["inherit", "Tedarikçiden Miras"],
                  ["fixed", "Sabit Kâr"],
                  ["tiered", "Fiyata Göre Kademeli Kâr"],
                ] as Array<[CategoryPricingMode, string]>
              ).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                    mode === m
                      ? m === "tiered"
                        ? "bg-amber-500 text-white shadow-sm"
                        : "bg-white text-[var(--color-text)] shadow-sm"
                      : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {mode === "inherit" ? (
              <p className="mt-3 text-xs text-[var(--color-text-muted)]">
                Bu kategori tedarikçinin genel kâr ayarını kullanıyor. Özel fiyat
                için "Sabit Kâr" veya "Fiyata Göre Kademeli Kâr" seçin.
              </p>
            ) : mode === "tiered" ? (
              <div className="mt-3">
                <KademeliKarEditor
                  initialTiers={tiers}
                  onChange={(t) => setTiers(t)}
                />
              </div>
            ) : (
              <>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-xs font-medium text-[var(--color-text)]">
                      Kâr marjı (%)
                    </span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      value={marginInput}
                      onChange={(e) => setMarginInput(e.target.value)}
                      placeholder={`Global: %${globalMargin}`}
                      className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]"
                    />
                    <span className="mt-1 block text-[11px] text-[var(--color-text-muted)]">
                      Boş = global (%{globalMargin})
                    </span>
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-[var(--color-text)]">
                      Ek kâr (TL)
                    </span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      value={extraInput}
                      onChange={(e) => setExtraInput(e.target.value)}
                      placeholder={`Global: ${formatTRY(globalExtra)}`}
                      className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]"
                    />
                    <span className="mt-1 block text-[11px] text-[var(--color-text-muted)]">
                      Boş = global ({formatTRY(globalExtra)})
                    </span>
                  </label>
                </div>
                <p className="mt-2 text-[11px] text-[var(--color-text-muted)]">
                  Uygulanacak: <strong className="text-[var(--color-text)]">%{previewMargin}</strong>
                  {" + "}
                  <strong className="text-[var(--color-text)]">{formatTRY(previewExtra)}</strong>
                </p>
              </>
            )}

            <div className="mt-3 flex items-center justify-end gap-2">
              {hasOverride ? (
                <button
                  type="button"
                  onClick={handleResetToGlobal}
                  disabled={pricingMutation.isPending}
                  className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-muted)] disabled:opacity-60"
                >
                  Globale döndür
                </button>
              ) : null}
              {canSave ? (
                <button
                  type="button"
                  onClick={handleSavePricing}
                  disabled={pricingMutation.isPending}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand-blue)] px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[var(--color-brand-navy)] disabled:opacity-60"
                >
                  {pricingMutation.isPending ? "Kaydediliyor…" : "Kaydet"}
                </button>
              ) : null}
            </div>
          </section>

          {/* Products */}
          <section className="mt-5">
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-sm font-semibold text-[var(--color-text)]">
                Bu kategorideki ürünler
              </h4>
              {meta ? (
                <span className="text-xs text-[var(--color-text-muted)]">
                  {meta.total.toLocaleString("tr-TR")} ürün
                </span>
              ) : null}
            </div>

            {productsQuery.isError ? (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {productsQuery.error instanceof Error
                  ? productsQuery.error.message
                  : "Ürünler alınamadı"}
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-[var(--color-border)]">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
                      <tr>
                        <th className="px-3 py-2 text-left">İsim</th>
                        <th className="px-3 py-2 text-right">Alış</th>
                        <th className="px-3 py-2 text-right">Satış</th>
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
                          <td
                            colSpan={5}
                            className="px-3 py-8 text-center text-[var(--color-text-muted)]"
                          >
                            Yükleniyor…
                          </td>
                        </tr>
                      ) : products.length === 0 ? (
                        <tr>
                          <td
                            colSpan={5}
                            className="px-3 py-8 text-center text-[var(--color-text-muted)]"
                          >
                            Bu kategoride ürün bulunmuyor.
                          </td>
                        </tr>
                      ) : (
                        products.map((p) => (
                          <tr
                            key={p.id}
                            className="border-t border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]"
                          >
                            <td className="px-3 py-2">
                              <div className="line-clamp-2 font-medium text-[var(--color-text)]">
                                {p.name}
                              </div>
                              {p.sku ? (
                                <div className="text-xs text-[var(--color-text-muted)]">
                                  {p.sku}
                                </div>
                              ) : null}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              <div className="text-[var(--color-text)]">
                                {formatTRY(p.costPrice)}
                              </div>
                              <div className="text-[10px] font-normal text-[var(--color-text-muted)]">
                                KDV hariç
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              <div className="font-medium text-[var(--color-text)]">
                                {formatTRY(p.price)}
                              </div>
                              <div className="text-[10px] font-normal text-[var(--color-text-muted)]">
                                KDV hariç
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums font-medium text-emerald-700">
                              {formatTRY(p.price - p.costPrice)}
                            </td>
                            <td
                              className={`px-3 py-2 text-right tabular-nums ${
                                p.stock === 0 ? "font-medium text-red-600" : ""
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
                  <div className="flex items-center justify-between border-t border-[var(--color-border)] bg-[var(--color-surface-muted)] px-4 py-2.5 text-xs">
                    <span className="text-[var(--color-text-muted)]">
                      Sayfa {meta.page} / {meta.totalPages}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={meta.page <= 1 || productsQuery.isFetching}
                        className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1 hover:bg-white/70 disabled:opacity-50"
                      >
                        Önceki
                      </button>
                      <button
                        type="button"
                        onClick={() => setPage((p) => p + 1)}
                        disabled={
                          meta.page >= meta.totalPages || productsQuery.isFetching
                        }
                        className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1 hover:bg-white/70 disabled:opacity-50"
                      >
                        Sonraki
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </section>
        </div>

        <div className="flex flex-shrink-0 items-center justify-end border-t border-[var(--color-border)] px-6 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--color-border)] bg-white px-4 py-2 text-sm hover:bg-[var(--color-surface-muted)]"
          >
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
}
