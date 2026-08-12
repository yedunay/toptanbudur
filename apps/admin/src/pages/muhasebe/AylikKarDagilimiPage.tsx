import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRequireAuth } from "../../lib/auth";
import { useDocumentTitle } from "../../lib/useDocumentTitle";
import { useToast } from "../../components/Toast";
import { fetchMonthlyPanel, downloadMonthlyXlsx, downloadMonthlyPdf } from "../../lib/finance";
import MonthPicker, { monthLabel } from "../../components/finance/MonthPicker";
import FinanceKpiCard from "../../components/finance/FinanceKpiCard";
import ManualEntryPanel from "../../components/finance/ManualEntryPanel";
import ExpensesCard from "../../components/finance/ExpensesCard";
import PartnerTrackingCard from "../../components/finance/PartnerTrackingCard";
import DistributionPanel from "../../components/finance/DistributionPanel";
import PartnerCapitalCard from "../../components/finance/PartnerCapitalCard";
import CashFlowChart from "../../components/finance/CashFlowChart";
import RecentTransactionsCard from "../../components/finance/RecentTransactionsCard";
import CalculationDetailModal from "../../components/finance/CalculationDetailModal";

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function readMonth(): string {
  if (typeof window === "undefined") return currentMonth();
  const m = new URLSearchParams(window.location.search).get("month");
  return m && /^\d{4}-(0[1-9]|1[0-2])$/.test(m) ? m : currentMonth();
}

