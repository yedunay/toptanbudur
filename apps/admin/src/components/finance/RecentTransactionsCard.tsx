import { formatAmount } from "../../lib/format";
import type { FinanceTransaction } from "../../lib/finance";

// Son İşlemler — entegrasyon kayıtları + masraflar birleşik akış.

interface RecentTransactionsCardProps {
  transactions: FinanceTransaction[];
}

export default function RecentTransactionsCard({
  transactions,
}: RecentTransactionsCardProps) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-white shadow-sm">
      <div className="border-b border-[var(--color-border)] px-5 py-3">
        <h3 className="text-sm font-semibold text-[var(--color-brand-navy)]">
          Son İşlemler
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-[var(--color-border)] bg-slate-50/60 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              <th className="px-4 py-2.5">Tarih</th>
              <th className="px-4 py-2.5">Şirket</th>
              <th className="px-4 py-2.5">Açıklama</th>
              <th className="px-4 py-2.5">Kategori</th>
              <th className="px-4 py-2.5">Ödeyen</th>
              <th className="px-4 py-2.5 text-right">Tutar</th>
            </tr>
          </thead>
          <tbody>
            {transactions.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-400">
                  Bu ay kayıt yok.
                </td>
              </tr>
            ) : (
              transactions.map((t, i) => (
                <tr
                  key={i}
                  className="border-b border-[var(--color-border)] transition-colors hover:bg-slate-50/80"
                >
                  <td className="whitespace-nowrap px-4 py-2.5 text-sm tabular-nums text-slate-500">
                    {t.date ? t.date.slice(0, 10) : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-slate-600">{t.company}</td>
                  <td className="px-4 py-2.5 text-sm text-[var(--color-text)]">
                    {t.description}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-slate-500">
                    {t.category ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-slate-500">
                    {t.paidByName ?? "—"}
                  </td>
                  <td
                    className={`px-4 py-2.5 text-right text-sm font-semibold tabular-nums ${
                      t.sign === "positive" ? "text-emerald-600" : "text-rose-600"
                    }`}
                  >
                    {t.sign === "positive" ? "+" : "−"}
                    {formatAmount(t.amount)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
