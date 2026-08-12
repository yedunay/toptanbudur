import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useRequireAuth } from "../lib/auth";
import {
  conversationUnread,
  fetchConversations,
  type ConversationListItem,
  type ConversationType,
} from "../lib/conversations";
import { formatDateTime } from "../lib/orders";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import ConversationChat from "../components/ConversationChat";

const TYPE_FILTERS: ReadonlyArray<{
  value: ConversationType | "ALL";
  label: string;
}> = [
  { value: "ALL", label: "Tümü" },
  { value: "DEALER_RETURN_ORDER", label: "İade Satış" },
  { value: "SUPPORT", label: "Destek" },
];

/**
 * Bildirimden (iade sohbeti) gelen deep-link: `/konusmalar?conversationId=...`.
 * Admin bildirime tıkladığında bu sayfa açılır ve ilgili sohbet otomatik seçilir.
 */
function readDeepLinkConversationId(): string | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("conversationId");
  return value && value.trim().length > 0 ? value : null;
}

export default function KonusmalarPage(): React.ReactElement | null {
  useDocumentTitle("Konuşmalar");
  const authed = useRequireAuth();

  const [searchParams, setSearchParams] = useSearchParams();
  const [typeFilter, setTypeFilter] = useState<ConversationType | "ALL">("ALL");
  // Bildirim deep-link'i varsa ilgili sohbeti baştan seç (ilk paint'te flicker
  // olmasın); yoksa ilk sohbet otomatik seçilir (aşağıdaki effect). 'ALL' filtre
  // iade sohbetini de kapsar.
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    readDeepLinkConversationId(),
  );

  const listQuery = useQuery({
    queryKey: ["admin", "conversations", typeFilter],
    queryFn: () =>
      fetchConversations(
        typeFilter === "ALL" ? undefined : (typeFilter as ConversationType),
      ),
    enabled: authed,
    refetchInterval: 30_000,
  });

  const items: ConversationListItem[] = useMemo(
    () => listQuery.data ?? [],
    [listQuery.data],
  );

  // Bildirim deep-link'i: ?conversationId değişince (ilk mount VEYA admin zaten
  // bu sayfadayken yeni bir bildirime tıklama — aynı route, query değişir) ilgili
  // sohbeti seç ve param'ı URL'den temizle. Temizleme, sonraki filtre değişimi /
  // yenileme akışlarının deep-link'e takılmamasını sağlar.
  useEffect(() => {
    const id = searchParams.get("conversationId");
    if (!id) return;
    setSelectedId(id);
    const next = new URLSearchParams(searchParams);
    next.delete("conversationId");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  // İlk konuşmayı otomatik seç. Deep-link beklerken (URL'de conversationId hâlâ
  // duruyorsa) atla — yukarıdaki effect ilgili sohbeti seçecek (yarış önlenir).
  useEffect(() => {
    if (selectedId) return;
    if (searchParams.get("conversationId")) return;
    if (items.length > 0) setSelectedId(items[0].id);
  }, [items, selectedId, searchParams]);

  if (!authed) return null;

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-[var(--color-text)]">
          Konuşmalar
        </h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Tüm sohbetler tek yerde. Admin tam gerçek isimlerle görüntüler ve
          yanıtlayabilir.
        </p>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {TYPE_FILTERS.map((f) => {
          const isActive = typeFilter === f.value;
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => {
                setTypeFilter(f.value);
                setSelectedId(null);
              }}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                isActive
                  ? "border-[var(--color-brand-blue)] bg-[var(--color-brand-blue)] text-white"
                  : "border-[var(--color-border)] bg-white text-[var(--color-text)] hover:bg-[var(--color-surface-muted)]"
              }`}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
        <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-white">
          {listQuery.isLoading ? (
            <div className="px-3 py-8 text-center text-sm text-[var(--color-text-muted)]">
              Yükleniyor…
            </div>
          ) : listQuery.isError ? (
            <div className="flex items-center justify-between p-4 text-sm text-red-700">
              <span>
                {listQuery.error instanceof Error
                  ? listQuery.error.message
                  : "Veri alınamadı"}
              </span>
              <button
                type="button"
                onClick={() => void listQuery.refetch()}
                className="rounded-md border border-red-300 bg-white px-2 py-1 text-xs text-red-700 hover:bg-red-100"
              >
                Tekrar dene
              </button>
            </div>
          ) : items.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-[var(--color-text-muted)]">
              Konuşma bulunmuyor
            </div>
          ) : (
            <ul className="max-h-[70vh] divide-y divide-[var(--color-border)] overflow-y-auto">
              {items.map((c) => {
                const unread = conversationUnread(c);
                const isActive = selectedId === c.id;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(c.id)}
                      className={`flex w-full flex-col items-start gap-1 px-3 py-2.5 text-left transition ${
                        isActive
                          ? "bg-[var(--color-surface-muted)]"
                          : "hover:bg-[var(--color-surface-muted)]"
                      }`}
                    >
                      <div className="flex w-full items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-[var(--color-text)]">
                          {c.orderCode
                            ? `#${c.orderCode}`
                            : c.subject ?? "Konuşma"}
                        </span>
                        {unread > 0 ? (
                          <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white">
                            {unread > 99 ? "99+" : unread}
                          </span>
                        ) : null}
                      </div>
                      {c.buyerName ? (
                        <span className="truncate text-xs font-light text-[var(--color-text-muted)]">
                          {c.buyerName}
                        </span>
                      ) : null}
                      {c.orderCode && c.subject ? (
                        <span className="line-clamp-1 text-[11px] text-[var(--color-text-muted)]">
                          {c.subject}
                        </span>
                      ) : c.lastMessagePreview ? (
                        <span className="line-clamp-1 text-[11px] text-[var(--color-text-muted)]">
                          {c.lastMessagePreview}
                        </span>
                      ) : null}
                      <span className="text-[10px] text-[var(--color-text-muted)]">
                        {c.lastMessageAt ? formatDateTime(c.lastMessageAt) : "—"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div>
          {selectedId ? (
            <ConversationChat
              conversationId={selectedId}
              heightClass="max-h-[60vh]"
            />
          ) : (
            <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface-muted)] p-10 text-center text-sm text-[var(--color-text-muted)]">
              Bir konuşma seçin.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
