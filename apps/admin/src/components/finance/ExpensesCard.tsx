import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "../Toast";
import { formatAmount } from "../../lib/format";
import {
  deleteExpense,
  updateExpense,
  type FinanceExpenseRow,
  type FinancePartnerDist,
} from "../../lib/finance";
import ExpenseFormModal from "./ExpenseFormModal";
import RecurringTemplatesModal from "./RecurringTemplatesModal";

interface ExpensesCardProps {
  month: string;
  partners: Pick<FinancePartnerDist, "id" | "name">[];
  recurring: FinanceExpenseRow[];
  oneTime: FinanceExpenseRow[];
  total: number;
}

export default function ExpensesCard({
  month,
  partners,
  recurring,
  oneTime,
  total,
}: ExpensesCardProps) {
  const toast = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"recurring" | "oneTime">("recurring");
  const [formExpense, setFormExpense] = useState<FinanceExpenseRow | null | undefined>(
    undefined,
  ); // undefined=kapalı, null=yeni, row=düzenle
  const [templatesOpen, setTemplatesOpen] = useState(false);

  const toggleMut = useMutation({
    mutationFn: (e: FinanceExpenseRow) =>
      updateExpense(e.id, { enabled: !e.enabled }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["finance"] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteExpense(id),
    onSuccess: () => {
      toast.push("success", "Gider silindi.");
      void qc.invalidateQueries({ queryKey: ["finance"] });
    },
  });

  const rows = tab === "recurring" ? recurring : oneTime;

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-5 py-3">
        <h3 className="text-sm font-semibold text-[var(--color-brand-navy)]">
          Masraflar ve Harcamalar
        </h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTemplatesOpen(true)}
            className="h-8 rounded-lg border border-[var(--color-border)] px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            Sürekli Giderleri Yönet
          </button>
          <button
            type="button"
            onClick={() => setFormExpense(null)}
            className="h-8 rounded-lg bg-[var(--color-brand-navy)] px-3 text-xs font-semibold text-white hover:opacity-90"
          >
            + Gider Ekle
          </button>
        </div>
      </div>

      {/* Sekmeler */}
      <div className="flex gap-1 border-b border-[var(--color-border)] px-5 pt-2">
        <Tab active={tab === "recurring"} onClick={() => setTab("recurring")}>
          Aylık Sürekli Giderler ({recurring.length})
        </Tab>
        <Tab active={tab === "oneTime"} onClick={() => setTab("oneTime")}>
          Tek Seferlik Giderler ({oneTime.length})
        </Tab>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-[var(--color-border)] bg-slate-50/60 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              <th className="px-4 py-2.5">Kategori</th>
              <th className="px-4 py-2.5">Açıklama</th>
              <th className="px-4 py-2.5 text-right">Tutar</th>
              <th className="px-4 py-2.5 text-center">KDV</th>
              <th className="px-4 py-2.5 text-center">Durum</th>
              <th className="px-4 py-2.5">Ödeyen</th>
              <th className="px-4 py-2.5 text-right">İşlem</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-400">
                  {tab === "recurring"
                    ? "Sürekli gider yok. \"Sürekli Giderleri Yönet\" ile tanımlayın."
                    : "Tek seferlik gider yok."}
                </td>
              </tr>
            ) : (
              rows.map((e) => (
                <tr
                  key={e.id}
                  className={`border-b border-[var(--color-border)] transition-colors hover:bg-slate-50/80 ${
                    e.enabled ? "" : "opacity-50"
                  }`}
                >
                  <td className="px-4 py-2.5 text-sm font-medium text-[var(--color-text)]">
                    {e.category}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-slate-600">{e.description}</td>
                  <td className="px-4 py-2.5 text-right text-sm font-medium tabular-nums">
                    {formatAmount(e.amount)}
                  </td>
                  <td className="px-4 py-2.5 text-center text-sm tabular-nums text-slate-500">
                    %{e.kdvRate}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        e.status === "PAID"
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {e.status === "PAID" ? "Ödendi" : "Ödenmedi"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-sm text-slate-600">
                    {e.paidByPartnerName ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => toggleMut.mutate(e)}
                        className="rounded px-1.5 text-slate-400 hover:text-slate-700"
                        title={e.enabled ? "Bu ay için kapat" : "Bu ay için aç"}
                      >
                        {e.enabled ? "◉" : "◯"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setFormExpense(e)}
                        className="rounded px-1.5 text-slate-400 hover:text-[var(--color-brand-blue)]"
                        aria-label="Düzenle"
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteMut.mutate(e.id)}
                        className="rounded px-1.5 text-slate-300 hover:text-rose-600"
                        aria-label="Sil"
                      >
                        🗑
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50/60">
              <td colSpan={2} className="px-4 py-2.5 text-sm font-semibold text-[var(--color-text)]">
                Toplam (aktif)
              </td>
              <td className="px-4 py-2.5 text-right text-sm font-bold tabular-nums text-[var(--color-brand-navy)]">
                {formatAmount(total)}
              </td>
              <td colSpan={4} />
            </tr>
          </tfoot>
        </table>
      </div>

      {formExpense !== undefined ? (
        <ExpenseFormModal
          month={month}
          partners={partners}
          expense={formExpense}
          onClose={() => setFormExpense(undefined)}
        />
      ) : null}
      {templatesOpen ? (
        <RecurringTemplatesModal
          month={month}
          partners={partners}
          onClose={() => setTemplatesOpen(false)}
        />
      ) : null}
    </div>
  );
}

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-t-lg px-3 py-2 text-xs font-semibold transition-colors ${
        active
          ? "border-b-2 border-[var(--color-brand-navy)] text-[var(--color-brand-navy)]"
          : "text-slate-400 hover:text-slate-600"
      }`}
    >
      {children}
    </button>
  );
}