export default function AylikKarDagilimiPage(): React.ReactElement | null {
  useDocumentTitle("Aylık Kâr Dağılımı");
  const authed = useRequireAuth();
  const toast = useToast();

  const [month, setMonth] = useState<string>(() => readMonth());
  const [entryOpen, setEntryOpen] = useState(false);
  const [traceOpen, setTraceOpen] = useState(false);
  const [busy, setBusy] = useState<"xlsx" | "pdf" | null>(null);

  useEffect(() => {
    const qs = new URLSearchParams();
    qs.set("month", month);
    window.history.replaceState(null, "", `?${qs.toString()}`);
  }, [month]);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["finance", "monthly", month],
    queryFn: () => fetchMonthlyPanel(month),
    enabled: authed,
    placeholderData: (prev) => prev,
  });

  const partnerOptions = useMemo(
    () => (data?.partners ?? []).map((p) => ({ id: p.id, name: p.name })),
    [data],
  );

  async function handleDownload(kind: "xlsx" | "pdf") {
    setBusy(kind);
    try {
      if (kind === "xlsx") await downloadMonthlyXlsx(month);
      else await downloadMonthlyPdf(month);
    } catch (e) {
      toast.push("error", e instanceof Error ? e.message : "İndirilemedi.");
    } finally {
      setBusy(null);
    }
  }

  if (!authed) return null;

  return (
    <div className="space-y-5 pb-12">
      {/* ── Üst bar ─────────────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <img
            src={`${import.meta.env.BASE_URL}toptanbudur-logo.webp`}
            alt=""
            className="h-9 w-9 rounded-lg"
            onError={(e) => ((e.currentTarget.style.display = "none"))}
          />
          <div>
            <div className="text-lg font-extrabold leading-tight text-[var(--color-brand-navy)]">
              Toptan <span className="text-[var(--color-brand-blue)]">Budur</span>
            </div>
            <h1 className="text-sm font-semibold text-[var(--color-text)]">
              Aylık Finans ve Ortak Dağılım Paneli
            </h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MonthPicker value={month} onChange={setMonth} />
          <button
            type="button"
            onClick={() => setTraceOpen(true)}
            disabled={!data}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-white px-3 text-sm font-semibold text-[var(--color-brand-navy)] shadow-sm hover:bg-slate-50 disabled:opacity-50"
            title="Hesaplamanın nasıl yapıldığını gör"
          >
            ℹ️ Hesaplama Detayı
          </button>
          <button
            type="button"
            onClick={() => handleDownload("xlsx")}
            disabled={busy !== null}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-50"
          >
            {busy === "xlsx" ? "…" : "Excel İndir"}
          </button>
          <button
            type="button"
            onClick={() => handleDownload("pdf")}
            disabled={busy !== null}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-rose-600 px-3 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-50"
          >
            {busy === "pdf" ? "…" : "PDF Aktar"}
          </button>
        </div>
      </header>

      {isError ? (
        <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>Panel yüklenemedi.</span>
          <button type="button" onClick={() => refetch()} className="font-medium underline">
            Tekrar dene
          </button>
        </div>
      ) : isLoading || !data ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[...Array(12)].map((_, i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-2xl border border-[var(--color-border)] bg-slate-50"
            />
          ))}
        </div>
      ) : (
        <>
          {/* ── Toptan Budur ─────────────────────────────────────────────────── */}
          <section>
            <div className="mb-2 flex items-center gap-2">
              <h2 className="text-sm font-bold text-[var(--color-brand-navy)]">
                Toptan Budur
              </h2>
              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-600">
                Otomatik
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <FinanceKpiCard variant="revenue" label="Gelen Tutar" value={data.bayi.current.gelen} delta={data.bayi.delta.gelen} />
              <FinanceKpiCard variant="cost" label="Giden Tutar" value={data.bayi.current.giden} delta={data.bayi.delta.giden} />
              <FinanceKpiCard variant="profit" label="Kâr" value={data.bayi.current.kar} delta={data.bayi.delta.kar} />
              <FinanceKpiCard variant="kdv" label="KDV Farkı" value={data.bayi.current.kdvFarki} delta={data.bayi.delta.kdvFarki} />
            </div>
          </section>

          {/* ── Manuel Gelir/Gider ───────────────────────────────────────────── */}
          <section>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-[var(--color-brand-navy)]">
                  Manuel Gelir/Gider
                </h2>
                <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-600">
                  Elle giriş
                </span>
              </div>
              <button
                type="button"
                onClick={() => setEntryOpen(true)}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--color-brand-blue)] px-3 text-xs font-semibold text-white shadow-sm hover:opacity-90"
              >
                + Gelir / Gider Ekle
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <FinanceKpiCard variant="revenue" label="Gelen Tutar" value={data.entegrasyon.current.gelen} delta={data.entegrasyon.delta.gelen} />
              <FinanceKpiCard variant="cost" label="Giden Tutar" value={data.entegrasyon.current.giden} delta={data.entegrasyon.delta.giden} />
              <FinanceKpiCard variant="profit" label="Kâr" value={data.entegrasyon.current.kar} delta={data.entegrasyon.delta.kar} />
              <FinanceKpiCard variant="kdv" label="KDV Farkı" value={data.entegrasyon.current.kdvFarki} delta={data.entegrasyon.delta.kdvFarki} />
            </div>
          </section>

          {/* ── Toplam Finans Özeti ──────────────────────────────────────────── */}
          <section>
            <h2 className="mb-2 text-sm font-bold text-[var(--color-brand-navy)]">
              Toplam Finans Özeti
            </h2>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <FinanceKpiCard variant="revenue" label="Toplam Gelen Tutar" value={data.toplam.gelen} />
              <FinanceKpiCard variant="cost" label="Toplam Giden Tutar" value={data.toplam.giden} />
              <FinanceKpiCard variant="profit" label="Toplam Kâr" value={data.toplam.kar} />
              <FinanceKpiCard variant="kdv" label="Toplam KDV Farkı" value={data.toplam.kdvFarki} />
            </div>
          </section>

          {isFetching ? <p className="text-xs text-slate-400">Güncelleniyor…</p> : null}

          {/* ── Masraflar + Ortak Takibi ─────────────────────────────────────── */}
          <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <ExpensesCard
                month={month}
                partners={partnerOptions}
                recurring={data.expenses.recurring}
                oneTime={data.expenses.oneTime}
                total={data.expenses.total}
              />
            </div>
            <PartnerTrackingCard partners={data.distribution.partners} />
          </section>

          {/* ── Dağılım ──────────────────────────────────────────────────────── */}
          <DistributionPanel distribution={data.distribution} />

          {/* ── Nakit Akışı + Son İşlemler ───────────────────────────────────── */}
          <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <CashFlowChart data={data.trend} />
            <RecentTransactionsCard transactions={data.recentTransactions} />
          </section>

          {/* ── Ortak Bakiyeleri ve Döner Sermaye (en alt) ───────────────────── */}
          <PartnerCapitalCard capital={data.capital} partners={partnerOptions} />
        </>
      )}

      {data ? (
        <ManualEntryPanel
          month={month}
          monthLabel={monthLabel(month)}
          open={entryOpen}
          onClose={() => setEntryOpen(false)}
        />
      ) : null}
      {data && traceOpen ? (
        <CalculationDetailModal trace={data.trace} onClose={() => setTraceOpen(false)} />
      ) : null}
    </div>
  );
}
