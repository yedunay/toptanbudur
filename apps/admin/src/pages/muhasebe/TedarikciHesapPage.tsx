import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRequireAuth } from "../../lib/auth";
import { useDocumentTitle } from "../../lib/useDocumentTitle";
import { formatAmount } from "../../lib/format";
import SearchableSelect from "../../components/SearchableSelect";
import {
  downloadSupplierAccount,
  fetchSupplierAccount,
  searchSuppliers,
  type SupplierOption,
} from "../../lib/muhasebe";
import { EmptyRow, formatDate, StatCard, TableCard, balanceTone } from "./ui";

interface DraftRange {
  from: string;
  to: string;
}

interface UrlState {
  id: string | null;
  from: string;
  to: string;
}

function readUrlState(): UrlState {
  if (typeof window === "undefined") return { id: null, from: "", to: "" };
  const p = new URLSearchParams(window.location.search);
  return {
    id: p.get("id"),
    from: p.get("from") ?? "",
    to: p.get("to") ?? "",
  };
}

function writeUrlState(state: UrlState): void {
  if (typeof window === "undefined") return;
  const p = new URLSearchParams();
  if (state.id) p.set("id", state.id);
  if (state.from) p.set("from", state.from);
  if (state.to) p.set("to", state.to);
  const qs = p.toString();
  window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
}

