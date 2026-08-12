import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  openNotificationStream,
  type AdminNotification,
  type NotificationSeverity,
} from "../lib/notifications";

interface NotificationsBellProps {
  /** Notifications detay sayfasının yolu. */
  fullPagePath?: string;
}

const SEVERITY_DOT: Record<NotificationSeverity, string> = {
  info: "bg-sky-400",
  success: "bg-emerald-400",
  warning: "bg-amber-400",
  error: "bg-rose-500",
};

const REL_UNITS: ReadonlyArray<{ limit: number; div: number; label: string }> = [
  { limit: 60, div: 1, label: "sn" },
  { limit: 3_600, div: 60, label: "dk" },
  { limit: 86_400, div: 3_600, label: "sa" },
  { limit: 2_592_000, div: 86_400, label: "g" },
];

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Math.max(1, Math.floor((Date.now() - then) / 1000));
  for (const u of REL_UNITS) {
    if (diff < u.limit) return `${Math.floor(diff / u.div)} ${u.label} önce`;
  }
  return new Date(iso).toLocaleDateString("tr-TR");
}

export default function NotificationsBell({
  fullPagePath = "/bildirimler",
}: NotificationsBellProps): React.ReactElement {
  const [open, setOpen] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const notificationsQuery = useQuery({
    queryKey: ["admin", "notifications", "preview"],
    queryFn: () => listNotifications("all"),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const items = notificationsQuery.data?.items ?? [];
  const unread = notificationsQuery.data?.unreadCount ?? 0;
  const previewItems = useMemo(() => items.slice(0, 8), [items]);

  // SSE stream — backend yeni bildirim emit ettiğinde anında dropdown'u tazele.
  useEffect(() => {
    const es = openNotificationStream({
      onMessage: () => {
        qc.invalidateQueries({ queryKey: ["admin", "notifications"] });
      },
    });
    return (): void => {
      es?.close();
    };
  }, [qc]);

  // Click-outside ve Escape ile kapat
  useEffect(() => {
    if (!open) return;
    const handlePointer = (event: MouseEvent): void => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return (): void => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const markReadMutation = useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "notifications"] });
    },
  });

  const markAllMutation = useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "notifications"] });
    },
  });

  const handleItemClick = (n: AdminNotification): void => {
    if (!n.readAt) {
      markReadMutation.mutate(n.id);
    }
    setOpen(false);
    if (n.link) {
      navigate(n.link);
    } else {
      navigate(fullPagePath);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Bildirimler${unread > 0 ? `, ${unread} okunmamış` : ""}`}
        aria-expanded={open}
        aria-haspopup="menu"
        className="relative inline-flex items-center justify-center w-9 h-9 rounded-full text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-5 h-5"
        >
          <path d="M6 8a6 6 0 1 1 12 0c0 4.5 1.5 6 2 7H4c.5-1 2-2.5 2-7Z" />
          <path d="M10.5 19a1.5 1.5 0 0 0 3 0" />
        </svg>
        {unread > 0 ? (
          <span
            className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-rose-500 text-[10px] font-bold text-white leading-none ring-2 ring-white"
            aria-hidden="true"
          >
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-11 z-50 w-[22rem] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-lg border border-[var(--color-border)] bg-white shadow-xl"
        >
          <header className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-[var(--color-text)]">
                Bildirimler
              </span>
              {unread > 0 ? (
                <span className="inline-flex items-center rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">
                  {unread} yeni
                </span>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => markAllMutation.mutate()}
              disabled={unread === 0 || markAllMutation.isPending}
              className="text-xs text-[var(--color-brand-navy)] hover:underline disabled:cursor-not-allowed disabled:text-gray-400"
            >
              Tümünü okundu işaretle
            </button>
          </header>

          <ul className="max-h-[24rem] overflow-y-auto divide-y divide-[var(--color-border)]">
            {notificationsQuery.isLoading ? (
              <li className="px-3 py-6 text-center text-sm text-gray-500">
                Yükleniyor…
              </li>
            ) : previewItems.length === 0 ? (
              <li className="px-3 py-8 text-center text-sm text-gray-500">
                Henüz bildirim yok.
              </li>
            ) : (
              previewItems.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => handleItemClick(n)}
                    className={`flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition hover:bg-[var(--color-surface-muted)] ${
                      n.readAt ? "" : "bg-sky-50/60"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`mt-1.5 inline-block w-2 h-2 rounded-full flex-shrink-0 ${
                        SEVERITY_DOT[n.severity] ?? SEVERITY_DOT.info
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <p
                        className={`text-sm leading-snug ${
                          n.readAt
                            ? "text-[var(--color-text-muted)]"
                            : "font-semibold text-[var(--color-text)]"
                        }`}
                      >
                        {n.title}
                      </p>
                      {n.body ? (
                        <p className="mt-0.5 line-clamp-2 text-xs text-gray-600">
                          {n.body}
                        </p>
                      ) : null}
                      <p className="mt-1 text-[11px] text-gray-400">
                        {relativeTime(n.createdAt)}
                      </p>
                    </div>
                  </button>
                </li>
              ))
            )}
          </ul>

          <footer className="border-t border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 text-center">
            <Link
              to={fullPagePath}
              onClick={() => setOpen(false)}
              className="text-xs font-semibold text-[var(--color-brand-navy)] hover:underline"
            >
              Tümünü gör →
            </Link>
          </footer>
        </div>
      ) : null}
    </div>
  );
}
