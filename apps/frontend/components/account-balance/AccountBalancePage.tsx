"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  CreditCard,
  Download,
  ExternalLink,
  Headphones,
  Landmark,
  Loader2,
  MoreVertical,
  RotateCcw,
  Settings,
  Wallet,
} from "lucide-react";

const HISTORY_ANCHOR_ID = "bakiye-odeme-gecmisi";
import { apiCustomer } from "@/lib/auth";
import { ReceiptButton } from "@/components/receipts/ReceiptButton";
import { CardTopupModal } from "./CardTopupModal";
import { CopyButton } from "./CopyButton";
import { RefreshButton } from "./RefreshButton";
import { TopupModal } from "./TopupModal";
import { BalanceSummaryCard, RecentMovementsCard, SuggestionsCard } from "./RightRail";
import { amountClass, barColorClass, toneClasses, valueColorClass } from "./helpers";
import { mapLedgerEntryToHistoryItem } from "./bakiyem-format";
import type { BalanceBankAccount, BalanceLedgerEntry } from "@/lib/customer-api";
import type {
  AccountBalancePageData,
  BalanceHistoryItem,
  BalanceMetric,
  BalanceMetricTone,
  GiftBadge,
} from "./types";

export interface LedgerPageMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface AccountBalancePageProps {
  data: AccountBalancePageData;
  rawBankAccounts: BalanceBankAccount[];
  initialLedgerMeta: LedgerPageMeta;
}

