import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useRequireAuth } from "../lib/auth";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import {
  fetchAuditTodaySummary,
  type AuditTodaySummary,
} from "../lib/audit";
import { actionLabel, formatActor } from "../lib/auditLabels";

const SUSPICIOUS_LABELS: Record<
  AuditTodaySummary["suspicious"][number]["kind"],
  { title: string; color: string; icon: string }
> = {
  rapid_delete: {
    title: "Hızlı ardışık silme",
    color: "border-rose-300 bg-rose-50 text-rose-900",
    icon: "⚠️",
  },
  auth_failures: {
    title: "Tekrarlayan giriş hatası",
    color: "border-amber-300 bg-amber-50 text-amber-900",
    icon: "🔐",
  },
  permission_denied: {
    title: "Yetkisiz erişim denemesi",
    color: "border-orange-300 bg-orange-50 text-orange-900",
    icon: "🚫",
  },
};

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("tr-TR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("tr-TR", {
      day: "2-digit",
      month: "long",
      year: "numeric",
      weekday: "long",
    });
  } catch {
    return iso;
  }
}

interface StatCardProps {
  label: string;
  value: number | string;
  hint?: string;
  accent: string;
}

function StatCard({ label, value, hint, accent }: StatCardProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-[11px] uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div className={`mt-2 text-3xl font-semibold tabular-nums ${accent}`}>
        {value}
      </div>
      {hint ? (
        <div className="mt-1 text-xs text-slate-500">{hint}</div>
      ) : null}
    </div>
  );
}

interface BarRowProps {
  label: string;
  count: number;
  max: number;
  hint?: string;
  href?: string;
}

function BarRow({ label, count, max, hint, href }: BarRowProps) {
  const pct = max > 0 ? Math.max(4, Math.round((count / max) * 100)) : 0;
  const content = (
    <div className="grid grid-cols-[1fr_auto] items-center gap-3">
      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-3">
          <div className="truncate text-sm font-medium text-slate-800">
            {label}
          </div>
          {hint ? (
            <div className="shrink-0 text-[11px] text-slate-500">{hint}</div>
          ) : null}
        </div>
        <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-indigo-600"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <div className="text-sm font-semibold tabular-nums text-slate-700">
        {count}
      </div>
    </div>
  );
  if (href) {
    return (
      <Link
        to={href}
        className="block rounded-lg p-2 -mx-2 transition hover:bg-slate-50"
      >
        {content}
      </Link>
    );
  }
  return <div className="p-2 -mx-2">{content}</div>;
}

