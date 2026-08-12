import { useCallback, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useRequireAuth } from "../lib/auth";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import {
  downloadAuditLogExport,
  fetchAuditLogs,
  type AuditAudience,
  type AuditLogCategory,
  type AuditLogEntry,
  type AuditLogListResponse,
} from "../lib/audit";
import { actionLabel, formatActor } from "../lib/auditLabels";
import { useDebounce } from "../lib/useDebounce";

const PAGE_SIZE = 50;

function isAudience(value: string | null): value is AuditAudience {
  return value === "admin" || value === "customer";
}

function isLogCategory(value: string | null): value is AuditLogCategory {
  return value === "ADMIN" || value === "BIRFATURA" || value === "CUSTOMER";
}

const LOG_CATEGORY_TABS: ReadonlyArray<{
  id: AuditLogCategory | "";
  label: string;
}> = [
  { id: "", label: "Tümü" },
  { id: "ADMIN", label: "Admin" },
  { id: "BIRFATURA", label: "BirFatura" },
  { id: "CUSTOMER", label: "Müşteri" },
];

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("tr-TR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatRelative(iso: string): string {
  try {
    const d = new Date(iso).getTime();
    const diff = Date.now() - d;
    const sec = Math.round(diff / 1000);
    if (sec < 60) return `${sec} sn önce`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${min} dk önce`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `${hr} sa önce`;
    const day = Math.round(hr / 24);
    if (day < 30) return `${day} gün önce`;
    return formatDateTime(iso);
  } catch {
    return iso;
  }
}

function metaValue<T>(meta: unknown, key: string): T | null {
  if (meta && typeof meta === "object") {
    const v = (meta as Record<string, unknown>)[key];
    if (v !== undefined && v !== null) return v as T;
  }
  return null;
}

interface DiffSlice {
  before: unknown;
  after: unknown;
}

function extractDiff(meta: unknown): DiffSlice | null {
  if (!meta || typeof meta !== "object") return null;
  const obj = meta as Record<string, unknown>;
  const before = obj.before ?? obj.previous ?? obj.prev ?? obj.old;
  const after = obj.after ?? obj.next ?? obj.new ?? obj.updated;
  if (before !== undefined || after !== undefined) return { before, after };
  return null;
}

function targetLink(target: string | null): { to: string; label: string } | null {
  if (!target) return null;
  const lower = target.toLowerCase();
  const parts = target.split(/[:#/]/);
  const id = parts.length > 1 ? parts[parts.length - 1] : null;
  if (!id) return null;
  if (lower.startsWith("supplier")) return { to: `/suppliers/${id}/edit`, label: "Tedarikçiyi aç" };
  if (lower.startsWith("product")) return { to: `/products?id=${id}`, label: "Ürünleri filtrele" };
  if (lower.startsWith("order")) return { to: `/orders/${id}`, label: "Siparişi aç" };
  if (lower.startsWith("customer")) return { to: `/customers/${id}`, label: "Müşteriyi aç" };
  if (lower.startsWith("form") || lower.startsWith("support")) {
    return { to: `/mesajlar`, label: "Mesajları aç" };
  }
  return null;
}

function actorTypeBadge(type: string): { label: string; className: string } {
  switch (type) {
    case "admin":
      return { label: "Admin", className: "bg-indigo-100 text-indigo-700" };
    case "customer":
      return { label: "Müşteri", className: "bg-emerald-100 text-emerald-700" };
    case "public":
      return { label: "Ziyaretçi", className: "bg-amber-100 text-amber-800" };
    case "system":
      return { label: "Sistem", className: "bg-slate-200 text-slate-700" };
    default:
      return { label: type || "—", className: "bg-slate-100 text-slate-600" };
  }
}

function deriveSummary(row: AuditLogEntry): string {
  if (row.summary && row.summary.trim()) return row.summary.trim();
  const meta = metaValue<string>(row.metadata, "summary");
  if (meta && meta.trim()) return meta.trim();
  const action = actionLabel(row.action);
  const targetLabel =
    row.targetLabel ?? metaValue<string>(row.metadata, "targetLabel") ?? row.target ?? null;
  const actor = formatActor(row.actorName, row.actorEmail, row.actorId);
  if (targetLabel && targetLabel !== "—") return `${actor} • ${action} • ${targetLabel}`;
  return `${actor} • ${action}`;
}

export default function AuditLogPage(): React.ReactElement | null {
  useDocumentTitle("Loglar");
  const authed = useRequireAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const audience: AuditAudience = isAudience(searchParams.get("tab"))
    ? (searchParams.get("tab") as AuditAudience)
    : "admin";

  // logCategory kova filtresi — ?cat= URL paramında tutulur, audience'tan
  // bağımsız ek bir filtredir (#42). Boş = tüm kovalar.
  const logCategory: AuditLogCategory | "" = isLogCategory(
    searchParams.get("cat"),
  )
    ? (searchParams.get("cat") as AuditLogCategory)
    : "";

  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [showTech, setShowTech] = useState(false);
  const [selected, setSelected] = useState<AuditLogEntry | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const debouncedQ = useDebounce(q, 300);

  const setTab = useCallback(
    (next: AuditAudience) => {
      const params = new URLSearchParams(searchParams);
      params.set("tab", next);
      setSearchParams(params, { replace: true });
      setPage(1);
      setSelected(null);
    },
    [searchParams, setSearchParams],
  );

  const setCategory = useCallback(
    (next: AuditLogCategory | "") => {
      const params = new URLSearchParams(searchParams);
      if (next) params.set("cat", next);
      else params.delete("cat");
      setSearchParams(params, { replace: true });
      setPage(1);
      setSelected(null);
    },
    [searchParams, setSearchParams],
  );

  const filters = useMemo(
    () => ({
      page,
      pageSize: PAGE_SIZE,
      audience,
      logCategory: logCategory || undefined,
      q: debouncedQ || undefined,
      from: from || undefined,
      to: to || undefined,
    }),
    [page, audience, logCategory, debouncedQ, from, to],
  );

  const query = useQuery<AuditLogListResponse>({
    queryKey: ["audit-logs", filters],
    queryFn: () => fetchAuditLogs(filters),
    enabled: authed,
  });

  const data = query.data;
  const items = data?.data ?? [];
  const meta = data?.meta;
  const diff = selected ? extractDiff(selected.metadata) : null;
  const link = selected ? targetLink(selected.target) : null;

  const tabs: Array<{ id: AuditAudience; label: string; hint: string }> = [
    { id: "admin", label: "Admin Logları", hint: "Yönetici ve sistem aksiyonları" },
    { id: "customer", label: "Müşteri Logları", hint: "Müşteri + ziyaretçi aksiyonları" },
  ];

  return (
    <div>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--color-text)]">Loglar</h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            {meta ? `${meta.total.toLocaleString("tr-TR")} kayıt` : "Yükleniyor…"}
            <span className="mx-2 text-[var(--color-text-muted)]">·</span>
            {audience === "admin"
              ? "Admin paneli aktiviteleri"
              : "Müşteri panel ve ziyaretçi aktiviteleri"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={exporting}
            onClick={async () => {
              setExporting(true);
              setExportError(null);
              try {
                await downloadAuditLogExport({
                  audience,
                  q: debouncedQ || undefined,
                  from: from || undefined,
                  to: to || undefined,
                });
              } catch (err) {
                setExportError(err instanceof Error ? err.message : "İndirme başarısız");
              } finally {
                setExporting(false);
              }
            }}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-brand-blue)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            {exporting ? "Hazırlanıyor…" : "Excel'e Aktar"}
          </button>
          <Link
            to="/loglar/ayarlar"
            className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1.5 text-sm hover:bg-[var(--color-surface-muted)]"
          >
            E-posta Ayarları
          </Link>
        </div>
      </header>

      <div
        role="tablist"
        aria-label="Log seçimi"
        className="mb-4 inline-flex rounded-xl border border-[var(--color-border)] bg-white p-1 text-sm shadow-sm"
      >
        {tabs.map((t) => {
          const active = t.id === audience;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={active}
              type="button"
              onClick={() => setTab(t.id)}
              className={
                active
                  ? "rounded-lg bg-[var(--color-brand-blue)] px-4 py-2 font-medium text-white"
                  : "rounded-lg px-4 py-2 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              }
              title={t.hint}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* logCategory kova filtresi — Admin / BirFatura / Müşteri (#42). */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-[var(--color-text-muted)]">
          Kategori:
        </span>
        {LOG_CATEGORY_TABS.map((c) => {
          const active = c.id === logCategory;
          return (
            <button
              key={c.id || "all"}
              type="button"
              onClick={() => setCategory(c.id)}
              aria-pressed={active}
              className={
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors " +
                (active
                  ? "border-[var(--color-brand-blue)] bg-[var(--color-brand-blue)] text-white"
                  : "border-[var(--color-border)] bg-white text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)]")
              }
            >
              {c.label}
            </button>
          );
        })}
      </div>

      {exportError ? (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {exportError}
        </div>
      ) : null}

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
        <input
          type="search"
          placeholder="Ara: aksiyon kodu, hedef ID…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          className="rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm md:col-span-1"
        />
        <input
          type="datetime-local"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            setPage(1);
          }}
          className="rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm"
          aria-label="Başlangıç tarihi"
        />
        <input
          type="datetime-local"
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setPage(1);
          }}
          className="rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm"
          aria-label="Bitiş tarihi"
        />
      </div>

      {query.isError ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {query.error instanceof Error ? query.error.message : "Veri alınamadı"}
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--color-border)] bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
                <tr>
                  <th className="px-3 py-2 text-left whitespace-nowrap">Zaman</th>
                  <th className="px-3 py-2 text-left">Özet</th>
                  <th className="px-3 py-2 text-left hidden md:table-cell">Aktör</th>
                  <th className="px-3 py-2 text-left hidden lg:table-cell">Tür</th>
                </tr>
              </thead>
              <tbody>
                {query.isLoading ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-3 py-10 text-center text-[var(--color-text-muted)]"
                    >
                      Yükleniyor…
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-3 py-10 text-center text-[var(--color-text-muted)]"
                    >
                      Bu sekmede kayıt bulunmuyor.
                    </td>
                  </tr>
                ) : (
                  items.map((row) => {
                    const summary = deriveSummary(row);
                    const badge = actorTypeBadge(row.actorType);
                    return (
                      <tr
                        key={row.id}
                        onClick={() => {
                          setSelected(row);
                          setShowTech(false);
                        }}
                        className="border-t border-[var(--color-border)] hover:bg-[var(--color-surface-muted)] cursor-pointer align-top"
                      >
                        <td className="px-3 py-3 text-[var(--color-text-muted)] whitespace-nowrap">
                          <div className="text-xs">{formatRelative(row.createdAt)}</div>
                          <div className="text-[10px] text-[var(--color-text-muted)]">
                            {formatDateTime(row.createdAt)}
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <div className="font-medium text-[var(--color-text)] leading-snug">
                            {summary}
                          </div>
                          <div className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                            {actionLabel(row.action)}
                          </div>
                        </td>
                        <td className="px-3 py-3 hidden md:table-cell">
                          <div className="font-medium text-[var(--color-text)]">
                            {formatActor(row.actorName, row.actorEmail, row.actorId)}
                          </div>
                          {row.actorEmail && row.actorName ? (
                            <div className="text-xs text-[var(--color-text-muted)]">
                              {row.actorEmail}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-3 hidden lg:table-cell">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}
                          >
                            {badge.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          {meta && meta.totalPages > 1 ? (
            <div className="flex items-center justify-between border-t border-[var(--color-border)] px-3 py-2 text-sm">
              <span className="text-[var(--color-text-muted)]">
                Sayfa {meta.page} / {meta.totalPages}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={meta.page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1 text-xs disabled:opacity-50"
                >
                  Önceki
                </button>
                <button
                  type="button"
                  disabled={meta.page >= meta.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1 text-xs disabled:opacity-50"
                >
                  Sonraki
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {selected ? (
        <div
          className="fixed inset-0 z-40 bg-black/40 flex justify-end"
          onClick={() => setSelected(null)}
        >
          <aside
            className="w-full max-w-xl h-full bg-white shadow-xl overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Log detayı"
          >
            <div className="sticky top-0 z-10 bg-white border-b border-[var(--color-border)] px-6 py-4 flex items-start justify-between">
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                  {actionLabel(selected.action)}
                </div>
                <h2 className="mt-1 text-lg font-semibold text-[var(--color-text)] leading-snug">
                  {deriveSummary(selected)}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="ml-3 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                aria-label="Kapat"
              >
                ✕
              </button>
            </div>

            <div className="px-6 py-5 space-y-5 text-sm">
              <section className="space-y-3">
                <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${actorTypeBadge(selected.actorType).className}`}
                  >
                    {actorTypeBadge(selected.actorType).label}
                  </span>
                  <span>{formatRelative(selected.createdAt)}</span>
                  <span aria-hidden>·</span>
                  <span>{formatDateTime(selected.createdAt)}</span>
                </div>

                <dl className="space-y-3">
                  <div>
                    <dt className="text-xs uppercase text-[var(--color-text-muted)]">Aktör</dt>
                    <dd className="mt-0.5">
                      <div className="font-medium text-[var(--color-text)]">
                        {formatActor(selected.actorName, selected.actorEmail, selected.actorId)}
                      </div>
                      {selected.actorEmail && selected.actorName ? (
                        <div className="text-xs text-[var(--color-text-muted)]">
                          {selected.actorEmail}
                        </div>
                      ) : null}
                      {selected.actorId ? (
                        <div className="text-[11px] text-[var(--color-text-muted)] font-mono">
                          ID: {selected.actorId}
                        </div>
                      ) : null}
                    </dd>
                  </div>

                  {selected.target || selected.targetLabel ? (
                    <div>
                      <dt className="text-xs uppercase text-[var(--color-text-muted)]">Hedef</dt>
                      <dd className="mt-0.5">
                        {selected.targetLabel ? (
                          <div className="font-medium text-[var(--color-text)]">
                            {selected.targetLabel}
                          </div>
                        ) : null}
                        {selected.target ? (
                          <div className="text-[11px] text-[var(--color-text-muted)] font-mono break-all">
                            {selected.target}
                          </div>
                        ) : null}
                        {link ? (
                          <Link
                            to={link.to}
                            className="mt-1 inline-block text-xs text-[var(--color-brand-blue)] underline"
                          >
                            {link.label} →
                          </Link>
                        ) : null}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </section>

              {diff && (diff.before !== undefined || diff.after !== undefined) ? (
                <section>
                  <h3 className="text-xs uppercase text-[var(--color-text-muted)] mb-2">
                    Değişiklik (önce → sonra)
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <pre className="max-h-64 overflow-auto rounded bg-red-50 p-3 text-[11px] border border-red-200">
                      {JSON.stringify(diff.before ?? null, null, 2)}
                    </pre>
                    <pre className="max-h-64 overflow-auto rounded bg-emerald-50 p-3 text-[11px] border border-emerald-200">
                      {JSON.stringify(diff.after ?? null, null, 2)}
                    </pre>
                  </div>
                </section>
              ) : null}

              <section>
                <button
                  type="button"
                  onClick={() => setShowTech((v) => !v)}
                  className="text-xs font-medium text-[var(--color-brand-blue)] hover:underline"
                  aria-expanded={showTech}
                >
                  {showTech ? "▾ Teknik detayı gizle" : "▸ Teknik detayı göster"}
                </button>

                {showTech ? (
                  <div className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3 space-y-3">
                    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      <div>
                        <dt className="text-[10px] uppercase text-[var(--color-text-muted)]">
                          Aksiyon Kodu
                        </dt>
                        <dd className="font-mono">{selected.action}</dd>
                      </div>
                      <div>
                        <dt className="text-[10px] uppercase text-[var(--color-text-muted)]">
                          Log ID
                        </dt>
                        <dd className="font-mono break-all">{selected.id}</dd>
                      </div>
                      <div>
                        <dt className="text-[10px] uppercase text-[var(--color-text-muted)]">IP</dt>
                        <dd className="font-mono break-all">
                          {selected.ip ?? metaValue<string>(selected.metadata, "ip") ?? "—"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[10px] uppercase text-[var(--color-text-muted)]">
                          Cihaz
                        </dt>
                        <dd>
                          {selected.deviceType ??
                            metaValue<string>(selected.metadata, "deviceType") ??
                            "—"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[10px] uppercase text-[var(--color-text-muted)]">
                          HTTP Durum
                        </dt>
                        <dd>
                          {selected.statusCode ??
                            metaValue<number>(selected.metadata, "statusCode") ??
                            "—"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[10px] uppercase text-[var(--color-text-muted)]">
                          Süre (ms)
                        </dt>
                        <dd>
                          {selected.durationMs ??
                            metaValue<number>(selected.metadata, "durationMs") ??
                            "—"}
                        </dd>
                      </div>
                    </dl>

                    <div>
                      <dt className="text-[10px] uppercase text-[var(--color-text-muted)] mb-1">
                        User Agent
                      </dt>
                      <dd className="text-[11px] font-mono break-all">
                        {selected.userAgent ??
                          metaValue<string>(selected.metadata, "userAgent") ??
                          "—"}
                      </dd>
                    </div>

                    <div>
                      <dt className="text-[10px] uppercase text-[var(--color-text-muted)] mb-1">
                        Ham Metadata
                      </dt>
                      <dd>
                        <pre className="max-h-72 overflow-auto rounded bg-white border border-[var(--color-border)] p-3 text-[11px]">
                          {JSON.stringify(selected.metadata, null, 2)}
                        </pre>
                      </dd>
                    </div>
                  </div>
                ) : null}
              </section>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