export function AccountBalancePage({
  data,
  rawBankAccounts,
  initialLedgerMeta,
}: AccountBalancePageProps) {
  const primaryBank = data.bankAccounts[0];
  const secondaryBank = data.bankAccounts[1];
  const [modalOpen, setModalOpen] = useState(false);
  const [cardModalOpen, setCardModalOpen] = useState(false);
  const [cardFeeRate, setCardFeeRate] = useState<number | null>(null);
  // Kart ile yükleme sitede açık mı (aktif POS var mı)? false → buton
  // gri/tıklanamaz "ÇOK YAKINDA" (PayTR canlı moda geçene kadar kapalı).
  const [cardAvailable, setCardAvailable] = useState(false);

  // Müşteriye yansıtılan kart komisyon oranı — yalnızca GÖSTERİM için;
  // kesin hesabı backend yapar. Oran alınamazsa döküm satırı gizlenir.
  useEffect(() => {
    let cancelled = false;
    apiCustomer<{ available?: boolean; ratePercent: number | null }>(
      "/payments/paytr/card-fee",
      { general: true },
    )
      .then((res) => {
        if (cancelled) return;
        setCardAvailable(res?.available === true);
        if (typeof res?.ratePercent === "number") {
          setCardFeeRate(res.ratePercent);
        }
      })
      .catch(() => {
        /* oran alınamadı — kart kapalı varsayılır (güvenli taraf) */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-4">
      {modalOpen && (
        <TopupModal
          bankAccounts={rawBankAccounts}
          onClose={() => setModalOpen(false)}
        />
      )}
      {cardModalOpen && cardAvailable && (
        <CardTopupModal
          ratePercent={cardFeeRate}
          onClose={() => setCardModalOpen(false)}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <RefreshButton updatedAt={data.updatedAt} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_280px]">
        <div className="min-w-0 space-y-4">
          <MetricGrid metrics={data.metrics} />

          <div className="grid gap-4 lg:grid-cols-[1.05fr_1fr]">
            <MainBalanceCard
              balance={data.mainBalance}
              trend={data.mainTrend}
              gift={data.gift}
              onOpenTopup={() => setModalOpen(true)}
              onOpenCardTopup={() => setCardModalOpen(true)}
              cardTopupAvailable={cardAvailable}
            />
            {primaryBank ? (
              <BankInfoCard
                primary={primaryBank}
                secondaryBankName={secondaryBank?.bankName ?? null}
              />
            ) : null}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <TopUpMethodsCard cardFeeRate={cardFeeRate} />
            <UsageSummaryCard
              bars={data.usageSummary.bars}
              usedLastThirtyDays={data.usageSummary.usedLastThirtyDays}
              averageOrderDeduction={data.usageSummary.averageOrderDeduction}
              lastTopUp={data.usageSummary.lastTopUp}
              lastTopUpDate={data.usageSummary.lastTopUpDate}
            />
          </div>
        </div>

        <aside className="space-y-4">
          <BalanceSummaryCard data={data.balanceSummary} />
          <RecentMovementsCard movements={data.recentMovements} />
          <SuggestionsCard suggestions={data.suggestions} />
        </aside>
      </div>

      <BalanceHistoryTable
        initialHistory={data.history}
        initialDateRange={data.historyDateRange}
        initialMeta={initialLedgerMeta}
      />
    </div>
  );
}

interface MetricGridProps {
  metrics: BalanceMetric[];
}

function MetricGrid({ metrics }: MetricGridProps) {
  return (
    <div className="grid gap-3 sm:gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {metrics.map((metric) => (
        <MetricCard key={metric.title} metric={metric} />
      ))}
    </div>
  );
}

interface MetricCardProps {
  metric: BalanceMetric;
}

function MetricCard({ metric }: MetricCardProps) {
  return (
    <article className="rounded-2xl border border-[var(--ab-border)] bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div
          className={[
            "flex h-11 w-11 items-center justify-center rounded-2xl",
            toneClasses[metric.tone],
          ].join(" ")}
          aria-hidden="true"
        >
          {metric.tone === "green" ? <Wallet className="h-5 w-5" /> : null}
          {metric.tone === "blue" ? <ArrowUpCircle className="h-5 w-5" /> : null}
          {metric.tone === "orange" ? <ArrowDownCircle className="h-5 w-5" /> : null}
          {metric.tone === "purple" ? <RotateCcw className="h-5 w-5" /> : null}
        </div>

        <Sparkline values={metric.sparkline} tone={metric.tone} />
      </div>

      <p className="mt-3 text-sm font-semibold text-slate-500">{metric.title}</p>
      <p className={["mt-1 text-xl font-black tracking-tight", valueColorClass[metric.tone]].join(" ")}>
        {metric.value}
      </p>
      {metric.description ? (
        <p className="mt-2 text-xs text-slate-500">{metric.description}</p>
      ) : null}
    </article>
  );
}

interface SparklineProps {
  values: number[];
  tone: BalanceMetricTone;
}

function Sparkline({ values, tone }: SparklineProps) {
  const max = Math.max(...values, 1);

  return (
    <div className="flex h-10 items-end gap-1" aria-hidden="true">
      {values.map((value, index) => {
        const heightPercent = Math.max(20, Math.round((value / max) * 100));
        const heightClass =
          heightPercent > 80
            ? "h-8"
            : heightPercent > 60
              ? "h-6"
              : heightPercent > 40
                ? "h-5"
                : "h-3";

        return (
          <span
            key={`${value}-${index}`}
            className={["w-1.5 rounded-full", barColorClass[tone], heightClass].join(" ")}
          />
        );
      })}
    </div>
  );
}

interface MainBalanceCardProps {
  balance: string;
  trend: number[];
  gift: GiftBadge | null;
  onOpenTopup: () => void;
  onOpenCardTopup: () => void;
  /** false → kart ile yükleme kapalı: buton gri/tıklanamaz "ÇOK YAKINDA". */
  cardTopupAvailable: boolean;
}

function MainBalanceCard({
  balance,
  trend,
  gift,
  onOpenTopup,
  onOpenCardTopup,
  cardTopupAvailable,
}: MainBalanceCardProps) {
  const hasTrend = trend.some((v) => v > 0);
  const maxTrend = hasTrend ? Math.max(...trend, 1) : 1;

  return (
    <section className="relative overflow-hidden rounded-3xl bg-[var(--ab-navy)] p-5 text-white shadow-xl shadow-blue-950/10 sm:p-6">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-24 h-52 w-52 rounded-full bg-blue-500/20 blur-2xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-20 left-8 h-40 w-40 rounded-full bg-white/10 blur-2xl"
      />

      <div className="relative flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div>
          {gift ? (
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-emerald-400 to-green-500 px-3 py-1.5 shadow-lg shadow-emerald-900/20">
              <span aria-hidden="true" className="text-base leading-none">🎁</span>
              <span className="text-xs font-black uppercase tracking-[0.2em] text-white">
                Hediye Bakiye
              </span>
              <span className="rounded-full bg-white/25 px-2 py-0.5 text-xs font-black tabular-nums text-white">
                {gift.totalLabel}
              </span>
            </div>
          ) : null}
          <p className="text-sm font-bold text-blue-100">Cari Bakiye</p>
          <p className="mt-5 text-4xl font-black tracking-tight sm:mt-7 sm:text-5xl">{balance}</p>
          <p className="mt-3 max-w-md text-sm font-medium text-blue-50/90">
            {gift
              ? `Toptan Budur tarafından ${gift.totalLabel} hediye bakiye tanımlandı — siparişlerinizde kullanıma hazır.`
              : "Siparişlerinizde kullanıma hazır güncel bakiye."}
          </p>
        </div>

        {hasTrend ? (
          <div className="hidden text-right md:block">
            <p className="text-xs font-semibold text-blue-100">Son Bakiye Trendi</p>
            <div className="mt-10 flex h-16 items-end gap-1.5" aria-hidden="true">
              {trend.map((value, index) => {
                const heightPercent = Math.max(8, Math.round((value / maxTrend) * 100));
                return (
                  <span
                    key={`trend-${index}`}
                    style={{ height: `${heightPercent}%` }}
                    className="w-2 rounded-full bg-white/80"
                  />
                );
              })}
            </div>
          </div>
        ) : null}
      </div>

      <div className="relative mt-6 flex flex-col gap-3 sm:mt-8 sm:flex-row">
        <button
          type="button"
          onClick={onOpenTopup}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3.5 text-sm font-black text-[var(--ab-navy)] transition hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <Wallet className="h-4 w-4" aria-hidden="true" />
          Havale/EFT ile Yükle
        </button>
        <button
          type="button"
          onClick={cardTopupAvailable ? onOpenCardTopup : undefined}
          disabled={!cardTopupAvailable}
          translate="no"
          className={
            cardTopupAvailable
              ? "inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/40 bg-white/10 px-4 py-3.5 text-sm font-black text-white transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
              : "inline-flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/5 px-4 py-3.5 text-sm font-black text-white/40 grayscale"
          }
        >
          <CreditCard className="h-4 w-4" aria-hidden="true" />
          {cardTopupAvailable ? (
            "Kartla Yükle"
          ) : (
            <span className="flex flex-col items-center leading-tight">
              <span>Kartla Yükle</span>
              <span className="text-[11px] font-black uppercase tracking-widest text-white/50">
                DEVRE DIŞI
              </span>
            </span>
          )}
        </button>
      </div>
    </section>
  );
}

interface BankInfoCardProps {
  primary: AccountBalancePageData["bankAccounts"][number];
  secondaryBankName: string | null;
}

function BankInfoCard({ primary, secondaryBankName }: BankInfoCardProps) {
  const rows = [
    { label: "Hesap Sahibi", value: primary.accountHolder },
    { label: "Banka", value: primary.bankName },
    { label: "IBAN", value: primary.iban },
    { label: "Şube", value: primary.branch },
    { label: "Açıklama / Referans", value: primary.reference },
  ];

  return (
    <section className="rounded-3xl border border-[var(--ab-border)] bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-black text-[var(--ab-text)] sm:text-lg">
          Banka Hesap Bilgileri
        </h2>

        {secondaryBankName ? (
          <div className="flex rounded-xl border border-slate-200 bg-slate-50 p-1">
            <button
              type="button"
              className="rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-[var(--ab-blue)] shadow-sm"
            >
              {primary.bankName}
            </button>
            <button
              type="button"
              className="rounded-lg px-3 py-1.5 text-xs font-bold text-slate-500"
            >
              {secondaryBankName}
            </button>
          </div>
        ) : (
          <span className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-[var(--ab-blue)]">
            {primary.bankName}
          </span>
        )}
      </div>

      <div className="divide-y divide-slate-100">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex flex-col gap-2 py-3 text-sm sm:grid sm:grid-cols-[140px_1fr_auto] sm:items-center sm:gap-3"
          >
            <span className="text-xs font-semibold text-slate-500 sm:text-sm">{row.label}</span>
            <span className="break-all font-bold text-[var(--ab-text)]">{row.value}</span>
            <CopyButton value={row.value} label="Kopyala" />
          </div>
        ))}
      </div>
    </section>
  );
}

