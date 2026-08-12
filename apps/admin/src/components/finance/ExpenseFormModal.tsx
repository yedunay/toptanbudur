import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "../Toast";
import {
  createExpense,
  updateExpense,
  type FinanceExpenseRow,
  type FinanceExpenseStatus,
  type FinancePartnerDist,
} from "../../lib/finance";

// Tek seferlik gider ekleme VEYA mevcut bir aylık satırı düzenleme modalı.

const KDV_OPTIONS = [0, 1, 10, 20];
const CATEGORY_SUGGESTIONS = [
  "Yapay Zeka / API",
  "Soru-Cevap Modülü",
  "Sunucu",
  "Reklam",
  "Muhasebe",
  "Yazılım / Araç",
  "Diğer",
];

interface ExpenseFormModalProps {
  month: string;
  partners: Pick<FinancePartnerDist, "id" | "name">[];
  expense: FinanceExpenseRow | null; // null → yeni tek seferlik
  onClose: () => void;
}

export default function ExpenseFormModal({
  month,
  partners,
  expense,
  onClose,
}: ExpenseFormModalProps) {
  const toast = useToast();
  const qc = useQueryClient();
  const editing = Boolean(expense);

  const [category, setCategory] = useState(expense?.category ?? "");
  const [description, setDescription] = useState(expense?.description ?? "");
  const [amount, setAmount] = useState(
    expense ? String(expense.amount) : "",
  );
  const [kdvRate, setKdvRate] = useState(expense?.kdvRate ?? 20);
  const [status, setStatus] = useState<FinanceExpenseStatus>(
    expense?.status ?? "PAID",
  );
  const [paidByPartnerId, setPaidByPartnerId] = useState<string>(
    expense?.paidByPartnerId ?? "",
  );
  const [note, setNote] = useState(expense?.note ?? "");

  const mut = useMutation({
    mutationFn: () => {
      const body = {
        category: category.trim(),
        description: description.trim(),
        amount: Number(amount),
        kdvRate,
        status,
        paidByPartnerId: paidByPartnerId || null,
        note: note.trim() || undefined,
      };
      return editing
        ? updateExpense(expense!.id, body)
        : createExpense({ ...body, month });
    },
    onSuccess: () => {
      toast.push("success", editing ? "Gider güncellendi." : "Gider eklendi.");
      void qc.invalidateQueries({ queryKey: ["finance"] });
      onClose();
    },
    onError: (e) =>
      toast.push("error", e instanceof Error ? e.message : "Kaydedilemedi."),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!category.trim() || !description.trim()) {
      toast.push("error", "Kategori ve açıklama zorunlu.");
      return;
    }
    if (!(Number(amount) > 0)) {
      toast.push("error", "Geçerli tutar girin.");
      return;
    }
    mut.mutate();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-3 rounded-2xl bg-white p-6 shadow-2xl"
      >
        <h2 className="text-base font-bold text-[var(--color-brand-navy)]">
          {editing ? "Gideri Düzenle" : "Tek Seferlik Gider Ekle"}
        </h2>

        <L label="Kategori">
          <input
            list="finance-exp-cats"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="fin-input"
            placeholder="Kategori"
          />
          <datalist id="finance-exp-cats">
            {CATEGORY_SUGGESTIONS.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </L>
        <L label="Açıklama">
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="fin-input"
            placeholder="Açıklama"
          />
        </L>
        <div className="grid grid-cols-2 gap-3">
          <L label="Tutar (KDV dahil)">
            <input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="fin-input"
              placeholder="₺"
            />
          </L>
          <L label="KDV">
            <select
              value={kdvRate}
              onChange={(e) => setKdvRate(Number(e.target.value))}
              className="fin-input"
            >
              {KDV_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  %{r}
                </option>
              ))}
            </select>
          </L>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <L label="Durum">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as FinanceExpenseStatus)}
              className="fin-input"
            >
              <option value="PAID">Ödendi</option>
              <option value="UNPAID">Ödenmedi</option>
            </select>
          </L>
          <L label="Ödeyen">
            <select
              value={paidByPartnerId}
              onChange={(e) => setPaidByPartnerId(e.target.value)}
              className="fin-input"
            >
              <option value="">Havuz (atanmamış)</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </L>
        </div>
        <L label="Not (opsiyonel)">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="fin-input"
          />
        </L>

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
            disabled={mut.isPending}
            className="h-9 rounded-lg bg-[var(--color-brand-navy)] px-5 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-50"
          >
            {mut.isPending ? "Kaydediliyor…" : "Kaydet"}
          </button>
        </div>
        <style>{`
          .fin-input { height: 2.25rem; width: 100%; border-radius: .5rem;
            border: 1px solid var(--color-border); padding: 0 .75rem; font-size: .875rem; background:#fff; }
          .fin-input:focus { outline: none; box-shadow: 0 0 0 2px rgba(15,37,87,.25); }
        `}</style>
      </form>
    </div>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </span>
      {children}
    </label>
  );
}
