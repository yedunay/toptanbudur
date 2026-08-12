import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRequireAuth } from "../../lib/auth";
import { useDocumentTitle } from "../../lib/useDocumentTitle";
import { formatAmount } from "../../lib/format";
import SearchableSelect from "../../components/SearchableSelect";
import {
  downloadDealerAccount,
  fetchDealerAccount,
  searchCustomers,
  type CustomerOption,
} from "../../lib/muhasebe";
import { EmptyRow, formatDate, ReconLine, StatCard, TableCard, balanceTone } from "./ui";

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

export default function BayiHesapPage(): React.ReactElement | null {
  useDocumentTitle("Bayi Hesap");
  const authed = useRequireAuth();

  const initial = useMemo(() => readUrlState(), []);

  const [selected, setSelected] = useState<CustomerOption | null>(
    initial.id
      ? { id: initial.id, name: initial.id, companyTitle: null, email: "", bayiNo: null }
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
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const customerId = selected?.id ?? null;

  useEffect(() => {
    writeUrlState({ id: customerId, from: range.from, to: range.to });
  }, [customerId, range.from, range.to]);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["muhasebe", "bayi-hesap", customerId, range.from, range.to],
    queryFn: () =>
      fetchDealerAccount(customerId as string, {
        from: range.from || undefined,
        to: range.to || undefined,
      }),
    enabled: authed && Boolean(customerId),
    placeholderData: (prev) => prev,
  });

  useEffect(() => {
    if (!data) return;
    setSelected((cur) =>
      cur && cur.id === data.customer.id && cur.name === cur.id
        ? {
            id: data.customer.id,
            name: data.customer.name,
            companyTitle: data.customer.companyTitle,
            email: data.customer.email,
            bayiNo: data.customer.bayiNo,
          }
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
    if (!customerId) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      await downloadDealerAccount(customerId, {
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

  const reconciliation = data?.reconciliation;

  return (
    <div className="space-y-6 pb-12">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--color-text)]">
            Bayi Hesap
          </h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Bayi seçin; sipariş alımları, bakiye yüklemeleri, fatura toplamı ve
            mutabakat farkını görün.
          </p>
        </div>
        {customerId ? (
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
            <SearchableSelect<CustomerOption>
              value={selected}
              onChange={setSelected}
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

      {!customerId ? (
        <div className="rounded-2xl border border-dashed border-[var(--color-border)] bg-white p-12 text-center">
          <p className="text-sm font-medium text-slate-600">Bir bayi seçin</p>
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
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-2xl border border-[var(--color-border)] bg-slate-50"
            />
          ))}
        </div>
      ) : (
        <>
          {/* MUTABAKAT BANNER */}
          {reconciliation ? (
            <div
              className={`flex flex-wrap items-center justify-between gap-4 rounded-2xl border px-5 py-4 shadow-sm ${
                reconciliation.consistent
                  ? "border-emerald-200 bg-emerald-50"
                  : "border-amber-200 bg-amber-50"
              }`}
            >
              <div className="flex items-center gap-3">
                <span
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-full text-base ${
                    reconciliation.consistent
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-amber-100 text-amber-700"
                  }`}
                  aria-hidden
                >
                  {reconciliation.consistent ? "✓" : "!"}
                </span>
                <div>
                  <p className="text-sm font-semibold text-[var(--color-text)]">
                    {reconciliation.consistent
                      ? "Hesap mutabık"
                      : "Mutabakat farkı var — kontrol et"}
                  </p>
                  <p className="text-xs text-slate-500">
                    Açılış + Giriş {formatAmount(reconciliation.inflow)} − Çıkış{" "}
                    {formatAmount(reconciliation.outflow)} = Beklenen{" "}
                    {formatAmount(reconciliation.expectedClosing)} · Gerçek{" "}
                    {formatAmount(reconciliation.closingBalance)}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Fark
                </p>
                <p
                  className={`text-lg font-bold tabular-nums ${
                    reconciliation.consistent ? "text-emerald-700" : "text-amber-700"
                  }`}
                >
                  {formatAmount(reconciliation.diff)}
                </p>
              </div>
            </div>
          ) : null}

          {/* MUTABAKAT — KALEM KALEM (kart dahil; her iki tarafta yer alıp götürür) */}
          <div className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-white shadow-sm">
            <div className="border-b border-[var(--color-border)] px-5 py-3">
              <h3 className="text-sm font-semibold text-[var(--color-brand-navy)]">
                Mutabakat Dökümü (Kalem Kalem)
              </h3>
              <p className="mt-0.5 text-[11px] text-slate-400">
                Açılış + tüm girişler − tüm çıkışlar = kapanış bakiyesi. Kart
                ödemeleri hem giriş hem çıkışta yer alır (cari bakiyeyi değiştirmez).
              </p>
            </div>
            <div className="divide-y divide-[var(--color-border)] text-sm">
              <ReconLine label="Dönem Başı Bakiye" value={data.openingBalance} bold />
              <ReconLine label="Havale/EFT ile Yükleme" value={data.topupHavaleTotal} sign="+" />
              <ReconLine label="Kart ile Yükleme (cariye)" value={data.topupCardTotal} sign="+" />
              <ReconLine label="Kart ile Sipariş Ödemesi" value={data.cardOrderTotal} sign="+" />
              <ReconLine label="İade (cariye dönen)" value={data.refundTotal} sign="+" />
              {data.adjustmentNet ? (
                <ReconLine label="Düzeltme (net)" value={data.adjustmentNet} sign="±" />
              ) : null}
              <ReconLine label="Cari Bakiyeden Sipariş Ödemeleri" value={data.cariPaymentTotal} sign="−" />
              <ReconLine label="Kart ile Sipariş Ödemeleri" value={data.cardOrderTotal} sign="−" />
              <ReconLine label="Beklenen Kapanış (Giriş − Çıkış)" value={reconciliation?.expectedClosing ?? 0} bold />
              <ReconLine label="Gerçek Dönem Sonu Bakiye" value={data.closingBalance} bold />
              <ReconLine
                label={reconciliation?.consistent ? "Fark (mutabık ✓)" : "Fark (kontrol et!)"}
                value={reconciliation?.diff ?? 0}
                bold
                highlight={reconciliation?.consistent ? "ok" : "warn"}
              />
            </div>
          </div>

          {/* BAKİYELER + İŞ HACMİ */}
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <StatCard
              label="Güncel Bakiye"
              value={data.currentBalance}
              tone={balanceTone(data.currentBalance)}
            />
            <StatCard
              label="Toplam Sipariş (cari + kart)"
              value={data.purchaseTotal}
              tone="brand"
              hint="Cari ile ödenen + kart ile ödenen"
            />
            <StatCard
              label="Toplam Yükleme"
              value={data.topupTotal}
              tone="positive"
              hint="Onaylı havale + kart"
            />
            <StatCard
              label="Cari ile Ödenen Sipariş"
              value={data.cariPaymentTotal}
              tone="neutral"
            />
            <StatCard
              label="Kart ile Ödenen Sipariş"
              value={data.cardOrderTotal}
              tone="neutral"
            />
            <StatCard
              label="Fatura Kesilen"
              value={data.invoiceTotal}
              tone="brand"
              hint="Belge metriği"
            />
          </section>

          {isFetching ? (
            <p className="text-xs text-slate-400">Güncelleniyor…</p>
          ) : null}

          {/* SİPARİŞLER */}
          <TableCard title="Siparişler" count={data.orders.length}>
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-slate-50/60 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  <th className="px-4 py-3">Tarih</th>
                  <th className="px-4 py-3">Sipariş No</th>
                  <th className="px-4 py-3">Tedarikçi Sip. No</th>
                  <th className="px-4 py-3">Ödeme</th>
                  <th className="px-4 py-3">Durum</th>
                  <th className="px-4 py-3">Fatura</th>
                  <th className="px-4 py-3 text-right">Tutar</th>
                </tr>
              </thead>
              <tbody>
                {data.orders.length === 0 ? (
                  <EmptyRow colSpan={7} text="Bu dönemde sipariş yok." />
                ) : (
                  data.orders.map((o) => (
                    <tr
                      key={o.id}
                      className="border-b border-[var(--color-border)] transition-colors hover:bg-slate-50/80"
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-sm tabular-nums text-slate-600">
                        {formatDate(o.date)}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-[var(--color-brand-navy)]">
                        #{o.humanOrderNo}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm tabular-nums text-slate-600">
                        {o.supplierOrderNo ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {o.paymentType ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">{o.status}</td>
                      <td className="px-4 py-3 text-sm">
                        {o.invoiceUrl ? (
                          <a
                            href={o.invoiceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-[var(--color-brand-blue,#0f62fe)] underline"
                          >
                            {o.invoiceNumber ?? "Görüntüle"}
                          </a>
                        ) : o.invoiceNumber ? (
                          <span className="text-slate-600">{o.invoiceNumber}</span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-medium tabular-nums text-[var(--color-text)]">
                        {formatAmount(o.total)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </TableCard>

          {/* YÜKLEMELER */}
          <TableCard title="Bakiye Yüklemeleri" count={data.topups.length}>
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-slate-50/60 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  <th className="px-4 py-3">Tarih</th>
                  <th className="px-4 py-3">Makbuz</th>
                  <th className="px-4 py-3">Yöntem</th>
                  <th className="px-4 py-3">Kaynak</th>
                  <th className="px-4 py-3">Durum</th>
                  <th className="px-4 py-3 text-right">Tutar</th>
                </tr>
              </thead>
              <tbody>
                {data.topups.length === 0 ? (
                  <EmptyRow colSpan={6} text="Bu dönemde yükleme yok." />
                ) : (
                  data.topups.map((t) => (
                    <tr
                      key={t.id}
                      className="border-b border-[var(--color-border)] transition-colors hover:bg-slate-50/80"
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-sm tabular-nums text-slate-600">
                        {formatDate(t.date)}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-[var(--color-brand-navy)]">
                        {t.humanTopupNo ? `#${t.humanTopupNo}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">{t.method}</td>
                      <td className="px-4 py-3 text-sm text-slate-600">{t.source}</td>
                      <td className="px-4 py-3 text-sm text-slate-600">{t.status}</td>
                      <td className="px-4 py-3 text-right text-sm font-medium tabular-nums text-emerald-700">
                        {formatAmount(t.amount)}
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
