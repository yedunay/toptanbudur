interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
}

export default function StatCard({
  label,
  value,
  hint,
}: StatCardProps): React.ReactElement {
  return (
    <div className="rounded-xl bg-white border border-[var(--color-border)] p-6 shadow-sm">
      <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
        {label}
      </p>
      <p className="mt-2 text-3xl font-semibold text-[var(--color-text)]">
        {value}
      </p>
      {hint ? (
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">{hint}</p>
      ) : null}
    </div>
  );
}