export default function AuditTodayDashboardPage(): React.ReactElement | null {
  useDocumentTitle("Bugün ne oldu?");
  const authed = useRequireAuth();

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["audit", "today-summary"],
    queryFn: fetchAuditTodaySummary,
    enabled: authed,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const maxAction = useMemo(
    () => (data?.byAction.length ? data.byAction[0].count : 0),
    [data],
  );
  const maxActor = useMemo(
    () => (data?.byActor.length ? data.byActor[0].count : 0),
    [data],
  );

  if (!authed) return null;

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-500">
            Faaliyet Paneli
          </div>
          <h1 className="text-2xl font-semibold text-slate-900">
            Bugün ne oldu?
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {data?.date
              ? formatDate(`${data.date}T00:00:00`)
              : "Bugünün özet panosu"}
            {" · "}1 dakikada bir yenilenir.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/loglar"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Tüm logları aç
          </Link>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
          >
            {isFetching ? "Yenileniyor…" : "Yenile"}
          </button>
        </div>
      </div>

      {isError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          Özet yüklenemedi: {(error as Error)?.message ?? "bilinmeyen hata"}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Toplam Olay"
          value={isLoading ? "…" : data?.totalEvents ?? 0}
          hint="Bugün kaydedilen tüm aktiviteler"
          accent="text-indigo-700"
        />
        <StatCard
          label="Aktif Aktörler"
          value={isLoading ? "…" : data?.actorCount ?? 0}
          hint="Benzersiz kullanıcı/sistem sayısı"
          accent="text-emerald-700"
        />
        <StatCard
          label="Şüpheli Sinyal"
          value={isLoading ? "…" : data?.suspicious.length ?? 0}
          hint="Tespit edilen anormal pattern"
          accent={
            (data?.suspicious.length ?? 0) > 0
              ? "text-rose-700"
              : "text-slate-700"
          }
        />
        <StatCard
          label="En Yoğun Aksiyon"
          value={
            isLoading
              ? "…"
              : data?.byAction[0]
                ? actionLabel(data.byAction[0].action)
                : "—"
          }
          hint={
            data?.byAction[0]
              ? `${data.byAction[0].count} kez tekrarlandı`
              : undefined
          }
          accent="text-slate-900 text-lg leading-tight"
        />
      </div>

      {data && data.suspicious.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-700">
            Güvenlik uyarıları
          </h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.suspicious.map((s, idx) => {
              const meta = SUSPICIOUS_LABELS[s.kind];
              return (
                <div
                  key={`${s.kind}:${s.actorId ?? "anon"}:${idx}`}
                  className={`rounded-xl border p-4 ${meta.color}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-lg" aria-hidden>
                        {meta.icon}
                      </span>
                      <span className="text-sm font-semibold">
                        {meta.title}
                      </span>
                    </div>
                    <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs font-medium">
                      {s.count}× son {s.windowMinutes} dk
                    </span>
                  </div>
                  <div className="mt-2 text-xs">
                    Aktör:{" "}
                    <span className="font-medium">
                      {s.email ?? s.actorId ?? "anonim"}
                    </span>
                  </div>
                  {s.sample.length ? (
                    <ul className="mt-2 space-y-0.5 text-[11px] font-mono opacity-80">
                      {s.sample.slice(0, 3).map((sample, i) => (
                        <li key={i} className="truncate">
                          • {sample}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">
              Aksiyon dağılımı
            </h2>
            <span className="text-[11px] text-slate-500">İlk 12</span>
          </div>
          {isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="h-10 animate-pulse rounded-lg bg-slate-100"
                />
              ))}
            </div>
          ) : data && data.byAction.length ? (
            <div className="space-y-1">
              {data.byAction.map((row) => (
                <BarRow
                  key={row.action}
                  label={actionLabel(row.action)}
                  count={row.count}
                  max={maxAction}
                  hint={row.action}
                />
              ))}
            </div>
          ) : (
            <div className="text-sm text-slate-500">Bugün kayıt yok.</div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">
              En aktif aktörler
            </h2>
            <span className="text-[11px] text-slate-500">İlk 12</span>
          </div>
          {isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="h-10 animate-pulse rounded-lg bg-slate-100"
                />
              ))}
            </div>
          ) : data && data.byActor.length ? (
            <div className="space-y-1">
              {data.byActor.map((row, idx) => (
                <BarRow
                  key={`${row.actorId ?? "anon"}-${idx}`}
                  label={formatActor(row.name, row.email, row.actorId)}
                  count={row.count}
                  max={maxActor}
                  hint={row.actorType ?? undefined}
                  href={
                    row.actorId
                      ? `/loglar?actorId=${encodeURIComponent(row.actorId)}`
                      : undefined
                  }
                />
              ))}
            </div>
          ) : (
            <div className="text-sm text-slate-500">Bugün aktör yok.</div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">
              Son olaylar
            </h2>
            <Link
              to="/loglar"
              className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
            >
              Tümü →
            </Link>
          </div>
          {isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="h-12 animate-pulse rounded-lg bg-slate-100"
                />
              ))}
            </div>
          ) : data && data.recent.length ? (
            <ul className="divide-y divide-slate-100">
              {data.recent.map((row) => (
                <li key={row.id} className="py-2.5 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-800">
                        {actionLabel(row.action)}
                      </div>
                      <div className="truncate text-xs text-slate-500">
                        {formatActor(
                          row.actorName,
                          row.actorEmail,
                          (row as Record<string, unknown>).actorId as string | undefined,
                        )}
                        {row.target ? ` • ${row.target}` : ""}
                      </div>
                      {row.summary ? (
                        <div className="mt-0.5 truncate text-[11px] text-slate-400">
                          {row.summary}
                        </div>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-[11px] tabular-nums text-slate-500">
                      {formatTime(row.createdAt)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-sm text-slate-500">Bugün kayıt yok.</div>
          )}
        </section>
      </div>
    </div>
  );
}
