import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  CARI_LEDGER_STATUS_FILTERS,
  CARI_LEDGER_STATUS_FILTER_LABELS,
  CARI_LEDGER_TYPE_FILTERS,
  CARI_LEDGER_TYPE_FILTER_LABELS,
  CARI_LEDGER_TYPE_LABELS,
  fetchAdminCariLedger,
  formatLedgerDate,
  formatSignedTRY,
  formatTRY,
  type AdminLedgerEntry,
  type AdminLedgerResponse,
  type CariLedgerStatusFilter,
  type CariLedgerTypeFilter,
  type CariTopupStatus,
} from "../lib/cari-ledger";
import {
  decideAdminCariTopup,
  type AdminTopupDecision,
} from "../lib/cari-topups";
import { formatIban } from "../lib/bank-accounts";
import { formatAmount } from "../lib/format";
import InlineCustomerLedger from "./InlineCustomerLedger";
import { useToast } from "./Toast";
import { canAccess } from "../lib/permissions";

function statusBadgeClass(status: CariTopupStatus | null): string {
  switch (status) {
    case "APPROVED":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "REJECTED":
      return "bg-red-50 text-red-700 border-red-200";
    case "PENDING":
      return "bg-amber-50 text-amber-700 border-amber-200";
    default:
      return "bg-slate-50 text-slate-700 border-slate-200";
  }
}

function statusLabel(entry: AdminLedgerEntry): string {
  if (entry.topupStatus === "PENDING") return "Beklemede";
  if (entry.topupStatus === "REJECTED") return "Reddedildi";
  if (entry.topupStatus === "APPROVED") return "Onaylandı";
  return "Onaylandı";
}

function typeBadgeClass(type: AdminLedgerEntry["type"]): string {
  switch (type) {
    case "TOPUP":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "ADJUSTMENT":
      return "bg-violet-50 text-violet-700 border-violet-200";
    case "ORDER_PAYMENT":
      return "bg-orange-50 text-orange-700 border-orange-200";
    case "REFUND":
      return "bg-teal-50 text-teal-700 border-teal-200";
    default:
      return "bg-slate-50 text-slate-700 border-slate-200";
  }
}

interface DecisionPrompt {
  entry: AdminLedgerEntry;
  decision: AdminTopupDecision;
}

interface DecisionDialogProps {
  prompt: DecisionPrompt;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (note: string) => void;
}

