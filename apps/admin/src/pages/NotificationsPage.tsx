import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getVapidPublicKey,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  openNotificationStream,
  subscribeBrowserPush,
  unsubscribeBrowserPush,
  urlBase64ToUint8Array,
  type AdminNotification,
  type NotificationSeverity,
} from "../lib/notifications";

type Filter = "all" | "unread";

const SEVERITY_STYLES: Record<NotificationSeverity, string> = {
  info: "bg-sky-100 text-sky-700",
  success: "bg-emerald-100 text-emerald-700",
  warning: "bg-amber-100 text-amber-700",
  error: "bg-rose-100 text-rose-700",
};

const SEVERITY_LABEL: Record<NotificationSeverity, string> = {
  info: "Bilgi",
  success: "Başarılı",
  warning: "Uyarı",
  error: "Hata",
};

const TYPE_LABEL: Record<string, string> = {
  "order.new": "Yeni Sipariş",
  "order.status": "Sipariş Durumu",
  "lead.new": "Yeni Başvuru",
  "stock.low": "Düşük Stok",
  "supplier.balance.low": "Düşük Bakiye",
  "support.message": "Destek Mesajı",
  system: "Sistem",
};

function dateBucket(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date): boolean =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(d, today)) return "Bugün";
  if (sameDay(d, yest)) return "Dün";
  return d.toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface PushState {
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  subscribed: boolean;
  endpoint: string | null;
  loading: boolean;
  error: string | null;
}

function getInitialPushState(): PushState {
  if (typeof window === "undefined") {
    return {
      supported: false,
      permission: "unsupported",
      subscribed: false,
      endpoint: null,
      loading: false,
      error: null,
    };
  }
  const supported =
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window;
  return {
    supported,
    permission: supported ? Notification.permission : "unsupported",
    subscribed: false,
    endpoint: null,
    loading: false,
    error: null,
  };
}

