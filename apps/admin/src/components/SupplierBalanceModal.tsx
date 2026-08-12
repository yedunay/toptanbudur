import { useEffect, useState } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { ArrowDownCircle, ArrowUpCircle } from "lucide-react";
import {
  adjustSupplier,
  fetchSupplierAccount,
  fetchSupplierLedger,
  setSupplierBalance,
  setSupplierThreshold,
  topUpSupplier,
  LEDGER_TYPE_LABELS,
  type SupplierLedgerEntry,
} from "../lib/supplier-balance";
import { formatTRY } from "../lib/products";
import { useToast } from "./Toast";

type Mode = "topup" | "set" | "adjust" | "threshold";

interface SupplierBalanceModalProps {
  supplierId: string;
  supplierName?: string;
  onClose: () => void;
}

const MODE_TABS: ReadonlyArray<{ key: Mode; label: string }> = [
  { key: "topup", label: "Para Girişi" },
  { key: "set", label: "Bakiye Ayarla" },
  { key: "adjust", label: "Düzeltme" },
  { key: "threshold", label: "Uyarı Eşiği" },
];

// Tam geçmiş erişimi: hareketler sayfa sayfa gezilir (eskiden sadece ilk 20
// gösteriliyordu — kullanıcı "hepsini görmem lazım" dedi).
const LEDGER_PAGE_SIZE = 25;

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("tr-TR", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function SupplierBalanceModal({
  supplierId,
  supplierName,
  onClose,
}: SupplierBalanceModalProps): React.ReactElement {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [mode, setMode] = useState<Mode>("topup");
  const [value, setValue] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<number>(1);

  // Farklı tedarikçiye geçilince sayfayı başa al.
  useEffect(() => {
    setPage(1);
  }, [supplierId]);

  const accountQuery = useQuery({
    queryKey: ["supplier-account", supplierId],
    queryFn: () => fetchSupplierAccount(supplierId),
  });

  const ledgerQuery = useQuery({
    queryKey: ["supplier-ledger", supplierId, page],
    queryFn: () =>
      fetchSupplierLedger(supplierId, { page, pageSize: LEDGER_PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  const account = accountQuery.data;

  const invalidateAll = (): void => {
    void queryClient.invalidateQueries({ queryKey: ["supplier-account", supplierId] });
    void queryClient.invalidateQueries({ queryKey: ["supplier-ledger", supplierId] });
    void queryClient.invalidateQueries({ queryKey: ["supplier-balance", "summary"] });
    void queryClient.invalidateQueries({ queryKey: ["suppliers"] });
  };

  const mutation = useMutation({
    mutationFn: async (): Promise<void> => {
      const amount = Number(value);
      if (mode === "topup") {
        if (!Number.isFinite(amount) || amount <= 0) {
          throw new Error("Pozitif bir tutar gir");
        }
        await topUpSupplier(supplierId, {
          amount,
          description: note.trim() || undefined,
        });
      } else if (mode === "set") {
        if (!Number.isFinite(amount) || amount < 0) {
          throw new Error("Geçerli bir bakiye gir (0 veya daha büyük)");
        }
        await setSupplierBalance(supplierId, {
          newBalance: amount,
          reason: note.trim() || undefined,
        });
      } else if (mode === "adjust") {
        if (!Number.isFinite(amount) || amount === 0) {
          throw new Error("Sıfırdan farklı bir tutar gir (eksi/artı)");
        }
        await adjustSupplier(supplierId, {
          amount,
          reason: note.trim() || undefined,
        });
      } else {
        if (!Number.isFinite(amount) || amount < 0) {
          throw new Error("Geçerli bir eşik gir (0 veya daha büyük)");
        }
        await setSupplierThreshold(supplierId, { threshold: amount });
      }
    },
    onSuccess: () => {
      const label = MODE_TABS.find((t) => t.key === mode)?.label ?? "İşlem";
      toast.push("success", `${label} kaydedildi`);
      setValue("");
      setNote("");
      setError(null);
      invalidateAll();
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : "İşlem başarısız");
    },
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    setError(null);
    mutation.mutate();
  };

  const saving = mutation.isPending;
  const ledgerRows = ledgerQuery.data?.rows ?? [];
  const ledgerTotal = ledgerQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(ledgerTotal / LEDGER_PAGE_SIZE));

  const amountHint: Record<Mode, string> = {
    topup: "Tedarikçi sitesine yatırdığın tutarı buraya gir (artı).",
    set: "Tedarikçi sitesindeki güncel bakiyeyi birebir gir.",
    adjust: "Eksi (-) düşer, artı (+) ekler. Manuel düzeltme için.",
    threshold: "Bakiye bu tutarın altına inince kırmızı uyarı + mail.",
  };

  const isLow = account?.isLow ?? false;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-white shadow-xl">
        {/* Header */}
        <header className="flex items-start justify-between border-b border-[var(--color-border)] px-6 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-[var(--color-text)]">
              {supplierName ?? account?.supplierName ?? "Tedarikçi"} — Bakiye
            </h2>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Tedarikçi sitesindeki cüzdan bakiyesi · kâr/maliyetten bağımsız
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)]"
            aria-label="Kapat"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {/* Güncel bakiye kartı */}
          <div className="px-6 pt-5">
            <div
              className={`flex items-center justify-between rounded-xl border px-4 py-3.5 ${
                isLow ? "border-rose-200 bg-rose-50" : "border-slate-200 bg-slate-50"
              }`}
            >
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Güncel bakiye
                </p>
                <p
                  className={`text-2xl font-semibold tabular-nums ${
                    isLow ? "text-rose-700" : "text-slate-900"
                  }`}
                >
                  {account ? formatTRY(account.balance) : "—"}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Uyarı eşiği
                </p>
                <p className="text-sm font-medium tabular-nums text-slate-700">
                  {account ? formatTRY(account.threshold) : "—"}
                </p>
                {isLow ? (
                  <span className="mt-1 inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                    Düşük bakiye
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          {/* İşlem sekmeleri */}
          <div className="px-6 pt-5">
            <div className="flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
              {MODE_TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => {
                    setMode(t.key);
                    setError(null);
                    setValue(
                      t.key === "set" && account
                        ? String(account.balance)
                        : t.key === "threshold" && account
                          ? String(account.threshold)
                          : "",
                    );
                  }}
                  className={`flex-1 rounded-md px-3 py-1.5 font-medium transition ${
                    mode === t.key
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
            {error ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            ) : null}

            <div>
              <label className="block text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
                {mode === "threshold" ? "Eşik (TRY)" : "Tutar (TRY)"}
              </label>
              <input
                type="number"
                step="0.01"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                required
                autoFocus
                placeholder={mode === "adjust" ? "Örn. -250 veya 100" : "0.00"}
                className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]"
              />
              <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                {amountHint[mode]}
              </p>
            </div>

            {mode !== "threshold" ? (
              <div>
                <label className="block text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
                  Not (opsiyonel)
                </label>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={200}
                  placeholder="Örn. Havale dekontu #1234"
                  className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]"
                />
              </div>
            ) : null}

            <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border)] pt-3">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm hover:bg-[var(--color-surface-muted)] disabled:opacity-50"
              >
                Kapat
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-md bg-[var(--color-brand-blue)] px-4 py-2 text-sm text-white hover:bg-[var(--color-brand-navy)] disabled:opacity-50"
              >
                {saving ? (
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                ) : null}
                {saving ? "Kaydediliyor…" : "Kaydet"}
              </button>
            </div>
          </form>

          {/* Hareket geçmişi — TÜM hareketler sayfa sayfa (tam geçmiş erişimi) */}
          <div className="border-t border-[var(--color-border)] px-6 py-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                Hareket geçmişi
              </h3>
              {ledgerTotal > 0 ? (
                <span className="text-xs tabular-nums text-slate-500">
                  Toplam {ledgerTotal} hareket
                </span>
              ) : null}
            </div>
            {ledgerQuery.isLoading ? (
              <p className="mt-3 text-sm text-[var(--color-text-muted)]">Yükleniyor…</p>
            ) : ledgerRows.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--color-text-muted)]">
                Henüz hareket yok.
              </p>
            ) : (
              <>
                <ul className="mt-3 divide-y divide-slate-100">
                  {ledgerRows.map((row) => (
                    <LedgerRow key={row.id} row={row} />
                  ))}
                </ul>
                {totalPages > 1 ? (
                  <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
                    <button
                      type="button"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page <= 1 || ledgerQuery.isFetching}
                      className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-40"
                    >
                      ← Önceki
                    </button>
                    <span className="text-xs tabular-nums text-slate-500">
                      Sayfa {page} / {totalPages}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page >= totalPages || ledgerQuery.isFetching}
                      className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-40"
                    >
                      Sonraki →
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function LedgerRow({ row }: { row: SupplierLedgerEntry }): React.ReactElement {
  const positive = row.amount >= 0;
  return (
    <li className="flex items-center justify-between gap-3 py-2.5 text-sm">
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${
            positive ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"
          }`}
        >
          {positive ? (
            <ArrowUpCircle size={16} aria-hidden="true" />
          ) : (
            <ArrowDownCircle size={16} aria-hidden="true" />
          )}
        </span>
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-800">
            {LEDGER_TYPE_LABELS[row.type] ?? row.type}
            {row.humanOrderNo ? (
              <span className="ml-1 text-xs font-normal text-slate-500">
                · {row.humanOrderNo}
              </span>
            ) : null}
          </p>
          <p className="truncate text-xs text-slate-500">
            {formatDateTime(row.createdAt)}
            {row.description ? ` · ${row.description}` : ""}
          </p>
        </div>
      </div>
      <div className="shrink-0 text-right">
        <p
          className={`font-semibold tabular-nums ${
            positive ? "text-emerald-700" : "text-rose-700"
          }`}
        >
          {positive ? "+" : ""}
          {formatTRY(row.amount)}
        </p>
        <p className="text-xs tabular-nums text-slate-400">
          → {formatTRY(row.balanceAfter)}
        </p>
      </div>
    </li>
  );
}