function DecisionDialog({
  prompt,
  busy,
  onCancel,
  onConfirm,
}: DecisionDialogProps): React.ReactElement {
  const [note, setNote] = useState<string>("");
  const isApprove = prompt.decision === "approved";
  const title = isApprove ? "Yüklemeyi onayla" : "Yüklemeyi reddet";
  const helpText = isApprove
    ? `${formatAmount(prompt.entry.amount)} tutarındaki bakiye yüklemesi onaylanacak ve müşteri cari bakiyesine eklenecek.`
    : `${formatAmount(prompt.entry.amount)} tutarındaki bakiye yüklemesi reddedilecek. Müşteriye reddetme nedeni iletilecek.`;
  const confirmLabel = isApprove ? "Onayla" : "Reddet";
  const confirmClass = isApprove
    ? "bg-emerald-600 hover:bg-emerald-700"
    : "bg-red-600 hover:bg-red-700";

  return (
    <div
      className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4"
      onClick={() => {
        if (!busy) onCancel();
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="topup-decision-title"
        className="w-full max-w-lg rounded-xl bg-white shadow-lg border border-[var(--color-border)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-[var(--color-border)]">
          <h2
            id="topup-decision-title"
            className="text-lg font-semibold text-[var(--color-text)]"
          >
            {title}
          </h2>
        </div>
        <div className="px-5 py-4 text-sm text-[var(--color-text)] space-y-3">
          <p>{helpText}</p>
          <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3 text-xs text-[var(--color-text-muted)] space-y-1">
            <div>
              <span className="font-medium text-[var(--color-text)]">
                Müşteri:{" "}
              </span>
              {prompt.entry.customer?.name ?? "—"}
              {prompt.entry.customer?.email
                ? ` (${prompt.entry.customer.email})`
                : ""}
            </div>
            {prompt.entry.bankAccount ? (
              <div>
                <span className="font-medium text-[var(--color-text)]">
                  Banka:{" "}
                </span>
                {prompt.entry.bankAccount.bankName} ·{" "}
                <span className="font-mono">
                  {formatIban(prompt.entry.bankAccount.iban)}
                </span>
              </div>
            ) : null}
            {prompt.entry.customerNote ? (
              <div>
                <span className="font-medium text-[var(--color-text)]">
                  Müşteri notu:{" "}
                </span>
                {prompt.entry.customerNote}
              </div>
            ) : null}
          </div>
          <label className="block">
            <span className="text-xs font-medium text-[var(--color-text-muted)]">
              Yönetici notu (opsiyonel, müşteriye görünür)
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder={
                isApprove
                  ? "Örn: Dekontunuz alındı, bakiyeniz güncellendi."
                  : "Örn: Dekont eşleşmedi, lütfen yeniden gönderin."
              }
              className="mt-1 block w-full rounded-md border border-[var(--color-border)] px-3 py-2 text-sm focus:border-[var(--color-brand-blue)] focus:outline-none focus:ring-1 focus:ring-[var(--color-brand-blue)]"
            />
          </label>
        </div>
        <div className="px-5 py-3 border-t border-[var(--color-border)] flex items-center justify-end gap-2 bg-[var(--color-surface-muted)] rounded-b-xl">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1.5 text-sm hover:bg-[var(--color-surface-muted)] disabled:opacity-60"
          >
            İptal
          </button>
          <button
            type="button"
            onClick={() => onConfirm(note)}
            disabled={busy}
            className={`rounded-md px-3 py-1.5 text-sm text-white disabled:opacity-60 ${confirmClass}`}
          >
            {busy ? "İşleniyor…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

interface LedgerToggleButtonProps {
  expanded: boolean;
  onClick: () => void;
}

function LedgerToggleButton({
  expanded,
  onClick,
}: LedgerToggleButtonProps): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      title={expanded ? "Cari defteri gizle" : "Cari defteri göster"}
      aria-label={expanded ? "Cari defteri gizle" : "Cari defteri göster"}
      aria-expanded={expanded}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors ${
        expanded
          ? "border-blue-200 bg-blue-50 text-blue-700"
          : "border-[var(--color-border)] bg-white text-blue-600 hover:bg-blue-50"
      }`}
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
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    </button>
  );
}

/**
 * Bildirimden (cari yükleme talebi) gelen deep-link: `/cari?topupId=...`.
 * Admin bildirime tıkladığında bu sayfa açılır; aşağıdaki id ilgili talep
 * satırına kaydırılıp vurgulanır ki admin direkt onaylayabilsin.
 */
function readDeepLinkTopupId(): string | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("topupId");
  return value && value.trim().length > 0 ? value : null;
}

interface CariHareketlerPanelProps {
  enabled: boolean;
}

export default function CariHareketlerPanel({
  enabled,
}: CariHareketlerPanelProps): React.ReactElement {
  const queryClient = useQueryClient();
  const toast = useToast();

  // Bildirimden gelen ?topupId — varsa bekleyen talebe odaklan: filtreyi
  // PENDING başlat (talep en üstte/az sayıda olur) ve satırı vurgula.
  const [highlightTopupId, setHighlightTopupId] = useState<string | null>(() =>
    readDeepLinkTopupId(),
  );
  const [statusFilter, setStatusFilter] = useState<CariLedgerStatusFilter>(() =>
    readDeepLinkTopupId() ? "PENDING" : "ALL",
  );
  const [typeFilter, setTypeFilter] = useState<CariLedgerTypeFilter>("ALL");
  const [page, setPage] = useState<number>(1);
  const PAGE_SIZE = 50;
  const [prompt, setPrompt] = useState<DecisionPrompt | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const didFocusTopupRef = useRef<boolean>(false);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, typeFilter]);

  const ledgerQuery = useQuery<AdminLedgerResponse>({
    queryKey: ["admin-cari-ledger", statusFilter, typeFilter, page, PAGE_SIZE],
    queryFn: () =>
      fetchAdminCariLedger({
        status: statusFilter,
        type: typeFilter,
        page,
        pageSize: PAGE_SIZE,
      }),
    enabled,
    placeholderData: (prev) => prev,
  });

  const decideMutation = useMutation({
    mutationFn: ({
      id,
      decision,
      adminNote,
    }: {
      id: string;
      decision: AdminTopupDecision;
      adminNote?: string;
    }) => decideAdminCariTopup(id, decision, adminNote),
    onSuccess: (_data, variables) => {
      toast.push(
        "success",
        variables.decision === "approved"
          ? "Yükleme onaylandı, bakiye güncellendi"
          : "Yükleme reddedildi",
      );
      setPrompt(null);
      void queryClient.invalidateQueries({ queryKey: ["admin-cari-ledger"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-cari-topups"] });
      void queryClient.invalidateQueries({
        queryKey: ["customer-cari-ledger"],
      });
    },
    onError: (err) => {
      toast.push(
        "error",
        err instanceof Error ? err.message : "İşlem başarısız",
      );
    },
  });

  const data = ledgerQuery.data;
  const entries = useMemo(() => data?.data ?? [], [data]);
  const meta = data?.meta;
  const total = meta?.total ?? 0;
  const totalPages = Math.max(meta?.totalPages ?? 1, 1);
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);
  const canPrev = page > 1 && !ledgerQuery.isFetching;
  const canNext = page < totalPages && !ledgerQuery.isFetching;

  // Deep-link: ilgili topup satırı yüklendiğinde bir kez kaydır + URL'i temizle
  // (yenilemede tekrar tetiklenmesin), vurguyu birkaç saniye sonra söndür.
  useEffect(() => {
    if (!highlightTopupId || didFocusTopupRef.current) return;
    if (ledgerQuery.isLoading) return;
    if (!entries.some((e) => e.topupId === highlightTopupId)) return;
    didFocusTopupRef.current = true;

    const selector = `[data-topup-id="${
      typeof CSS !== "undefined" && CSS.escape
        ? CSS.escape(highlightTopupId)
        : highlightTopupId
    }"]`;
    const el = document.querySelector(selector);
    (el as HTMLElement | null)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });

    // ?topupId param'ını URL'den temizle — sayfa yenilenince tekrar odaklanmasın
    if (typeof window !== "undefined") {
      const sp = new URLSearchParams(window.location.search);
      sp.delete("topupId");
      const qs = sp.toString();
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${qs ? `?${qs}` : ""}`,
      );
    }

    const timer = window.setTimeout(() => setHighlightTopupId(null), 5000);
    return () => window.clearTimeout(timer);
  }, [highlightTopupId, entries, ledgerQuery.isLoading]);

  function toggleRow(id: string): void {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section className="flex flex-col min-w-0">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--color-text)]">
            Cari Hareketler
          </h2>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Tüm cari hareketler: yüklemeler, manuel düzeltmeler, sipariş
            ödemeleri ve iadeler tek tabloda.
          </p>
        </div>
        {/* Banka hesapları sayfası ayrı izne bağlı — izinsizde link çıkmaz
            sokak (403 ekranı) olurdu. */}
        {canAccess("banka_bilgileri") ? (
          <Link
            to="/banka-bilgileri"
            className="inline-flex items-center rounded-md border border-[var(--color-border)] bg-white px-2.5 py-1 text-xs text-[var(--color-text)] hover:bg-[var(--color-surface-muted)]"
          >
            Banka hesapları
          </Link>
        ) : null}
      </header>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-1 rounded-lg border border-[var(--color-border)] bg-white p-1">
          <span className="px-2 text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
            Durum
          </span>
          {CARI_LEDGER_STATUS_FILTERS.map((value) => {
            const isActive = statusFilter === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setStatusFilter(value)}
                className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
                  isActive
                    ? "bg-[var(--color-brand-blue)] text-white"
                    : "text-[var(--color-text)] hover:bg-[var(--color-surface-muted)]"
                }`}
                aria-pressed={isActive}
              >
                {CARI_LEDGER_STATUS_FILTER_LABELS[value]}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-1 rounded-lg border border-[var(--color-border)] bg-white p-1">
          <span className="px-2 text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
            Tip
          </span>
          {CARI_LEDGER_TYPE_FILTERS.map((value) => {
            const isActive = typeFilter === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setTypeFilter(value)}
                className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
                  isActive
                    ? "bg-[var(--color-brand-blue)] text-white"
                    : "text-[var(--color-text)] hover:bg-[var(--color-surface-muted)]"
                }`}
                aria-pressed={isActive}
              >
                {CARI_LEDGER_TYPE_FILTER_LABELS[value]}
              </button>
            );
          })}
        </div>
      </div>

      {ledgerQuery.isError ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {ledgerQuery.error instanceof Error
            ? ledgerQuery.error.message
            : "Veri alınamadı"}
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--color-border)] bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
                <tr>
                  <th className="px-3 py-2 text-left">Müşteri</th>
                  <th className="px-3 py-2 text-left">Tip</th>
                  <th className="px-3 py-2 text-left">Tür</th>
                  <th className="px-3 py-2 text-right">Tutar</th>
                  <th className="px-3 py-2 text-right">Sonraki Bakiye</th>
                  <th className="px-3 py-2 text-left">Açıklama</th>
                  <th className="px-3 py-2 text-left">Tarih</th>
                  <th className="px-3 py-2 text-center">Durum</th>
                  <th className="px-3 py-2 text-right">İşlem</th>
                </tr>
              </thead>
              <tbody>
                {ledgerQuery.isLoading ? (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-3 py-8 text-center text-[var(--color-text-muted)]"
                    >
                      Yükleniyor…
                    </td>
                  </tr>
                ) : entries.length === 0 ? (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-3 py-8 text-center text-[var(--color-text-muted)]"
                    >
                      Kayıt bulunamadı
                    </td>
                  </tr>
                ) : (
                  entries.map((e) => {
                    const expanded = expandedRows.has(e.id);
                    const amountClass =
                      e.amount > 0
                        ? "text-emerald-700"
                        : e.amount < 0
                          ? "text-red-600"
                          : "text-[var(--color-text)]";
                    const description = (() => {
                      if (e.type === "TOPUP") {
                        return e.customerNote ?? e.description ?? "—";
                      }
                      return e.description ?? "—";
                    })();
                    return (
                      <>
                        <tr
                          key={e.id}
                          data-topup-id={e.topupId ?? undefined}
                          className={`border-t border-[var(--color-border)] hover:bg-[var(--color-surface-muted)] align-top ${
                            highlightTopupId && e.topupId === highlightTopupId
                              ? "bg-amber-50 ring-2 ring-inset ring-amber-400"
                              : ""
                          }`}
                        >
                          <td className="px-3 py-2">
                            <div className="flex flex-col">
                              {e.customer?.id ? (
                                <Link
                                  to={`/customers/${e.customer.id}`}
                                  className="text-[var(--color-text)] hover:text-[var(--color-brand-blue)] hover:underline font-medium"
                                >
                                  {e.customer.name ?? "—"}
                                </Link>
                              ) : (
                                <span className="text-[var(--color-text)] font-medium">
                                  {e.customer?.name ?? "—"}
                                </span>
                              )}
                              {e.customer?.email ? (
                                <span className="text-xs text-[var(--color-text-muted)]">
                                  {e.customer.email}
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${typeBadgeClass(e.type)}`}
                            >
                              {CARI_LEDGER_TYPE_LABELS[e.type]}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            {e.type === "TOPUP" ? (
                              e.topupMethod === "card" ? (
                                <span
                                  className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700"
                                  title={`Çekilen ${formatTRY(e.topupChargedAmount)} · Komisyon ${formatTRY(e.topupCommissionAmount)}`}
                                >
                                  Kredi Kartı
                                </span>
                              ) : (
                                <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                                  Havale/EFT
                                </span>
                              )
                            ) : e.orderPaymentType === "card" ? (
                              // Sipariş kartla alındı (ORDER_PAYMENT olmaz; iadesi
                              // cariye REFUND olarak düşer) — kart rozeti.
                              <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                                Kredi Kartı
                              </span>
                            ) : e.orderPaymentType === "cari" ? (
                              <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                                Cari Bakiye
                              </span>
                            ) : (
                              <span className="text-xs text-[var(--color-text-muted)]">
                                —
                              </span>
                            )}
                          </td>
                          <td
                            className={`px-3 py-2 text-right tabular-nums font-semibold ${amountClass}`}
                          >
                            {formatSignedTRY(e.amount)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-[var(--color-text-muted)]">
                            {e.balanceAfter === null
                              ? "—"
                              : formatTRY(e.balanceAfter)}
                          </td>
                          <td
                            className="px-3 py-2 text-xs text-[var(--color-text-muted)] max-w-[300px]"
                            title={description}
                          >
                            {e.humanTopupNo ? (
                              <div className="mb-1 text-[11px] font-mono font-semibold tracking-wider text-[var(--color-text)]">
                                {e.humanTopupNo}
                              </div>
                            ) : null}
                            <div className="line-clamp-2">{description}</div>
                            {e.bankAccount ? (
                              <div className="mt-1 font-mono text-[10px]">
                                {e.bankAccount.bankName} ·{" "}
                                {formatIban(e.bankAccount.iban)}
                              </div>
                            ) : null}
                            {e.humanOrderNo ? (
                              <div className="mt-1 text-[10px]">
                                Sipariş: #{e.humanOrderNo}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 text-xs text-[var(--color-text-muted)]">
                            {formatLedgerDate(e.createdAt)}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border ${statusBadgeClass(e.topupStatus)}`}
                            >
                              {statusLabel(e)}
                            </span>
                            {e.adminNote && e.topupStatus !== "PENDING" ? (
                              <div
                                className="mt-1 text-xs italic text-[var(--color-text-muted)] line-clamp-2"
                                title={e.adminNote}
                              >
                                "{e.adminNote}"
                              </div>
                            ) : null}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center justify-end gap-1">
                              {/* Kart yüklemeleri POS tahsilatıyla OTOMATİK sonuçlanır —
                                  manuel Onayla/Reddet gösterilmez (backend de reddeder;
                                  bu, listeleme filtresine karşı ikinci savunma hattı). */}
                              {e.topupStatus === "PENDING" &&
                              e.topupId &&
                              e.topupMethod !== "card" ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setPrompt({
                                        entry: e,
                                        decision: "approved",
                                      })
                                    }
                                    disabled={decideMutation.isPending}
                                    className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs text-white hover:bg-emerald-700 disabled:opacity-60"
                                  >
                                    Onayla
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setPrompt({
                                        entry: e,
                                        decision: "rejected",
                                      })
                                    }
                                    disabled={decideMutation.isPending}
                                    className="rounded-md border border-red-200 bg-white px-2.5 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-60"
                                  >
                                    Reddet
                                  </button>
                                </>
                              ) : null}
                              {e.customer?.id ? (
                                <LedgerToggleButton
                                  expanded={expanded}
                                  onClick={() => toggleRow(e.id)}
                                />
                              ) : null}
                            </div>
                          </td>
                        </tr>
                        {expanded && e.customer?.id ? (
                          <tr
                            key={`${e.id}-expanded`}
                            className="border-t border-[var(--color-border)] bg-[var(--color-surface-muted)]/40"
                          >
                            <td colSpan={9} className="px-3 py-3">
                              <InlineCustomerLedger
                                customerId={e.customer.id}
                                customerName={e.customer.name}
                                currentBalance={e.customer.cariBalance}
                              />
                            </td>
                          </tr>
                        ) : null}
                      </>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
            <div aria-live="polite">
              {total === 0
                ? "Kayıt bulunamadı"
                : `${rangeStart}-${rangeEnd} / ${total} kayıt`}
              {ledgerQuery.isFetching ? " · Yükleniyor…" : null}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={!canPrev}
                className="rounded-md border border-[var(--color-border)] bg-white px-2.5 py-1 text-xs text-[var(--color-text)] hover:bg-[var(--color-surface-muted)] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ← Önceki
              </button>
              <span className="tabular-nums">
                Sayfa {page} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={!canNext}
                className="rounded-md border border-[var(--color-border)] bg-white px-2.5 py-1 text-xs text-[var(--color-text)] hover:bg-[var(--color-surface-muted)] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Sonraki →
              </button>
            </div>
          </div>
        </div>
      )}

      {prompt ? (
        <DecisionDialog
          prompt={prompt}
          busy={decideMutation.isPending}
          onCancel={() => setPrompt(null)}
          onConfirm={(note) => {
            if (!prompt.entry.topupId) return;
            decideMutation.mutate({
              id: prompt.entry.topupId,
              decision: prompt.decision,
              adminNote: note.trim() || undefined,
            });
          }}
        />
      ) : null}
    </section>
  );
}
