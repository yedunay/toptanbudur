import { useEffect, useMemo, useState } from "react";

export interface ExportField {
  key: string;
  label: string;
  type?: "text" | "number" | "date" | "select" | "checkbox";
  options?: ReadonlyArray<{ value: string; label: string }>;
  placeholder?: string;
}

export interface ExportModalProps {
  title: string;
  description?: string;
  fields: ReadonlyArray<ExportField>;
  initialValues?: Record<string, string | boolean | number | undefined>;
  onClose: () => void;
  onSubmit: (
    values: Record<string, string | boolean | number | undefined>,
    scope: "all" | "filtered",
  ) => Promise<void> | void;
}

export default function ExportModal({
  title,
  description,
  fields,
  initialValues,
  onClose,
  onSubmit,
}: ExportModalProps): React.ReactElement {
  const [values, setValues] = useState<Record<string, string | boolean | number | undefined>>(
    () => initialValues ?? {},
  );
  const [scope, setScope] = useState<"all" | "filtered">("filtered");
  const [submitting, setSubmitting] = useState<boolean>(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const updateField = (key: string, value: string | boolean | number | undefined): void => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onSubmit(values, scope);
    } finally {
      setSubmitting(false);
    }
  };

  const fieldGroups = useMemo(() => fields, [fields]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-modal-title"
      >
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="export-modal-title" className="text-lg font-semibold">
              {title}
            </h2>
            {description ? (
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            aria-label="Kapat"
          >
            ✕
          </button>
        </header>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div
            role="radiogroup"
            aria-label="Kapsam"
            className="inline-flex w-full overflow-hidden rounded-md border border-[var(--color-border)] text-sm"
          >
            <label
              className={`flex flex-1 cursor-pointer items-center justify-center px-3 py-2 ${
                scope === "filtered"
                  ? "bg-[var(--color-brand-blue)] text-white"
                  : "bg-white text-[var(--color-text)]"
              }`}
            >
              <input
                type="radio"
                name="scope"
                value="filtered"
                checked={scope === "filtered"}
                onChange={() => setScope("filtered")}
                className="sr-only"
              />
              Filtrelenmiş
            </label>
            <label
              className={`flex flex-1 cursor-pointer items-center justify-center px-3 py-2 ${
                scope === "all"
                  ? "bg-[var(--color-brand-blue)] text-white"
                  : "bg-white text-[var(--color-text)]"
              }`}
            >
              <input
                type="radio"
                name="scope"
                value="all"
                checked={scope === "all"}
                onChange={() => setScope("all")}
                className="sr-only"
              />
              Tüm kayıtlar
            </label>
          </div>

          {scope === "filtered" ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {fieldGroups.map((field) => {
                const id = `export-field-${field.key}`;
                if (field.type === "checkbox") {
                  return (
                    <label
                      key={field.key}
                      htmlFor={id}
                      className="flex items-center gap-2 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm sm:col-span-2"
                    >
                      <input
                        id={id}
                        type="checkbox"
                        checked={Boolean(values[field.key])}
                        onChange={(e) => updateField(field.key, e.target.checked)}
                        className="h-4 w-4"
                      />
                      <span>{field.label}</span>
                    </label>
                  );
                }
                if (field.type === "select" && field.options) {
                  return (
                    <label key={field.key} htmlFor={id} className="block text-sm">
                      <span className="mb-1 block text-xs uppercase text-[var(--color-text-muted)]">
                        {field.label}
                      </span>
                      <select
                        id={id}
                        value={(values[field.key] as string | undefined) ?? ""}
                        onChange={(e) => updateField(field.key, e.target.value || undefined)}
                        className="w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm"
                      >
                        <option value="">— Tümü —</option>
                        {field.options.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  );
                }
                return (
                  <label key={field.key} htmlFor={id} className="block text-sm">
                    <span className="mb-1 block text-xs uppercase text-[var(--color-text-muted)]">
                      {field.label}
                    </span>
                    <input
                      id={id}
                      type={field.type ?? "text"}
                      value={(values[field.key] as string | undefined) ?? ""}
                      placeholder={field.placeholder}
                      onChange={(e) => {
                        const v = e.target.value;
                        updateField(field.key, v || undefined);
                      }}
                      className="w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm"
                    />
                  </label>
                );
              })}
            </div>
          ) : (
            <p className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3 text-sm text-[var(--color-text-muted)]">
              Tüm kayıtlar dışa aktarılacak. Büyük listelerde işlem birkaç dakika sürebilir.
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-[var(--color-border)] bg-white px-4 py-2 text-sm hover:bg-[var(--color-surface-muted)]"
            >
              İptal
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-[var(--color-brand-blue)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-brand-navy)] disabled:opacity-60"
            >
              {submitting ? "Hazırlanıyor…" : "Dışa aktar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
