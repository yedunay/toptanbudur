import { formatAmount } from "../../lib/format";
import type { CalculationTrace } from "../../lib/finance";

// ŞEFFAFLIK POPUP'I — "ℹ️ Hesaplama Detayı" butonuna tıklayınca açılır.
// O ayın HER sayısının nasıl hesaplandığını formül + gerçek girdiler + sonuç +
// veri kaynağı ile gösterir. Tıklanmadığı sürece görünmez (sadece buton durur).

interface CalculationDetailModalProps {
  trace: CalculationTrace;
  onClose: () => void;
}

export default function CalculationDetailModal({
  trace,
  onClose,
}: CalculationDetailModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Başlık */}
        <div className="sticky top-0 flex items-center justify-between rounded-t-2xl border-b border-[var(--color-border)] bg-[var(--color-brand-navy)] px-6 py-4 text-white">
          <div>
            <h2 className="text-base font-bold">Hesaplama Detayı</h2>
            <p className="text-xs text-white/70">
              {trace.monthLabel} · neyin nereden hesaplandığı, gerçek verilerle
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

        <div className="max-h-[75vh] space-y-5 overflow-y-auto px-6 py-5">
          {trace.sections.map((section) => (
            <section key={section.key}>
              <h3 className="text-sm font-bold text-[var(--color-brand-navy)]">
                {section.title}
              </h3>
              {section.description ? (
                <p className="mt-0.5 text-xs text-slate-500">
                  {section.description}
                </p>
              ) : null}
              <div className="mt-2 space-y-2">
                {section.steps.map((step, i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-[var(--color-border)] bg-slate-50/60 p-3"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-semibold text-[var(--color-text)]">
                        {step.label}
                      </span>
                      <span className="shrink-0 text-sm font-bold tabular-nums text-[var(--color-brand-navy)]">
                        {formatAmount(step.result)}
                      </span>
                    </div>
                    <p className="mt-1 font-mono text-[11px] text-slate-600">
                      = {step.formula}
                    </p>
                    {step.inputs && step.inputs.length > 0 ? (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {step.inputs.map((inp, j) => (
                          <span
                            key={j}
                            className="rounded-md bg-white px-2 py-0.5 text-[11px] text-slate-600 ring-1 ring-[var(--color-border)]"
                          >
                            {inp.label}:{" "}
                            <span className="font-semibold tabular-nums">
                              {inp.value}
                            </span>
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-400">
                      <span>Kaynak: {step.source}</span>
                      {step.note ? (
                        <span className="text-amber-600">• {step.note}</span>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
          <p className="pt-1 text-[11px] text-slate-400">
            Toptan Budur figürleri kârlılık motorundan canlı gelir;
            Entegrasyon ve masraflar elle girilen kayıtlardan toplanır.
          </p>
        </div>
      </div>
    </div>
  );
}
