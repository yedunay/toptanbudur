import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "../Toast";
import { formatAmount } from "../../lib/format";
import {
  createIntegrationEntry,
  deleteIntegrationEntry,
  listIntegrationEntries,
  type FinanceEntryType,
} from "../../lib/finance";

// Manuel gelir/gider girişi — sağdan açılan panel (mockup birebir):
// Tarih / Tür / Açıklama / Tutar / KDV / Kategori + bu ayın satır listesi.

const KDV_OPTIONS = [0, 1, 10, 20];
const CATEGORY_SUGGESTIONS = [
  "Hizmet Geliri",
  "Danışmanlık",
  "Kira",
  "Ofis Gideri",
  "Diğer",
];

interface ManualEntryPanelProps {
  month: string;
  monthLabel: string;
  open: boolean;
  onClose: () => void;
}

function todayIso(month: string): string {
  // Seçili ayın 1'i (gün seçilmediği için makul varsayılan).
  return `${month}-01`;
}

export default function ManualEntryPanel({
  month,
  monthLabel,
  open,
  onClose,
}: ManualEntryPanelProps) {
  const toast = useToast();
  const qc = useQueryClient();

  const [entryDate, setEntryDate] = useState(() => todayIso(month));
  const [type, setType] = useState<FinanceEntryType>("INCOME");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [kdvRate, setKdvRate] = useState(20);
  const [category, setCategory] = useState("");

  const entriesQuery = useQuery({
    queryKey: ["finance", "integration-entries", month],
    queryFn: () => listIntegrationEntries(month),
    enabled: open,
  });

  const createMut = useMutation({
    mutationFn: () =>
      createIntegrationEntry({
        entryDate,
        type,
        description: description.trim(),
        amount: Number(amount),
        kdvRate,
        category: category.trim() || undefined,
      }),
    onSuccess: () => {
      toast.push("success", "Kayıt eklendi.");
      setDescription("");
      setAmount("");
      setCategory("");
      void qc.invalidateQueries({ queryKey: ["finance"] });
    },
    onError: (e) =>
      toast.push("error", e instanceof Error ? e.message : "Kayıt eklenemedi."),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteIntegrationEntry(id),
    onSuccess: () => {
      toast.push("success", "Kayıt silindi.");
      void qc.invalidateQueries({ queryKey: ["finance"] });
    },
    onError: (e) =>
      toast.push("error", e instanceof Error ? e.message : "Silinemedi."),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim()) {
      toast.push("error", "Açıklama girin.");
      return;
    }
    if (!(Number(amount) > 0)) {
      toast.push("error", "Geçerli bir tutar girin.");
      return;
    }
    createMut.mutate();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-[var(--color-brand-navy)]">
              Manuel Gelir/Gider Girişi
            </h2>
            <p className="text-xs text-slate-500">{monthLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-xl leading-none text-slate-400 hover:bg-slate-100"
            aria-label="Kapat"
          >
            ×
          </button>
        </div>

        <form onSubmit={submit} className="space-y-3 border-b border-[var(--color-border)] px-5 py-4">
          <Field label="Tarih">
            <input
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
              className="input"
            />
          </Field>
          <Field label="Tür">
            <select
              value={type}
              onChange={(e) => setType(e.target.value as FinanceEntryType)}
              className="input"
            >
              <option value="INCOME">Gelir</option>
              <option value="EXPENSE">Gider</option>
            </select>
          </Field>
          <Field label="Açıklama">
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Açıklama giriniz…"
              className="input"
            />
          </Field>
          <Field label="Tutar (KDV dahil)">
            <input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="₺ Tutar giriniz"
              className="input"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="KDV">
              <select
                value={kdvRate}
                onChange={(e) => setKdvRate(Number(e.target.value))}
                className="input"
              >
                {KDV_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    %{r}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Kategori">
              <input
                type="text"
                list="finance-int-cats"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Kategori seçiniz"
                className="input"
              />
              <datalist id="finance-int-cats">
                {CATEGORY_SUGGESTIONS.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="h-9 rounded-lg border border-[var(--color-border)] px-4 text-sm text-slate-600 hover:bg-slate-50"
            >
              İptal
            </button>
            <button
              type="submit"
              disabled={createMut.isPending}
              className="h-9 rounded-lg bg-[var(--color-brand-blue)] px-5 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-50"
            >
              {createMut.isPending ? "Kaydediliyor…" : "Kaydet"}
            </button>
          </div>
        </form>

        {/* Bu ayın kayıtları */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Bu Ayın Kayıtları
          </p>
          {entriesQuery.isLoading ? (
            <p className="text-sm text-slate-400">Yükleniyor…</p>
          ) : (entriesQuery.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-slate-400">Henüz kayıt yok.</p>
          ) : (
            <ul className="space-y-2">
              {entriesQuery.data!.map((e) => (
                <li
                  key={e.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[var(--color-text)]">
                      {e.description}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {e.entryDate.slice(0, 10)} · {e.category ?? "—"} · KDV %
                      {e.kdvRate}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 text-sm font-semibold tabular-nums ${
                      e.type === "INCOME" ? "text-emerald-600" : "text-rose-600"
                    }`}
                  >
                    {e.type === "INCOME" ? "+" : "−"}
                    {formatAmount(e.amount)}
                  </span>
                  <button
                    type="button"
                    onClick={() => deleteMut.mutate(e.id)}
                    className="shrink-0 rounded px-1.5 text-slate-300 hover:text-rose-600"
                    aria-label="Sil"
                  >
                    🗑
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <style>{`
        .input {
          height: 2.25rem; width: 100%;
          border-radius: 0.5rem; border: 1px solid var(--color-border);
          padding: 0 0.75rem; font-size: 0.875rem; background: #fff;
        }
        .input:focus { outline: none; box-shadow: 0 0 0 2px rgba(15,37,87,.25); }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </span>
      {children}
    </label>
  );
}
