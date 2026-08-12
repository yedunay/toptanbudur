import { formatAmount } from "../../lib/format";
import type { FinanceDistribution } from "../../lib/finance";

// Bakiye Dağılım Hesabı — formül şeridi + %pay kartları + ortaklar-arası dengeleme.

interface DistributionPanelProps {
  distribution: FinanceDistribution;
}

export default function DistributionPanel({ distribution: d }: DistributionPanelProps) {
  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-white p-5 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-[var(--color-brand-navy)]">
        Bakiye Dağılım Hesabı
      </h3>

      {/* Formül şeridi */}
      <div className="flex flex-wrap items-stretch gap-2">
        <Term label="Toplam Gelen" value={d.toplamGelen} />
        <Op>−</Op>
        <Term label="Toplam Giden" value={d.toplamGiden} />
        <Op>−</Op>
        <Term label="KDV Etkisi" value={d.toplamKdvFarki} />
        {d.havuzMasraf > 0 ? (
          <>
            <Op>−</Op>
            <Term label="Havuz Masraf" value={d.havuzMasraf} />
          </>
        ) : null}
        {d.promo > 0 ? (
          <>
            <Op>−</Op>
            <Term label="Promo/Hediye Bakiye" value={d.promo} />
          </>
        ) : null}
        {d.cardSpread > 0 ? (
          <>
            <Op>+</Op>
            <Term label="Kart Komisyon Farkı" value={d.cardSpread} />
          </>
        ) : null}
        <Op>=</Op>
        <div className="flex min-w-[150px] flex-1 flex-col justify-center rounded-xl bg-[var(--color-brand-navy)] px-4 py-3 text-white">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-white/70">
            Dağıtılabilir Bakiye
          </span>
          <span className="text-lg font-bold tabular-nums">
            {formatAmount(d.dagitilabilirBakiye)}
          </span>
        </div>
      </div>

      {/* Ortak payları + dengeleme */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {d.partners.map((p) => (
          <div
            key={p.id}
            className="rounded-xl border border-[var(--color-border)] p-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-[var(--color-text)]">
                {p.name} Payı
              </span>
              <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                %{p.sharePercent}
              </span>
            </div>
            <p className="mt-1 text-lg font-bold tabular-nums text-[var(--color-brand-navy)]">
              {formatAmount(p.onerilen)}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-400">
              Pay {formatAmount(p.share)}
              {p.dengeleme !== 0 ? (
                <>
                  {" "}
                  <span
                    className={
                      p.dengeleme > 0 ? "text-emerald-600" : "text-rose-600"
                    }
                  >
                    {p.dengeleme > 0 ? "+ iade " : "− mahsup "}
                    {formatAmount(Math.abs(p.dengeleme))}
                  </span>
                </>
              ) : null}
            </p>
            <p className="mt-0.5 text-[10px] uppercase tracking-wider text-slate-400">
              Önerilen ödeme
            </p>
          </div>
        ))}

        {/* Dengeleme kutusu */}
        {d.settlement ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm font-semibold text-amber-800">
              Ortaklar Arası Dengeleme
            </p>
            <p className="mt-1 text-[11px] text-amber-700">
              {d.settlement.fromName}, {d.settlement.toName}'a ödeyecek:
            </p>
            <p className="mt-1 flex items-center gap-1 text-lg font-bold tabular-nums text-amber-800">
              <span aria-hidden>⚖️</span>
              {formatAmount(d.settlement.amount)}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Term({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex min-w-[120px] flex-1 flex-col justify-center rounded-xl border border-[var(--color-border)] bg-slate-50/60 px-3 py-3">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </span>
      <span className="text-sm font-bold tabular-nums text-[var(--color-text)]">
        {formatAmount(value)}
      </span>
    </div>
  );
}

function Op({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center px-0.5 text-lg font-bold text-slate-300">
      {children}
    </div>
  );
}
