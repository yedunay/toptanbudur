import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRequireAuth } from "../lib/auth";
import {
  CATEGORY_DESCRIPTIONS,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  listSettings,
  updateSetting,
  type AppSettingDto,
} from "../lib/app-settings";
import { useToast } from "../components/Toast";
import { useDocumentTitle } from "../lib/useDocumentTitle";

export default function SettingsPage(): React.ReactElement | null {
  useDocumentTitle("Ayarlar · Değişkenler");
  const authed = useRequireAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const settingsQuery = useQuery<AppSettingDto[]>({
    queryKey: ["app-settings"],
    queryFn: () => listSettings(),
    enabled: authed,
  });

  const grouped = useMemo(() => {
    const map = new Map<string, AppSettingDto[]>();
    for (const s of settingsQuery.data ?? []) {
      const arr = map.get(s.category) ?? [];
      arr.push(s);
      map.set(s.category, arr);
    }
    // Önce CATEGORY_ORDER sırası, listede olmayanlar alfabetik en sona.
    return Array.from(map.entries()).sort((a, b) => {
      const ia = CATEGORY_ORDER.indexOf(a[0]);
      const ib = CATEGORY_ORDER.indexOf(b[0]);
      const ra = ia === -1 ? Number.MAX_SAFE_INTEGER : ia;
      const rb = ib === -1 ? Number.MAX_SAFE_INTEGER : ib;
      if (ra !== rb) return ra - rb;
      return a[0].localeCompare(b[0]);
    });
  }, [settingsQuery.data]);

  // Accordion: varsayılan HEPSİ KAPALI; tıklayınca açılır.
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (category: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  const allOpen = grouped.length > 0 && open.size === grouped.length;
  const toggleAll = () =>
    setOpen(allOpen ? new Set() : new Set(grouped.map(([c]) => c)));

  if (!authed) return null;

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--color-text)]">
            Değişkenler
          </h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Çalışma zamanı parametreleri. Bir başlığa tıklayınca o grup açılır.
            Güvenlik secret'ları (API token vb.) .env dosyasında tutulur —
            burada görünmez.
          </p>
        </div>
        {grouped.length > 0 && (
          <button
            type="button"
            onClick={toggleAll}
            className="shrink-0 rounded-md border border-[var(--color-border)] bg-white px-3 py-1.5 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-muted)]"
          >
            {allOpen ? "Tümünü Daralt" : "Tümünü Genişlet"}
          </button>
        )}
      </header>

      {settingsQuery.isLoading ? (
        <p className="text-sm text-[var(--color-text-muted)]">Yükleniyor…</p>
      ) : grouped.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">
          Henüz değişken yok.
        </p>
      ) : (
        <div className="space-y-3">
          {grouped.map(([category, items]) => {
            const isOpen = open.has(category);
            const desc = CATEGORY_DESCRIPTIONS[category];
            return (
              <section
                key={category}
                className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-white"
              >
                <button
                  type="button"
                  onClick={() => toggle(category)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left transition-colors hover:bg-[var(--color-surface-muted)]"
                >
                  <span className="flex items-center gap-2.5">
                    <ChevronIcon open={isOpen} />
                    <span className="text-sm font-semibold text-[var(--color-text)]">
                      {CATEGORY_LABELS[category] ?? category}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full bg-[var(--color-surface-muted)] px-2 py-0.5 text-xs font-medium text-[var(--color-text-muted)]">
                    {items.length} değişken
                  </span>
                </button>
                {isOpen && (
                  <div className="border-t border-[var(--color-border)]">
                    {desc && (
                      <p className="bg-[var(--color-surface-muted)] px-5 py-2.5 text-xs text-[var(--color-text-muted)]">
                        {desc}
                      </p>
                    )}
                    <ul className="divide-y divide-[var(--color-border)]">
                      {items.map((s) => (
                        <SettingRow
                          key={s.key}
                          setting={s}
                          onSaved={() => {
                            toast.push("success", `${s.label} güncellendi`);
                            void queryClient.invalidateQueries({
                              queryKey: ["app-settings"],
                            });
                          }}
                          onError={(msg) => toast.push("error", msg)}
                        />
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ChevronIcon({ open }: { open: boolean }): React.ReactElement {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`text-[var(--color-text-muted)] transition-transform duration-200 ${
        open ? "rotate-90" : ""
      }`}
      aria-hidden="true"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

/** "HH:MM" (24s) formatı — saat ayarlarını time picker'a çevirmek için. */
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Bir ayar "saat" ayarı mı? String tipli olup anahtarı "…Time" ile bitiyorsa
 * (shipTime/sendTime/cutoffTime/goviWeekdayTime…) VEYA değeri geçerli HH:MM ise.
 * Bu durumda native `<input type="time">` (saat seçici) gösterilir.
 */
function isTimeSetting(setting: AppSettingDto): boolean {
  return (
    setting.type === "string" &&
    (/time$/i.test(setting.key) || HHMM_RE.test(setting.value))
  );
}

function SettingRow({
  setting,
  onSaved,
  onError,
}: {
  setting: AppSettingDto;
  onSaved: () => void;
  onError: (msg: string) => void;
}): React.ReactElement {
  const [draft, setDraft] = useState(setting.value);

  useEffect(() => {
    setDraft(setting.value);
  }, [setting.value]);

  const mutation = useMutation({
    mutationFn: () => updateSetting(setting.key, draft),
    onSuccess: () => onSaved(),
    onError: (err) =>
      onError(err instanceof Error ? err.message : "Kaydedilemedi"),
  });

  const dirty = draft !== setting.value;
  const isTime = isTimeSetting(setting);
  const inputType =
    setting.type === "number" || setting.type === "decimal"
      ? "number"
      : setting.type === "boolean"
        ? "checkbox"
        : isTime
          ? "time"
          : "text";

  const step =
    setting.type === "decimal" ? "0.01" : setting.type === "number" ? "1" : undefined;

  return (
    <li className="grid grid-cols-1 gap-3 px-5 py-4 md:grid-cols-[1fr_auto] md:items-center">
      <div>
        <div className="text-sm font-medium text-[var(--color-text)]">
          {setting.label}
        </div>
        <div className="mt-0.5 font-mono text-xs text-[var(--color-text-muted)]">
          {setting.key}
        </div>
        {setting.description && (
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            {setting.description}
          </p>
        )}
        {(setting.minValue !== null || setting.maxValue !== null) && (
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Aralık: {setting.minValue ?? "-"} – {setting.maxValue ?? "-"}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        {inputType === "checkbox" ? (
          <input
            type="checkbox"
            checked={draft === "true"}
            onChange={(e) => setDraft(e.target.checked ? "true" : "false")}
            className="h-5 w-5"
          />
        ) : (
          <input
            type={inputType}
            value={draft}
            step={step}
            min={setting.minValue ?? undefined}
            max={setting.maxValue ?? undefined}
            onChange={(e) => setDraft(e.target.value)}
            className="w-32 rounded-md border border-[var(--color-border)] bg-white px-2 py-1.5 text-sm"
          />
        )}
        <button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={!dirty || mutation.isPending}
          className="rounded-md bg-[var(--color-brand-navy)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
        >
          {mutation.isPending ? "…" : "Kaydet"}
        </button>
      </div>
    </li>
  );
}
