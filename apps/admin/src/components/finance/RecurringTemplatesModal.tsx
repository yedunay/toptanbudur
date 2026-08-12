import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "../Toast";
import { formatAmount } from "../../lib/format";
import {
  createTemplate,
  deleteTemplate,
  listTemplates,
  updateTemplate,
  type ExpenseTemplate,
  type FinancePartnerDist,
} from "../../lib/finance";

// Sürekli giderleri yönet — "bir kez tanımla, her ay otomatik gelsin".
// Buradaki kayıtlar her yeni ayda o ayın masraf listesine otomatik düşer.

const KDV_OPTIONS = [0, 1, 10, 20];

interface RecurringTemplatesModalProps {
  month: string; // varsayılan başlangıç ayı
  partners: Pick<FinancePartnerDist, "id" | "name">[];
  onClose: () => void;
}

const EMPTY = {
  category: "",
  description: "",
  amount: "",
  kdvRate: 20,
  paidByPartnerId: "",
};

export default function RecurringTemplatesModal({
  month,
  partners,
  onClose,
}: RecurringTemplatesModalProps) {
  const toast = useToast();
  const qc = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY });

  const templatesQuery = useQuery({
    queryKey: ["finance", "expense-templates"],
    queryFn: listTemplates,
  });

  function reset() {
    setEditingId(null);
    setForm({ ...EMPTY });
  }

  const saveMut = useMutation({
    mutationFn: () => {
      const body = {
        category: form.category.trim(),
        description: form.description.trim(),
        amount: Number(form.amount),
        kdvRate: form.kdvRate,
        paidByPartnerId: form.paidByPartnerId || null,
      };
      return editingId
        ? updateTemplate(editingId, body)
        : createTemplate({ ...body, startMonth: month });
    },
    onSuccess: () => {
      toast.push("success", editingId ? "Tanım güncellendi." : "Sürekli gider eklendi.");
      reset();
      void qc.invalidateQueries({ queryKey: ["finance"] });
    },
    onError: (e) =>
      toast.push("error", e instanceof Error ? e.message : "Kaydedilemedi."),
  });

  const toggleMut = useMutation({
    mutationFn: (t: ExpenseTemplate) =>
      updateTemplate(t.id, { isActive: !t.isActive }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["finance"] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteTemplate(id),
    onSuccess: () => {
      toast.push("success", "Tanım silindi.");
      void qc.invalidateQueries({ queryKey: ["finance"] });
    },
  });

  function startEdit(t: ExpenseTemplate) {
    setEditingId(t.id);
    setForm({
      category: t.category,
      description: t.description,
      amount: String(t.amount),
      kdvRate: t.kdvRate,
      paidByPartnerId: t.paidByPartnerId ?? "",
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.category.trim() || !form.description.trim() || !(Number(form.amount) > 0)) {
      toast.push("error", "Kategori, açıklama ve tutar zorunlu.");
      return;
    }
    saveMut.mutate();
  }

  const partnerName = (id: string | null) =>
    id ? (partners.find((p) => p.id === id)?.name ?? "—") : "Havuz";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-4">
          <div>
            <h2 className="text-base font-bold text-[var(--color-brand-navy)]">
              Sürekli Giderleri Yönet
            </h2>
            <p className="text-xs text-slate-500">
              Bir kez tanımla — her ay otomatik listelenir.
            </p>
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

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {templatesQuery.isLoading ? (
            <p className="text-sm text-slate-400">Yükleniyor…</p>
          ) : (templatesQuery.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-slate-400">Henüz sürekli gider yok.</p>
          ) : (
            <ul className="space-y-2">
              {templatesQuery.data!.map((t) => (
                <li
                  key={t.id}
                  className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 ${
                    t.isActive ? "border-[var(--color-border)]" : "border-dashed border-slate-200 opacity-60"
                  }`}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[var(--color-text)]">
                      {t.description}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {t.category} · {formatAmount(t.amount)} · KDV %{t.kdvRate} ·{" "}
                      {partnerName(t.paidByPartnerId)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => toggleMut.mutate(t)}
                      className="rounded px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-100"
                      title={t.isActive ? "Pasifleştir" : "Aktifleştir"}
                    >
                      {t.isActive ? "Aktif" : "Pasif"}
                    </button>
                    <button
                      type="button"
                      onClick={() => startEdit(t)}
                      className="rounded px-1.5 text-slate-400 hover:text-[var(--color-brand-blue)]"
                      aria-label="Düzenle"
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteMut.mutate(t.id)}
                      className="rounded px-1.5 text-slate-300 hover:text-rose-600"
                      aria-label="Sil"
                    >
                      🗑
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <form onSubmit={submit} className="space-y-3 border-t border-[var(--color-border)] px-6 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            {editingId ? "Tanımı Düzenle" : "Yeni Sürekli Gider"}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <input
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              placeholder="Kategori"
              className="tpl-input"
            />
            <input
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Açıklama"
              className="tpl-input"
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <input
              type="number"
              step="0.01"
              min="0"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              placeholder="Tutar ₺"
              className="tpl-input"
            />
            <select
              value={form.kdvRate}
              onChange={(e) => setForm((f) => ({ ...f, kdvRate: Number(e.target.value) }))}
              className="tpl-input"
            >
              {KDV_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  KDV %{r}
                </option>
              ))}
            </select>
            <select
              value={form.paidByPartnerId}
              onChange={(e) => setForm((f) => ({ ...f, paidByPartnerId: e.target.value }))}
              className="tpl-input"
            >
              <option value="">Havuz</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            {editingId ? (
              <button
                type="button"
                onClick={reset}
                className="h-9 rounded-lg border border-[var(--color-border)] px-4 text-sm text-slate-600 hover:bg-slate-50"
              >
                Vazgeç
              </button>
            ) : null}
            <button
              type="submit"
              disabled={saveMut.isPending}
              className="h-9 rounded-lg bg-[var(--color-brand-blue)] px-5 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-50"
            >
              {editingId ? "Güncelle" : "Ekle"}
            </button>
          </div>
          <style>{`
            .tpl-input { height: 2.25rem; width: 100%; border-radius: .5rem;
              border: 1px solid var(--color-border); padding: 0 .6rem; font-size: .8125rem; background:#fff; }
            .tpl-input:focus { outline: none; box-shadow: 0 0 0 2px rgba(15,37,87,.25); }
          `}</style>
        </form>
      </div>
    </div>
  );
}