export default function NotificationsPage(): React.ReactElement {
  const [filter, setFilter] = useState<Filter>("all");
  const [pushState, setPushState] = useState<PushState>(getInitialPushState);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const notificationsQuery = useQuery({
    queryKey: ["admin", "notifications", "page", filter],
    queryFn: () => listNotifications(filter),
    refetchOnWindowFocus: true,
  });

  const items = notificationsQuery.data?.items ?? [];

  const groups = useMemo(() => {
    const map = new Map<string, AdminNotification[]>();
    for (const n of items) {
      const k = dateBucket(n.createdAt);
      const existing = map.get(k) ?? [];
      existing.push(n);
      map.set(k, existing);
    }
    return Array.from(map.entries());
  }, [items]);

  // SSE — yeni bildirim geldiğinde listeyi tazele
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

  // Mevcut push abonelik durumunu service worker'dan oku
  useEffect(() => {
    let cancelled = false;
    if (!pushState.supported) return;
    void (async (): Promise<void> => {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (!reg) return;
        const sub = await reg.pushManager.getSubscription();
        if (cancelled) return;
        if (sub) {
          setPushState((s) => ({
            ...s,
            subscribed: true,
            endpoint: sub.endpoint,
          }));
        }
      } catch {
        // ignore
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, [pushState.supported]);

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
    if (!n.readAt) markReadMutation.mutate(n.id);
    if (n.link) navigate(n.link);
  };

  const handleEnablePush = async (): Promise<void> => {
    setPushState((s) => ({ ...s, loading: true, error: null }));
    try {
      const key = await getVapidPublicKey();
      if (!key) {
        throw new Error("Sunucu VAPID anahtarı yapılandırılmamış.");
      }
      let reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        reg = await navigator.serviceWorker.register("/admin/sw.js");
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPushState((s) => ({
          ...s,
          loading: false,
          permission,
          error: "İzin verilmedi.",
        }));
        return;
      }
      const applicationServerKey = urlBase64ToUint8Array(key);
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey as BufferSource,
      });
      await subscribeBrowserPush(sub);
      setPushState((s) => ({
        ...s,
        loading: false,
        permission,
        subscribed: true,
        endpoint: sub.endpoint,
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Beklenmeyen hata.";
      setPushState((s) => ({ ...s, loading: false, error: msg }));
    }
  };

  const handleDisablePush = async (): Promise<void> => {
    setPushState((s) => ({ ...s, loading: true, error: null }));
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await unsubscribeBrowserPush(sub.endpoint);
        await sub.unsubscribe();
      }
      setPushState((s) => ({
        ...s,
        loading: false,
        subscribed: false,
        endpoint: null,
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Beklenmeyen hata.";
      setPushState((s) => ({ ...s, loading: false, error: msg }));
    }
  };

  const unread = notificationsQuery.data?.unreadCount ?? 0;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--color-border)] pb-4">
        <div>
          <h1 className="text-xl font-semibold text-[var(--color-text)]">
            Bildirim Merkezi
          </h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Siparişler, iadeler, başvurular ve sistem uyarıları tek yerde.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => markAllMutation.mutate()}
            disabled={unread === 0 || markAllMutation.isPending}
            className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1.5 text-sm text-[var(--color-text)] transition hover:bg-[var(--color-surface-muted)] disabled:cursor-not-allowed disabled:text-gray-400"
          >
            Tümünü okundu işaretle
          </button>
        </div>
      </header>

      {/* Browser push card */}
      <section className="rounded-lg border border-[var(--color-border)] bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-xl">
            <h2 className="text-sm font-semibold text-[var(--color-text)]">
              Tarayıcı bildirimleri
            </h2>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Tarayıcı sekmeniz arka planda olsa bile yeni sipariş veya kritik
              uyarılar masaüstü bildirimi olarak görüntülenir.
            </p>
            {pushState.error ? (
              <p className="mt-2 text-xs text-rose-600">{pushState.error}</p>
            ) : null}
            {!pushState.supported ? (
              <p className="mt-2 text-xs text-amber-600">
                Tarayıcınız push bildirimlerini desteklemiyor.
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full px-2 py-1 text-[11px] font-semibold ${
                pushState.subscribed
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-gray-100 text-gray-600"
              }`}
            >
              {pushState.subscribed ? "Açık" : "Kapalı"}
            </span>
            {pushState.subscribed ? (
              <button
                type="button"
                onClick={handleDisablePush}
                disabled={pushState.loading}
                className="rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed"
              >
                Kapat
              </button>
            ) : (
              <button
                type="button"
                onClick={handleEnablePush}
                disabled={!pushState.supported || pushState.loading}
                className="rounded-md bg-[var(--color-brand-navy)] px-3 py-1.5 text-sm text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pushState.loading ? "..." : "Açmak için tıkla"}
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 border-b border-[var(--color-border)]">
        {(["all", "unread"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
              filter === f
                ? "border-[var(--color-brand-navy)] text-[var(--color-brand-navy)]"
                : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            }`}
          >
            {f === "all" ? "Tümü" : `Okunmamış${unread > 0 ? ` (${unread})` : ""}`}
          </button>
        ))}
      </div>

      {/* List */}
      <section className="rounded-lg border border-[var(--color-border)] bg-white shadow-sm">
        {notificationsQuery.isLoading ? (
          <div className="px-4 py-10 text-center text-sm text-gray-500">
            Yükleniyor…
          </div>
        ) : groups.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-gray-500">
            {filter === "unread"
              ? "Okunmamış bildirim yok."
              : "Henüz bildirim yok."}
          </div>
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {groups.map(([bucket, list]) => (
              <li key={bucket}>
                <p className="bg-[var(--color-surface-muted)] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                  {bucket}
                </p>
                <ul className="divide-y divide-[var(--color-border)]">
                  {list.map((n) => (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => handleItemClick(n)}
                        className={`flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-[var(--color-surface-muted)] ${
                          n.readAt ? "" : "bg-sky-50/40"
                        }`}
                      >
                        <span
                          className={`mt-0.5 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            SEVERITY_STYLES[n.severity] ?? SEVERITY_STYLES.info
                          }`}
                        >
                          {SEVERITY_LABEL[n.severity] ?? n.severity}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <p
                              className={`text-sm leading-snug ${
                                n.readAt
                                  ? "text-[var(--color-text-muted)]"
                                  : "font-semibold text-[var(--color-text)]"
                              }`}
                            >
                              {n.title}
                            </p>
                            <span className="text-[11px] text-gray-400">
                              {formatTime(n.createdAt)}
                            </span>
                          </div>
                          {n.body ? (
                            <p className="mt-0.5 text-xs text-gray-600">
                              {n.body}
                            </p>
                          ) : null}
                          <div className="mt-1 flex items-center gap-2 text-[11px] text-gray-400">
                            <span>{TYPE_LABEL[n.type] ?? n.type}</span>
                            {n.link ? (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="text-[var(--color-brand-navy)]">
                                  Detaya git →
                                </span>
                              </>
                            ) : null}
                          </div>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
