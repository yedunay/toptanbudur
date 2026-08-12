import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRequireAuth } from "../../lib/auth";
import { useDocumentTitle } from "../../lib/useDocumentTitle";
import { formatAmount } from "../../lib/format";
import SearchableSelect from "../../components/SearchableSelect";
import {
  downloadLedger,
  fetchLedger,
  ledgerTypeLabel,
  searchCustomers,
  searchSuppliers,
  type CustomerOption,
  type LedgerType,
  type SupplierOption,
} from "../../lib/muhasebe";
import { formatDate } from "./ui";

const PAGE_SIZE = 50;

interface DraftRange {
  from: string;
  to: string;
}

interface CariUrlState {
  type: LedgerType;
  id: string | null;
  from: string;
  to: string;
  page: number;
}

function readUrlState(): CariUrlState {
  if (typeof window === "undefined") {
    return { type: "supplier", id: null, from: "", to: "", page: 1 };
  }
  const p = new URLSearchParams(window.location.search);
  const rawType = p.get("type");
  const type: LedgerType = rawType === "dealer" ? "dealer" : "supplier";
  const page = Number.parseInt(p.get("page") ?? "1", 10);
  return {
    type,
    id: p.get("id"),
    from: p.get("from") ?? "",
    to: p.get("to") ?? "",
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

function writeUrlState(state: CariUrlState): void {
  if (typeof window === "undefined") return;
  const p = new URLSearchParams();
  p.set("type", state.type);
  if (state.id) p.set("id", state.id);
  if (state.from) p.set("from", state.from);
  if (state.to) p.set("to", state.to);
  if (state.page > 1) p.set("page", String(state.page));
  const qs = p.toString();
  window.history.replaceState(
    null,
    "",
    qs ? `?${qs}` : window.location.pathname,
  );
}

export default function CariHareketlerPage(): React.ReactElement | null {
  useDocumentTitle("Cari Hareketler");
  const authed = useRequireAuth();

  const initial = useMemo(() => readUrlState(), []);

  const [type, setType] = useState<LedgerType>(initial.type);
  const [selectedSupplier, setSelectedSupplier] = useState<SupplierOption | null>(
    initial.type === "supplier" && initial.id
      ? { id: initial.id, name: initial.id }
      : null,
  );
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerOption | null>(
    initial.type === "dealer" && initial.id
      ? {
          id: initial.id,
          name: initial.id,
          companyTitle: null,
          email: "",
          bayiNo: null,
        }
      : null,
  );
  const [range, setRange] = useState<DraftRange>({
    from: initial.from,
    to: initial.to,
  });
  const [draft, setDraft] = useState<DraftRange>({
    from: initial.from,
    to: initial.to,
  });
  const [page, setPage] = useState(initial.page);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const activeId =
    type === "supplier" ? selectedSupplier?.id ?? null : selectedCustomer?.id ?? null;

  // URL durumu senkronu
  useEffect(() => {
    writeUrlState({ type, id: activeId, from: range.from, to: range.to, page });
  }, [type, activeId, range.from, range.to, page]);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["muhasebe", "ledger", type, activeId, range.from, range.to, page],
    queryFn: () =>
      fetchLedger({
        type,
        id: activeId as string,
        from: range.from || undefined,
        to: range.to || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
    enabled: authed && Boolean(activeId),
    placeholderData: (prev) => prev,
  });

  // Deep-link ile gelen id'nin gerçek adını ledger sonucundan tamamla
  useEffect(() => {
    if (!data) return;
    if (type === "supplier") {
      setSelectedSupplier((cur) =>
        cur && cur.id === data.entity.id && cur.name !== data.entity.name
          ? { ...cur, name: data.entity.name }
          : cur,
      );
    } else {
      setSelectedCustomer((cur) =>
        cur && cur.id === data.entity.id && cur.name !== data.entity.name
          ? { ...cur, name: data.entity.name }
          : cur,
      );
    }
  }, [data, type]);

  function switchType(next: LedgerType): void {
    if (next === type) return;
    setType(next);
    setPage(1);
  }

  function applyRange(): void {
    setRange(draft);
    setPage(1);
  }

  function clearRange(): void {
    const empty = { from: "", to: "" };
    setDraft(empty);
    setRange(empty);
    setPage(1);
  }

  function handleSupplierChange(item: SupplierOption | null): void {
    setSelectedSupplier(item);
    setPage(1);
  }

  function handleCustomerChange(item: CustomerOption | null): void {
    setSelectedCustomer(item);
    setPage(1);
  }

  async function handleExport(): Promise<void> {
    if (!activeId) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      await downloadLedger({
        type,
        id: activeId,
        from: range.from || undefined,
        to: range.to || undefined,
      });
    } catch (err) {
      setDownloadError(
        err instanceof Error ? err.message : "Excel indirilemedi.",
      );
    } finally {
      setDownloading(false);
    }
  }

  if (!authed) return null;

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const balance = data?.currentBalance ?? 0;
  const balanceTone =
    balance > 0
      ? "text-emerald-700"
      : balance < 0
        ? "text-rose-600"
        : "text-slate-500";

  return (
    <div className="space-y-6 pb-12">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--color-text)]">
            Cari Hareketler
          </h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Tedarikçi veya bayi seçin; hesabın tüm borç/alacak hareketlerini
            (iptaller/iadeler dahil) ve güncel bakiyesini görün.
          </p>
        </div>
        {activeId ? (
          <button
            type="button"
            onClick={handleExport}
            disabled={downloading}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--color-brand-navy)] px-4 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {downloading ? "İndiriliyor…" : "Excel'e Aktar"}
          </button>
        ) : null}
      </header>

      {downloadError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {downloadError}
        </div>
      ) : null}

      {/* FİLTRE KARTI */}
      <div className="rounded-2xl border border-[var(--color-border)] bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
          {/* Tip seçimi */}
          <div>
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Hesap tipi
            </span>
            <div
              role="tablist"
              aria-label="Hesap tipi"
              className="inline-flex rounded-lg border border-[var(--color-border)] bg-slate-50 p-0.5"
            >
              <button
                type="button"
                role="tab"
                aria-selected={type === "supplier"}
                onClick={() => switchType("supplier")}
                className={`h-8 rounded-md px-4 text-sm font-medium transition ${
                  type === "supplier"
                    ? "bg-white text-[var(--color-brand-navy)] shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                Tedarikçi
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={type === "dealer"}
                onClick={() => switchType("dealer")}
                className={`h-8 rounded-md px-4 text-sm font-medium transition ${
                  type === "dealer"
                    ? "bg-white text-[var(--color-brand-navy)] shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                Bayi
              </button>
            </div>
          </div>

          {/* Aranabilir seçim */}
          <div className="min-w-0 flex-1 lg:max-w-sm">
            {type === "supplier" ? (
              <SearchableSelect<SupplierOption>
                value={selectedSupplier}
                onChange={handleSupplierChange}
                search={searchSuppliers}
                queryKey="suppliers"
                getKey={(s) => s.id}
                getLabel={(s) => s.name}
                label="Tedarikçi"
                placeholder="Tedarikçi ara…"
              />
            ) : (
              <SearchableSelect<CustomerOption>
                value={selectedCustomer}
                onChange={handleCustomerChange}
                search={searchCustomers}
                queryKey="customers"
                getKey={(c) => c.id}
                getLabel={(c) => c.companyTitle || c.name}
                getSublabel={(c) =>
                  [c.bayiNo, c.email].filter(Boolean).join(" · ") || null
                }
                label="Bayi"
                placeholder="Bayi ara…"
              />
            )}
          </div>

          {/* Tarih aralığı */}
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Başlangıç
              </label>
              <input
                type="date"
                value={draft.from}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, from: e.target.value }))
                }
                className="h-9 rounded-lg border border-[var(--color-border)] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-navy)]/30"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Bitiş
              </label>
              <input
                type="date"
                value={draft.to}
                onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
                className="h-9 rounded-lg border border-[var(--color-border)] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-navy)]/30"
              />
            </div>
            <button
              type="button"
              onClick={applyRange}
              className="h-9 rounded-lg bg-[var(--color-brand-navy)] px-4 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
            >
              Uygula
            </button>
            {(range.from || range.to) && (
              <button
                type="button"
                onClick={clearRange}
                className="h-9 rounded-lg border border-[var(--color-border)] px-3 text-sm text-slate-600 transition-colors hover:bg-slate-50"
              >
                Temizle
              </button>
            )}
          </div>
        </div>
      </div>

      {/* SEÇİM YOKKEN */}
      {!activeId ? (
        <div className="rounded-2xl border border-dashed border-[var(--color-border)] bg-white p-12 text-center">
          <p className="text-sm font-medium text-slate-600">
            {type === "supplier" ? "Bir tedarikçi" : "Bir bayi"} seçin
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Arama kutusuna isim yazarak başlayın.
          </p>
        </div>
      ) : (
        <>
          {/* BAKİYE ROZETİ */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--color-border)] bg-white px-5 py-4 shadow-sm">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                {type === "supplier" ? "Tedarikçi" : "Bayi"}
              </p>
              <p className="truncate text-base font-semibold text-[var(--color-text)]">
                {data?.entity.name ?? "…"}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Güncel bakiye
              </p>
              <p className={`text-xl font-bold tabular-nums ${balanceTone}`}>
                {formatAmount(balance)}
              </p>
            </div>
          </div>

          {/* HATA */}
          {isError ? (
            <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <span>Hareketler yüklenemedi.</span>
              <button
                type="button"
                onClick={() => refetch()}
                className="font-medium underline"
              >
                Tekrar dene
              </button>
            </div>
          ) : null}

          {/* TABLO */}
          <div className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-3">
              <h3 className="text-sm font-semibold text-[var(--color-brand-navy)]">
                Hareket Dökümü
              </h3>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                {isFetching ? "Yükleniyor…" : `${total} hareket`}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-[var(--color-border)] bg-slate-50/60 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    <th className="px-4 py-3">Tarih</th>
                    <th className="px-4 py-3">Tip</th>
                    <th className="px-4 py-3">Sipariş No</th>
                    <th className="px-4 py-3">Tedarikçi Sip. No</th>
                    <th className="px-4 py-3">Açıklama</th>
                    <th className="px-4 py-3 text-right">Borç</th>
                    <th className="px-4 py-3 text-right">Alacak</th>
                    <th className="px-4 py-3 text-right">Bakiye</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    [...Array(6)].map((_, i) => (
                      <tr key={i} className="border-b border-[var(--color-border)]">
                        <td colSpan={8} className="px-4 py-3">
                          <div className="h-4 w-full animate-pulse rounded bg-slate-100" />
                        </td>
                      </tr>
                    ))
                  ) : rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-4 py-10 text-center text-sm text-slate-400"
                      >
                        Bu dönemde hareket bulunamadı.
                      </td>
                    </tr>
                  ) : (
                    rows.map((row) => (
                      <tr
                        key={row.id}
                        className="border-b border-[var(--color-border)] transition-colors hover:bg-slate-50/80"
                      >
                        <td className="whitespace-nowrap px-4 py-3 text-sm tabular-nums text-slate-600">
                          {formatDate(row.date)}
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                            {ledgerTypeLabel(row.type)}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-[var(--color-brand-navy)]">
                          {row.humanOrderNo ? `#${row.humanOrderNo}` : "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm tabular-nums text-slate-600">
                          {row.supplierOrderNo ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600">
                          {row.description ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-right text-sm tabular-nums text-rose-600">
                          {row.debit ? formatAmount(row.debit) : "—"}
                        </td>
                        <td className="px-4 py-3 text-right text-sm font-medium tabular-nums text-emerald-700">
                          {row.credit ? formatAmount(row.credit) : "—"}
                        </td>
                        <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-[var(--color-text)]">
                          {row.balanceAfter !== null
                            ? formatAmount(row.balanceAfter)
                            : "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* SAYFALAMA */}
            {pageCount > 1 ? (
              <div className="flex items-center justify-between border-t border-[var(--color-border)] px-5 py-3">
                <span className="text-xs text-slate-500">
                  Sayfa {page} / {pageCount}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="h-8 rounded-lg border border-[var(--color-border)] px-3 text-sm text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Önceki
                  </button>
                  <button
                    type="button"
                    disabled={page >= pageCount}
                    onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                    className="h-8 rounded-lg border border-[var(--color-border)] px-3 text-sm text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Sonraki
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
