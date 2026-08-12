import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "../Toast";
import { formatAmount } from "../../lib/format";
import {
  deleteAdvance,
  type FinanceAdvance,
  type FinanceCapital,
} from "../../lib/finance";
import AdvanceFormModal from "./AdvanceFormModal";

// Ortak Bakiyeleri ve Döner Sermaye — sayfanın en altı.
// Her ortak için KÜMÜLATİF (sistem başından seçili ayın sonuna) iki bakiye:
//   • Net bakiye   = KDV devlete ayrıldıktan sonra gerçek kalan (güvenli çekim tavanı)
//   • KDV'li bakiye = fiziksel nakit karşılığı (içinde henüz ödenmemiş KDV var)
// İkisinin toplamı = Toptan Budur Döner Sermaye. Kâr Avansı ekle/düzenle/sil.

interface PartnerCapitalCardProps {
  capital: FinanceCapital;
  partners: { id: string; name: string }[];
}

export default function PartnerCapitalCard({
  capital,
  partners,
}: PartnerCapitalCardProps) {
  const toast = useToast();
  const qc = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<FinanceAdvance | null>(null);

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteAdvance(id),
    onSuccess: () => {
      toast.push("success", "Kâr Avansı silindi.");
      void qc.invalidateQueries({ queryKey: ["finance"] });
    },
    onError: (e) =>
      toast.push("error", e instanceof Error ? e.message : "Silinemedi."),
  });

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }
  function openEdit(a: FinanceAdvance) {
    setEditing(a);
    setFormOpen(true);
  }
  function confirmDelete(a: FinanceAdvance) {
    if (
      window.confirm(
        `${a.partnerName ?? "Ortak"} · ${formatAmount(a.netAmount)} tutarlı Kâr Avansı silinsin mi?`,
      )
    ) {
      deleteMut.mutate(a.id);
    }
  }

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-brand-navy)]">
            Ortak Bakiyeleri ve Döner Sermaye
          </h3>
          <p className="text-[11px] text-slate-400">
            {capital.monthLabel} sonu itibarıyla kümülatif · kasa her ortağa ne kadar
            borçlu
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--color-brand-blue)] px-3 text-xs font-semibold text-white shadow-sm hover:opacity-90"
        >
          + Kâr Avansı Ekle
        </button>
      </div>

      {/* Ortak bakiye kartları */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {capital.partners.map((p) => {
          const overdraw = p.netBalance < -0.005;
          return (
            <div
              key={p.id}
              className="rounded-xl border border-[var(--color-border)] p-4"
            >
              <div className="flex items-center gap-2">
                <span
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                  style={{ backgroundColor: p.colorHex ?? "#0F2557" }}
                  aria-hidden
                >
                  {p.initials ?? p.name.slice(0, 2).toUpperCase()}
                </span>
                <span className="truncate text-sm font-semibold text-[var(--color-text)]">
                  {p.name}
                </span>
                <span className="ml-auto rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                  %{p.sharePercent}
                </span>
              </div>

              <div className="mt-3">
                <BalanceCell
                  label="Net Bakiye"
                  hint="kasanın ortağa borcu"
                  value={p.netBalance}
                  strong
                  negative={overdraw}
                />
              </div>

              {p.advTotal > 0 && (
                <p className="mt-2 text-[10px] text-slate-400">
                  Çekilen Kâr Avansı: {formatAmount(p.advTotal)}
                </p>
              )}
              {overdraw && (
                <p className="mt-1.5 rounded-md bg-rose-50 px-2 py-1 text-[10px] font-medium text-rose-600">
                  ⚠️ Bakiye eksi — payından fazla çektin.
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Döner Sermaye (tek — Net) */}
      <div className="mt-4">
        <div className="flex flex-col justify-center rounded-xl bg-[var(--color-brand-navy)] px-4 py-3 text-white">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-white/70">
            Toptan Budur Döner Sermaye
          </span>
          <span className="text-xl font-bold tabular-nums">
            {formatAmount(capital.netTotal)}
          </span>
          <span className="text-[10px] text-white/60">
            işi fonlayan gerçek ortak sermayesi (net)
          </span>
        </div>
      </div>

      {/* Kart komisyon farkı (+) ve Hoşgeldin promo (−) kırılımı */}
      {(capital.cardSpreadCum > 0 || capital.promoCum > 0) && (
        <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
          {capital.cardSpreadCum > 0 && (
            <span className="rounded-md bg-emerald-50 px-2 py-1 font-medium text-emerald-700">
              Kart komisyon farkı (kâr): +{formatAmount(capital.cardSpreadCum)}
            </span>
          )}
          {capital.promoCum > 0 && (
            <span className="rounded-md bg-amber-50 px-2 py-1 font-medium text-amber-700">
              Promo/Hediye Bakiye gideri: −{formatAmount(capital.promoCum)}
            </span>
          )}
        </div>
      )}

      {/* Kâr Avansı geçmişi */}
      <div className="mt-5">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Kâr Avansı Geçmişi ({capital.monthLabel} sonuna kadar)
        </p>
        {capital.advances.length === 0 ? (
          <p className="text-sm text-slate-400">Henüz kayıt yok.</p>
        ) : (
          <ul className="space-y-2">
            {capital.advances.map((a) => (
              <li
                key={a.id}
                className="flex items-center gap-3 rounded-lg border border-[var(--color-border)] px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[var(--color-text)]">
                    {a.partnerName ?? "—"}
                    {a.description ? (
                      <span className="font-normal text-slate-400">
                        {" "}
                        · {a.description}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    {a.advanceDate.slice(0, 10)}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-rose-600">
                  −{formatAmount(a.netAmount)}
                </span>
                <button
                  type="button"
                  onClick={() => openEdit(a)}
                  className="shrink-0 rounded px-1.5 text-slate-300 hover:text-[var(--color-brand-blue)]"
                  aria-label="Düzenle"
                  title="Düzenle"
                >
                  ✎
                </button>
                <button
                  type="button"
                  onClick={() => confirmDelete(a)}
                  disabled={deleteMut.isPending}
                  className="shrink-0 rounded px-1.5 text-slate-300 hover:text-rose-600 disabled:opacity-50"
                  aria-label="Sil"
                  title="Sil"
                >
                  🗑
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <AdvanceFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        partners={partners}
        editing={editing}
      />
    </div>
  );
}

function BalanceCell({
  label,
  hint,
  value,
  strong = false,
  negative = false,
}: {
  label: string;
  hint: string;
  value: number;
  strong?: boolean;
  negative?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-2.5 ${
        strong
          ? "border-[var(--color-brand-navy)]/20 bg-[var(--color-brand-navy)]/[0.03]"
          : "border-[var(--color-border)] bg-white"
      }`}
    >
      <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </span>
      <span
        className={`block text-base font-bold tabular-nums ${
          negative
            ? "text-rose-600"
            : strong
              ? "text-[var(--color-brand-navy)]"
              : "text-[var(--color-text)]"
        }`}
      >
        {formatAmount(value)}
      </span>
      <span className="block text-[10px] text-slate-400">{hint}</span>
    </div>
  );
}