const CARD_FEE_RATE_FORMATTER = new Intl.NumberFormat("tr-TR", {
  maximumFractionDigits: 2,
});

interface TopUpMethodsCardProps {
  cardFeeRate: number | null;
}

function TopUpMethodsCard({ cardFeeRate }: TopUpMethodsCardProps) {
  const methods = [
    {
      title: "Kredi Kartı ile Yükleme",
      description:
        cardFeeRate != null
          ? `Kart ile bakiye yüklemelerinde %${CARD_FEE_RATE_FORMATTER.format(cardFeeRate)} kart komisyonu uygulanır; tutar anında bakiyenize eklenir.`
          : "Kart ile bakiye yüklemelerinde kart komisyonu uygulanır; tutar anında bakiyenize eklenir.",
      icon: CreditCard,
    },
    {
      title: "Havale / EFT",
      description:
        "Havale/EFT ile yaptığınız yüklemelerde yatırdığınız tutarın tamamı cari bakiyenize eklenir.",
      icon: Landmark,
    },
    {
      title: "Manuel Destek Onayı",
      description: "Destek ekibimiz yüklemenizi kontrol ederek onaylar.",
      icon: Headphones,
    },
    {
      title: "Otomatik Bakiye Tanımlama",
      description: "Onay sonrası bakiyeniz otomatik tanımlanır.",
      icon: Settings,
    },
  ];

  return (
    <section className="rounded-3xl border border-[var(--ab-border)] bg-white p-4 shadow-sm sm:p-5">
      <h2 className="mb-4 text-base font-black text-[var(--ab-text)] sm:text-lg">
        Yükleme Yöntemleri
      </h2>

      <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
        {methods.map((method) => {
          const Icon = method.icon;

          return (
            <div
              key={method.title}
              className="flex gap-3 rounded-2xl border border-slate-100 bg-slate-50/60 p-3 sm:p-4"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-[var(--ab-blue)]">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h3 className="text-sm font-black text-[var(--ab-text)]">{method.title}</h3>
                <p className="mt-1 text-xs leading-5 text-slate-500">{method.description}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

interface UsageSummaryCardProps {
  bars: number[];
  usedLastThirtyDays: string;
  averageOrderDeduction: string;
  lastTopUp: string;
  lastTopUpDate: string;
}

function UsageSummaryCard({
  bars,
  usedLastThirtyDays,
  averageOrderDeduction,
  lastTopUp,
  lastTopUpDate,
}: UsageSummaryCardProps) {
  const items = [
    {
      label: "Son 30 Günde Kullanılan",
      value: usedLastThirtyDays,
      icon: ArrowDownCircle,
      tone: "text-orange-500 bg-orange-50",
    },
    {
      label: "Ortalama Sipariş Kesintisi",
      value: averageOrderDeduction,
      icon: CircleDollarSign,
      tone: "text-blue-500 bg-blue-50",
    },
    {
      label: "Son Yükleme",
      value: lastTopUp,
      icon: ArrowUpCircle,
      tone: "text-green-500 bg-green-50",
    },
    {
      label: "Son Yükleme Tarihi",
      value: lastTopUpDate,
      icon: CalendarDays,
      tone: "text-purple-500 bg-purple-50",
    },
  ];

  const maxBar = Math.max(...bars, 1);

  return (
    <section className="rounded-3xl border border-[var(--ab-border)] bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-black text-[var(--ab-text)] sm:text-lg">
          Bakiye Kullanım Özeti
        </h2>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
        >
          Son 30 Gün
          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[200px_1fr]">
        <div className="space-y-3">
          {items.map((item) => {
            const Icon = item.icon;

            return (
              <div key={item.label} className="flex items-center gap-3">
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${item.tone}`}
                  aria-hidden="true"
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-xs text-slate-500">{item.label}</span>
                  <span className="block truncate text-sm font-black text-[var(--ab-text)]">
                    {item.value}
                  </span>
                </span>
              </div>
            );
          })}
        </div>

        <div
          className="flex h-44 items-end gap-1.5 rounded-2xl bg-slate-50 px-3 pb-4 pt-6 sm:px-4"
          role="img"
          aria-label="Son 30 günün günlük bakiye kullanım grafiği"
        >
          {bars.map((bar, index) => {
            const heightPercent = Math.max(8, Math.round((bar / maxBar) * 100));

            return (
              <span
                key={`${bar}-${index}`}
                style={{ height: `${heightPercent}%` }}
                className="w-full rounded-t-md bg-[var(--ab-blue)]/85"
              />
            );
          })}
        </div>
      </div>
    </section>
  );
}

interface BalanceHistoryTableProps {
  initialHistory: BalanceHistoryItem[];
  initialDateRange: string;
  initialMeta: LedgerPageMeta;
}

type LedgerTypeFilter =
  | ""
  | "TOPUP"
  | "ORDER_PAYMENT"
  | "REFUND"
  | "ADJUSTMENT";
type LedgerStatusFilter = "" | "PENDING" | "APPROVED" | "REJECTED";

interface LedgerApiResponse {
  success: boolean;
  data: BalanceLedgerEntry[];
  meta: LedgerPageMeta;
  error?: string;
}

function BalanceHistoryTable({
  initialHistory,
  initialDateRange,
  initialMeta,
}: BalanceHistoryTableProps) {
  const [history, setHistory] = useState<BalanceHistoryItem[]>(initialHistory);
  const [meta, setMeta] = useState<LedgerPageMeta>(initialMeta);
  const [page, setPage] = useState<number>(initialMeta.page || 1);
  const [type, setType] = useState<LedgerTypeFilter>("");
  const [status, setStatus] = useState<LedgerStatusFilter>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const isInitialMount = useRef(true);

  const pageSize = initialMeta.limit > 0 ? initialMeta.limit : 20;

  const handleExport = useCallback(async () => {
    setExporting(true);
    setExportError(null);
    try {
      const params = new URLSearchParams();
      if (type) params.set("type", type);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const qs = params.toString();
      const res = await fetch(
        `/api/me/cari-balance/statement/export${qs ? `?${qs}` : ""}`,
        {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          headers: {
            accept:
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          },
        },
      );
      if (!res.ok) {
        let message = "Dışa aktarma başarısız oldu";
        try {
          const data = (await res.json()) as { error?: string };
          if (data?.error) message = data.error;
        } catch {
          // binary or empty body — keep generic message
        }
        throw new Error(message);
      }
      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition") ?? "";
      const match = disposition.match(/filename="?([^"]+)"?/i);
      const filename =
        match?.[1] ??
        `bakiye-odeme-gecmisi-${new Date().toISOString().slice(0, 10)}.xlsx`;
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setExportError(
        err instanceof Error ? err.message : "Dışa aktarma başarısız oldu",
      );
    } finally {
      setExporting(false);
    }
  }, [type, from, to]);

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    const controller = new AbortController();

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set("page", String(page));
        params.set("pageSize", String(pageSize));
        if (type) params.set("type", type);
        if (status) params.set("status", status);
        if (from) params.set("from", from);
        if (to) params.set("to", to);

        const res = await fetch(
          `/api/me/cari-balance/ledger?${params.toString()}`,
          {
            method: "GET",
            headers: { accept: "application/json" },
            signal: controller.signal,
            credentials: "include",
            cache: "no-store",
          },
        );
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const body = (await res.json()) as LedgerApiResponse;
        if (!body.success || !Array.isArray(body.data)) {
          throw new Error(body.error ?? "Geçersiz yanıt");
        }
        setHistory(body.data.map(mapLedgerEntryToHistoryItem));
        setMeta(body.meta);
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Beklenmeyen hata");
      } finally {
        setLoading(false);
      }
    }

    void load();

    return () => {
      controller.abort();
    };
  }, [page, type, status, from, to, pageSize]);

  const totalPages = Math.max(1, meta.totalPages || 1);
  const canPrev = page > 1 && !loading;
  const canNext = page < totalPages && !loading;
  const showingFrom =
    meta.total === 0 ? 0 : (meta.page - 1) * meta.limit + 1;
  const showingTo = Math.min(meta.total, meta.page * meta.limit);

  function onFilterChange<T>(setter: (v: T) => void, value: T) {
    setter(value);
    setPage(1);
  }

  return (
    <section
      id={HISTORY_ANCHOR_ID}
      className="scroll-mt-24 rounded-3xl border border-[var(--ab-border)] bg-white p-4 shadow-sm sm:p-5"
    >
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-base font-black text-[var(--ab-text)] sm:text-lg">
            Ödeme Geçmişi
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Tüm bakiye yüklemeleri, sipariş kesintileri ve iade hareketleri.
            {initialDateRange && initialDateRange !== "Kayıt yok"
              ? ` Tüm tarih aralığı: ${initialDateRange}.`
              : ""}
          </p>
        </div>

        <div className="flex flex-col items-start gap-1.5 lg:items-end">
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting}
            aria-busy={exporting}
            className="inline-flex w-fit items-center justify-center gap-2 rounded-xl border border-blue-100 bg-white px-4 py-2.5 text-sm font-bold text-[var(--ab-blue)] transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {exporting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="h-4 w-4" aria-hidden="true" />
            )}
            {exporting ? "Hazırlanıyor…" : "Dışa Aktar"}
          </button>
          {exportError ? (
            <span role="alert" className="text-xs font-semibold text-red-600">
              {exportError}
            </span>
          ) : null}
        </div>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label
            className="mb-1 block text-xs font-bold text-slate-500"
            htmlFor="bakiyem-filter-from"
          >
            Başlangıç Tarihi
          </label>
          <input
            id="bakiyem-filter-from"
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => onFilterChange(setFrom, e.target.value)}
            className="block w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-[var(--ab-text)] focus:border-[var(--ab-blue)] focus:outline-none focus:ring-2 focus:ring-blue-100"
          />
        </div>
        <div>
          <label
            className="mb-1 block text-xs font-bold text-slate-500"
            htmlFor="bakiyem-filter-to"
          >
            Bitiş Tarihi
          </label>
          <input
            id="bakiyem-filter-to"
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => onFilterChange(setTo, e.target.value)}
            className="block w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-[var(--ab-text)] focus:border-[var(--ab-blue)] focus:outline-none focus:ring-2 focus:ring-blue-100"
          />
        </div>
        <div>
          <label
            className="mb-1 block text-xs font-bold text-slate-500"
            htmlFor="bakiyem-filter-type"
          >
            İşlem Türü
          </label>
          <select
            id="bakiyem-filter-type"
            value={type}
            onChange={(e) =>
              onFilterChange(setType, e.target.value as LedgerTypeFilter)
            }
            className="block w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-[var(--ab-text)] focus:border-[var(--ab-blue)] focus:outline-none focus:ring-2 focus:ring-blue-100"
          >
            <option value="">Tümü</option>
            <option value="TOPUP">Bakiye Yüklemesi</option>
            <option value="ORDER_PAYMENT">Ürün Alımı</option>
            <option value="REFUND">İptal Ücreti</option>
            <option value="ADJUSTMENT">Manuel Düzeltme</option>
          </select>
        </div>
        <div>
          <label
            className="mb-1 block text-xs font-bold text-slate-500"
            htmlFor="bakiyem-filter-status"
          >
            Durum
          </label>
          <select
            id="bakiyem-filter-status"
            value={status}
            onChange={(e) =>
              onFilterChange(setStatus, e.target.value as LedgerStatusFilter)
            }
            className="block w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-[var(--ab-text)] focus:border-[var(--ab-blue)] focus:outline-none focus:ring-2 focus:ring-blue-100"
          >
            <option value="">Tümü</option>
            <option value="PENDING">Beklemede</option>
            <option value="APPROVED">Onaylandı</option>
            <option value="REJECTED">Reddedildi</option>
          </select>
        </div>
      </div>

      {error ? (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          Geçmiş yüklenemedi: {error}
        </div>
      ) : null}

      <div className="hidden overflow-hidden rounded-2xl border border-slate-200 md:block">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-black">Tarih</th>
                <th className="px-4 py-3 font-black">İşlem Türü</th>
                <th className="px-4 py-3 font-black">Açıklama</th>
                <th className="px-4 py-3 font-black">Ödeme Yöntemi</th>
                <th className="px-4 py-3 font-black">Tutar</th>
                <th className="px-4 py-3 font-black">Durum</th>
                <th className="px-4 py-3 font-black">Referans No</th>
                <th className="px-4 py-3 font-black" />
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100 bg-white">
              {history.length === 0 && !loading ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-10 text-center text-sm text-slate-500"
                  >
                    Bu filtreyle eşleşen kayıt bulunamadı.
                  </td>
                </tr>
              ) : (
                history.map((item) => (
                  <tr key={item.id} className="transition hover:bg-blue-50/30">
                    <td className="px-4 py-3 font-semibold text-slate-700">{item.date}</td>
                    <td className="px-4 py-3 font-semibold text-[var(--ab-text)]">
                      {item.transactionType}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{item.description}</td>
                    <td className="px-4 py-3 text-slate-600">{item.paymentMethod}</td>
                    <td className={`px-4 py-3 font-black ${amountClass(item.direction)}`}>
                      {item.amount}
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill status={item.status} />
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-600">
                      {item.orderId ? (
                        <Link
                          href={`/hesabim/siparislerim/${item.orderId}`}
                          className="inline-flex items-center gap-1 text-[var(--ab-blue)] underline-offset-2 transition hover:underline"
                          title="Siparişe git"
                        >
                          {item.referenceNo}
                          <ExternalLink
                            className="h-3 w-3"
                            aria-hidden="true"
                          />
                        </Link>
                      ) : (
                        item.referenceNo
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {item.orderId ? (
                        <Link
                          href={`/hesabim/siparislerim/${item.orderId}`}
                          aria-label="Siparişe git"
                          title="Siparişe git"
                          className="inline-flex rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-[var(--ab-blue)]"
                        >
                          <ExternalLink className="h-4 w-4" aria-hidden="true" />
                        </Link>
                      ) : item.hasReceipt && item.topupId ? (
                        <ReceiptButton
                          kind="topup"
                          id={item.topupId}
                          label="Tahsilat makbuzunu görüntüle"
                        />
                      ) : (
                        <button
                          type="button"
                          aria-label="Daha fazla seçenek"
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        >
                          <MoreVertical className="h-4 w-4" aria-hidden="true" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-3 md:hidden">
        {history.length === 0 && !loading ? (
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
            Bu filtreyle eşleşen kayıt bulunamadı.
          </div>
        ) : (
          history.map((item) => (
            <article
              key={item.id}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-black text-[var(--ab-text)]">{item.transactionType}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{item.description}</p>
                </div>
                <p className={`text-sm font-black ${amountClass(item.direction)}`}>{item.amount}</p>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                <div>
                  <span className="block font-semibold text-slate-400">Tarih</span>
                  <span className="font-semibold text-slate-700">{item.date}</span>
                </div>
                <div>
                  <span className="block font-semibold text-slate-400">Yöntem</span>
                  <span className="font-semibold text-slate-700">{item.paymentMethod}</span>
                </div>
                <div>
                  <span className="block font-semibold text-slate-400">Referans</span>
                  {item.orderId ? (
                    <Link
                      href={`/hesabim/siparislerim/${item.orderId}`}
                      className="inline-flex items-center gap-1 break-all font-semibold text-[var(--ab-blue)] underline-offset-2 transition hover:underline"
                      title="Siparişe git"
                    >
                      {item.referenceNo}
                      <ExternalLink
                        className="h-3 w-3 shrink-0"
                        aria-hidden="true"
                      />
                    </Link>
                  ) : (
                    <span className="break-all font-semibold text-slate-700">
                      {item.referenceNo}
                    </span>
                  )}
                </div>
                <div>
                  <span className="block font-semibold text-slate-400">Durum</span>
                  <StatusPill status={item.status} />
                </div>
              </div>

              {item.hasReceipt && item.topupId ? (
                <div className="mt-3 flex justify-end border-t border-slate-100 pt-3">
                  <ReceiptButton
                    kind="topup"
                    id={item.topupId}
                    variant="button"
                    label="Tahsilat makbuzu"
                  />
                </div>
              ) : null}
            </article>
          ))
        )}
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p
          aria-live="polite"
          className="text-xs font-semibold text-slate-500 sm:text-sm"
        >
          {meta.total > 0
            ? `${showingFrom}-${showingTo} / ${meta.total} kayıt`
            : "Toplam 0 kayıt"}
          {loading ? " · Yükleniyor…" : ""}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!canPrev}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            Önceki
          </button>
          <span className="text-xs font-bold text-slate-600 sm:text-sm">
            Sayfa {meta.page} / {totalPages}
          </span>
          <button
            type="button"
            disabled={!canNext}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Sonraki
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  );
}

function StatusPill({ status }: { status: BalanceHistoryItem["status"] }) {
  const className =
    status === "Başarılı"
      ? "bg-green-50 text-green-700"
      : status === "Onaylandı"
        ? "bg-blue-50 text-blue-700"
        : status === "Tamamlandı"
          ? "bg-blue-50 text-blue-700"
          : status === "Reddedildi"
            ? "bg-red-50 text-red-700"
            : "bg-orange-50 text-orange-700";

  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${className}`}>
      {status}
    </span>
  );
}