export default function TedarikciHesapPage(): React.ReactElement | null {
  useDocumentTitle("Tedarikçi Hesap");
  const authed = useRequireAuth();

  const initial = useMemo(() => readUrlState(), []);

  const [selected, setSelected] = useState<SupplierOption | null>(
    initial.id ? { id: initial.id, name: initial.id } : null,
  );
  const [range, setRange] = useState<DraftRange>({
    from: initial.from,
    to: initial.to,
  });
  const [draft, setDraft] = useState<DraftRange>({
    from: initial.from,
    to: initial.to,
  });
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const supplierId = selected?.id ?? null;

  useEffect(() => {
    writeUrlState({ id: supplierId, from: range.from, to: range.to });
  }, [supplierId, range.from, range.to]);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["muhasebe", "tedarikci-hesap", supplierId, range.from, range.to],
    queryFn: () =>
      fetchSupplierAccount(supplierId as string, {
        from: range.from || undefined,
        to: range.to || undefined,
      }),
    enabled: authed && Boolean(supplierId),
    placeholderData: (prev) => prev,
  });

  useEffect(() => {
    if (!data) return;
    setSelected((cur) =>
      cur && cur.id === data.supplier.id && cur.name !== data.supplier.name
        ? { ...cur, name: data.supplier.name }
        : cur,
    );
  }, [data]);

  function applyRange(): void {
    setRange(draft);
  }

  function clearRange(): void {
    const empty = { from: "", to: "" };
    setDraft(empty);
    setRange(empty);
  }

  async function handleExport(): Promise<void> {
    if (!supplierId) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      await downloadSupplierAccount(supplierId, {
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

  return (
    <div className="space-y-6 pb-12">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--color-text)]">
            Tedarikçi Hesap
          </h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Tedarikçi seçin; bakiye yüklemeleri, sipariş alımları ve net hesap
            özetini görün.
          </p>
        </div>
        {supplierId ? (
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

      {/* FİLTRE */}
      <div className="rounded-2xl border border-[var(--color-border)] bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
          <div className="min-w-0 flex-1 lg:max-w-sm">
            <SearchableSelect<SupplierOption>
              value={selected}
              onChange={setSelected}
              search={searchSuppliers}
              queryKey="suppliers"
              getKey={(s) => s.id}
              getLabel={(s) => s.name}
              label="Tedarikçi"
              placeholder="Tedarikçi ara…"
            />
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Başlangıç
              </label>
              <input
                type="date"
                value={draft.from}
                onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
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

      {!supplierId ? (
        <div className="rounded-2xl border border-dashed border-[var(--color-border)] bg-white p-12 text-center">
          <p className="text-sm font-medium text-slate-600">Bir tedarikçi seçin</p>
          <p className="mt-1 text-xs text-slate-400">
            Arama kutusuna isim yazarak başlayın.
          </p>
        </div>
      ) : isError ? (
        <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>Hesap özeti yüklenemedi.</span>
          <button type="button" onClick={() => refetch()} className="font-medium underline">
            Tekrar dene
          </button>
        </div>
      ) : isLoading || !data ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[...Array(8)].map((_, i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-2xl border border-[var(--color-border)] bg-slate-50"
            />
          ))}
        </div>
      ) : (
        <>
          {/* ÖZET */}
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Açılış Bakiyesi" value={data.openingBalance} />
            <StatCard label="Kapanış Bakiyesi" value={data.closingBalance} />
            <StatCard
              label="Güncel Bakiye"
              value={data.currentBalance}
              tone={balanceTone(data.currentBalance)}
            />
            <StatCard label="Net Bakiye" value={data.netBalance} tone="brand" />
            <StatCard label="Toplam Yükleme" value={data.topupTotal} tone="positive" />
            <StatCard label="Toplam Alım" value={data.purchaseTotal} tone="negative" />
            <StatCard label="Toplam İade" value={data.refundTotal} />
            <StatCard label="Düzeltme (Net)" value={data.adjustmentNet} />
          </section>

          {/* MUTABAKAT BANNER (Bayi Hesap ile aynı kimlik) */}
          {data.reconciliation ? (
            <div
              className={`flex flex-wrap items-center justify-between gap-4 rounded-2xl border px-5 py-4 shadow-sm ${
                data.reconciliation.consistent
                  ? "border-emerald-200 bg-emerald-50"
                  : "border-amber-200 bg-amber-50"
              }`}
            >
              <div className="flex items-center gap-3">
                <span
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-full text-base ${
                    data.reconciliation.consistent
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-amber-100 text-amber-700"
                  }`}
                  aria-hidden
                >
                  {data.reconciliation.consistent ? "✓" : "!"}
                </span>
                <div>
                  <p className="text-sm font-semibold text-[var(--color-text)]">
                    {data.reconciliation.consistent
                      ? "Tedarikçi hesabı mutabık"
                      : "Mutabakat farkı var — kontrol et"}
                  </p>
                  <p className="text-xs text-slate-500">
                    Açılış + Giriş {formatAmount(data.reconciliation.inflow)} − Çıkış{" "}
                    {formatAmount(data.reconciliation.outflow)} = Beklenen{" "}
                    {formatAmount(data.reconciliation.expectedClosing)} · Gerçek{" "}
                    {formatAmount(data.reconciliation.closingBalance)}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Fark
                </p>
                <p
                  className={`text-lg font-bold tabular-nums ${
                    data.reconciliation.consistent
                      ? "text-emerald-700"
                      : "text-amber-700"
                  }`}
                >
                  {formatAmount(data.reconciliation.diff)}
                </p>
              </div>
            </div>
          ) : null}

          {isFetching ? (
            <p className="text-xs text-slate-400">Güncelleniyor…</p>
          ) : null}

          {/* YÜKLEMELER */}
          <TableCard title="Bakiye Yüklemeleri" count={data.topups.length}>
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-slate-50/60 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  <th className="px-4 py-3">Tarih</th>
                  <th className="px-4 py-3">Açıklama</th>
                  <th className="px-4 py-3 text-right">Tutar</th>
                </tr>
              </thead>
              <tbody>
                {data.topups.length === 0 ? (
                  <EmptyRow colSpan={3} text="Bu dönemde yükleme yok." />
                ) : (
                  data.topups.map((t) => (
                    <tr
                      key={t.id}
                      className="border-b border-[var(--color-border)] transition-colors hover:bg-slate-50/80"
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-sm tabular-nums text-slate-600">
                        {formatDate(t.date)}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {t.description ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-medium tabular-nums text-emerald-700">
                        {formatAmount(t.amount)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </TableCard>

          {/* ALIMLAR */}
          <TableCard title="Sipariş Alımları" count={data.purchases.length}>
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-slate-50/60 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  <th className="px-4 py-3">Tarih</th>
                  <th className="px-4 py-3">Sipariş No</th>
                  <th className="px-4 py-3">Tedarikçi Sip. No</th>
                  <th className="px-4 py-3">Açıklama</th>
                  <th className="px-4 py-3 text-right">Tutar</th>
                </tr>
              </thead>
              <tbody>
                {data.purchases.length === 0 ? (
                  <EmptyRow colSpan={5} text="Bu dönemde alım yok." />
                ) : (
                  data.purchases.map((p) => (
                    <tr
                      key={p.id}
                      className="border-b border-[var(--color-border)] transition-colors hover:bg-slate-50/80"
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-sm tabular-nums text-slate-600">
                        {formatDate(p.date)}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-[var(--color-brand-navy)]">
                        {p.humanOrderNo ? `#${p.humanOrderNo}` : "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm tabular-nums text-slate-600">
                        {p.supplierOrderNo ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {p.description ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-medium tabular-nums text-rose-600">
                        {formatAmount(p.amount)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </TableCard>

          {/* İADELER / İPTALLER — sipariş iptal/iadesinde cüzdana geri yüklenen.
              Eskiden yalnız "Toplam İade" rakamı vardı; artık kalem kalem. */}
          <TableCard
            title="Sipariş İadeleri / İptalleri"
            count={data.refunds?.length ?? 0}
          >
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-slate-50/60 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  <th className="px-4 py-3">Tarih</th>
                  <th className="px-4 py-3">Sipariş No</th>
                  <th className="px-4 py-3">Tedarikçi Sip. No</th>
                  <th className="px-4 py-3">Açıklama</th>
                  <th className="px-4 py-3 text-right">İade Tutarı</th>
                </tr>
              </thead>
              <tbody>
                {!data.refunds || data.refunds.length === 0 ? (
                  <EmptyRow colSpan={5} text="Bu dönemde iade / iptal yok." />
                ) : (
                  data.refunds.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-[var(--color-border)] transition-colors hover:bg-slate-50/80"
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-sm tabular-nums text-slate-600">
                        {formatDate(r.date)}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-[var(--color-brand-navy)]">
                        {r.humanOrderNo ? `#${r.humanOrderNo}` : "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm tabular-nums text-slate-600">
                        {r.supplierOrderNo ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {r.description ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-medium tabular-nums text-emerald-700">
                        {formatAmount(r.amount)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </TableCard>
        </>
      )}
    </div>
  );
}
