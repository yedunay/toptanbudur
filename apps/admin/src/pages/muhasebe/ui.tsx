import { formatAmount } from "../../lib/format";

// ─────────────────────────────────────────────────────────────────────────────
// Muhasebe sayfaları için paylaşılan sunum bileşenleri. Tedarikçi/Bayi hesap
// sayfaları aynı kart + tablo dilini kullandığı için burada tek kaynakta tutulur.
// ─────────────────────────────────────────────────────────────────────────────

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export type StatTone = "neutral" | "positive" | "negative" | "brand";

export function balanceTone(value: number): StatTone {
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
}

interface StatCardProps {
  label: string;
  value: number;
  tone?: StatTone;
  hint?: string;
}

export function StatCard({ label, value, tone = "neutral", hint }: StatCardProps) {
  const valueTone =
    tone === "positive"
      ? "text-emerald-700"
      : tone === "negative"
        ? "text-rose-600"
        : tone === "brand"
          ? "text-[var(--color-brand-navy)]"
          : "text-[var(--color-text)]";
  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-white p-4 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </p>
      <p className={`mt-1.5 text-lg font-bold tabular-nums ${valueTone}`}>
        {formatAmount(value)}
      </p>
      {hint ? <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p> : null}
    </div>
  );
}

interface ReconLineProps {
  label: string;
  value: number;
  sign?: "+" | "−" | "±";
  bold?: boolean;
  highlight?: "ok" | "warn";
}

export function ReconLine({ label, value, sign, bold, highlight }: ReconLineProps) {
  const rowBg =
    highlight === "ok"
      ? "bg-emerald-50"
      : highlight === "warn"
        ? "bg-amber-50"
        : "";
  const valueTone =
    highlight === "ok"
      ? "text-emerald-700"
      : highlight === "warn"
        ? "text-amber-700"
        : sign === "−"
          ? "text-rose-600"
          : sign === "+"
            ? "text-emerald-700"
            : "text-[var(--color-text)]";
  return (
    <div className={`flex items-center justify-between px-5 py-2.5 ${rowBg}`}>
      <span
        className={`text-sm ${bold ? "font-semibold text-[var(--color-text)]" : "text-slate-600"}`}
      >
        {sign ? <span className="mr-1 text-slate-400">{sign}</span> : null}
        {label}
      </span>
      <span className={`tabular-nums ${bold ? "font-bold" : "font-medium"} ${valueTone}`}>
        {formatAmount(value)}
      </span>
    </div>
  );
}

interface TableCardProps {
  title: string;
  count: number;
  children: React.ReactNode;
}

export function TableCard({ title, count, children }: TableCardProps) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-3">
        <h3 className="text-sm font-semibold text-[var(--color-brand-navy)]">
          {title}
        </h3>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          {count} kayıt
        </span>
      </div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

export function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-slate-400">
        {text}
      </td>
    </tr>
  );
}
