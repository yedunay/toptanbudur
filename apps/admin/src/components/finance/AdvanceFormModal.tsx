import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "../Toast";
import {
  createAdvance,
  updateAdvance,
  type AdvanceInput,
  type FinanceAdvance,
} from "../../lib/finance";

// Kâr Avansı ekle/düzenle — TEK bakiye modeli: ortağın çektiği tutar girilir,
// direkt net bakiyeden düşer (KDV ayrımı YOK, ekstra soru YOK).

const INPUT =
  "h-9 w-full rounded-lg border border-[var(--color-border)] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-navy)]/25";

interface AdvanceFormModalProps {
  open: boolean;
  onClose: () => void;
  partners: { id: string; name: string }[];
  editing: FinanceAdvance | null;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export default function AdvanceFormModal({
  open,
  onClose,
  partners,
  editing,
}: AdvanceFormModalProps) {
  const toast = useToast();
  const qc = useQueryClient();

  const [partnerId, setPartnerId] = useState("");
  const [advanceDate, setAdvanceDate] = useState(todayIso);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setPartnerId(editing.partnerId);
      setAdvanceDate(editing.advanceDate.slice(0, 10));
      setAmount(String(editing.netAmount));
      setDescription(editing.description ?? "");
    } else {
      setPartnerId(partners[0]?.id ?? "");
      setAdvanceDate(todayIso());
      setAmount("");
      setDescription("");
    }
  }, [open, editing, partners]);

  const saveMut = useMutation({
    mutationFn: () => {
      const amt = Number(amount);
      // Tek tutar → net ve KDV'li alanlar aynı (KDV ayrımı kaldırıldı).
      const body: AdvanceInput = {
        partnerId,
        advanceDate,
        grossAmount: amt,
        netAmount: amt,
        description: description.trim() || undefined,
      };
      return editing ? updateAdvance(editing.id, body) : createAdvance(body);
    },
    onSuccess: () => {
      toast.push("success", editing ? "Kâr Avansı güncellendi." : "Kâr Avansı eklendi.");
      void qc.invalidateQueries({ queryKey: ["finance"] });
      onClose();
    },
    onError: (e) =>
      toast.push("error", e instanceof Error ? e.message : "Kaydedilemedi."),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!partnerId) {
      toast.push("error", "Ortak seçin.");
      return;
    }
    if (!(Number(amount) > 0)) {
      toast.push("error", "Geçerli bir tutar girin.");
      return;
    }
    saveMut.mutate();
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between rounded-t-2xl border-b border-[var(--color-border)] bg-[var(--color-brand-navy)] px-6 py-4 text-white">
          <div>
            <h2 className="text-base font-bold">
              {editing ? "Kâr Avansı Düzenle" : "Kâr Avansı Ekle"}
            </h2>
            <p className="text-xs text-white/70">
              Ortağın çektiği tutar — direkt net bakiyeden düşer
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-xl leading-none text-white/80 hover:bg-white/10"
            aria-label="Kapat"
          >
            ×
          </button>
        </div>

        <form onSubmit={submit} className="space-y-3 px-6 py-5">
          <Field label="Ortak">
            <select
              value={partnerId}
              onChange={(e) => setPartnerId(e.target.value)}
              className={INPUT}
            >
              {partners.length === 0 ? <option value="">—</option> : null}
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Tarih">
            <input
              type="date"
              value={advanceDate}
              onChange={(e) => setAdvanceDate(e.target.value)}
              className={INPUT}
            />
          </Field>

          <Field label="Çekilen Tutar">
            <input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="₺ 30.000"
              className={INPUT}
              autoFocus
            />
          </Field>

          <Field label="Açıklama (opsiyonel)">
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="ör. 30 Haziran Macbook"
              className={INPUT}
            />
          </Field>

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
              disabled={saveMut.isPending}
              className="h-9 rounded-lg bg-[var(--color-brand-blue)] px-5 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-50"
            >
              {saveMut.isPending ? "Kaydediliyor…" : editing ? "Güncelle" : "Kaydet"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </span>
      {children}
    </label>
  );
}
