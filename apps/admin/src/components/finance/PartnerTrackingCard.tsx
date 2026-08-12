import { formatAmount } from "../../lib/format";
import type { FinancePartnerDist } from "../../lib/finance";

// Ortak Ödeme Takibi — her ortağın ödediği masraf toplamı, gider adedi ve
// dengeleme/alacak durumu (+ alacaklı, − borçlu).

interface PartnerTrackingCardProps {
  partners: FinancePartnerDist[];
}

export default function PartnerTrackingCard({ partners }: PartnerTrackingCardProps) {
  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-white p-5 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-[var(--color-brand-navy)]">
        Ortak Ödeme Takibi
      </h3>
      <div className="space-y-3">
        {partners.map((p) => (
          <div
            key={p.id}
            className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] p-3"
          >
            <span
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
              style={{ backgroundColor: p.colorHex ?? "#0F2557" }}
              aria-hidden
            >
              {p.initials ?? p.name.slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-[var(--color-text)]">
                {p.name}
              </p>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-slate-500">
                <span>
                  Ödediği Tutar:{" "}
                  <span className="font-semibold tabular-nums text-[var(--color-text)]">
                    {formatAmount(p.paidTotal)}
                  </span>
                </span>
                <span>
                  Gider Adedi:{" "}
                  <span className="font-semibold tabular-nums text-[var(--color-text)]">
                    {p.expenseCount}
                  </span>
                </span>
              </div>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Dengeleme / Alacak
              </p>
              <p
                className={`text-sm font-bold tabular-nums ${
                  p.dengeleme > 0
                    ? "text-emerald-600"
                    : p.dengeleme < 0
                      ? "text-rose-600"
                      : "text-slate-500"
                }`}
              >
                {p.dengeleme > 0 ? "+" : ""}
                {formatAmount(p.dengeleme)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
