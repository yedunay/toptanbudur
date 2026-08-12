import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useRequireAuth } from "../lib/auth";
import {
  SUPPORT_STATUS_LABELS,
  SUPPORT_STATUS_ORDER,
  deleteSupportMessage,
  fetchSupportMessages,
  updateSupportMessage,
  type SupportFilters,
  type SupportListResponse,
  type SupportMessage,
  type SupportMessageStatus,
} from "../lib/supportMessages";
import { formatDateTime } from "../lib/orders";
import { useToast } from "../components/Toast";
import ConfirmDialog from "../components/ConfirmDialog";
import ConversationChat from "../components/ConversationChat";
import { useDebounce } from "../lib/useDebounce";
import { useDocumentTitle } from "../lib/useDocumentTitle";

const PAGE_SIZE = 50;

function statusColor(status: SupportMessageStatus): string {
  switch (status) {
    case "NEW":
      return "bg-amber-50 text-amber-800 border-amber-200";
    case "READ":
      return "bg-sky-50 text-sky-700 border-sky-200";
    case "REPLIED":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "ARCHIVED":
      return "bg-slate-100 text-slate-600 border-slate-200";
  }
}

const UNDO_LS_KEY = "tb_support_undo_v1";

function loadUndoMap(): Record<string, SupportMessageStatus> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(UNDO_LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, SupportMessageStatus>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveUndoMap(map: Record<string, SupportMessageStatus>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(UNDO_LS_KEY, JSON.stringify(map));
  } catch {
    // ignore quota errors
  }
}

type SortKey = "createdAt" | "name" | "email" | "subject" | "status";
type SortDir = "asc" | "desc";

function compareStrings(a: string | null | undefined, b: string | null | undefined): number {
  return (a ?? "").localeCompare(b ?? "", "tr");
}

export default function SupportMessagesPage(): React.ReactElement | null {
  useDocumentTitle("Destek Mesajları (eski)");
  const authed = useRequireAuth();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [statusFilter, setStatusFilter] = useState<SupportMessageStatus | "">("");
  const [searchInput, setSearchInput] = useState<string>("");
  const search = useDebounce(searchInput, 250);
  const [page, setPage] = useState<number>(1);
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [selected, setSelected] = useState<SupportMessage | null>(null);
  const [draftStatus, setDraftStatus] = useState<SupportMessageStatus>("NEW");
  const [draftNote, setDraftNote] = useState<string>("");
  const [confirmDelete, setConfirmDelete] = useState<SupportMessage | null>(null);
  const [confirmHardDelete, setConfirmHardDelete] = useState<SupportMessage | null>(null);
  const [undoMap, setUndoMap] = useState<Record<string, SupportMessageStatus>>(
    () => loadUndoMap(),
  );

  useEffect(() => {
    if (!selected) return;
    setDraftStatus(selected.status);
    setDraftNote(selected.adminNote ?? "");
  }, [selected]);

  const filters: SupportFilters = useMemo(
    () => ({
      status: statusFilter || undefined,
      page,
      pageSize: PAGE_SIZE,
    }),
    [statusFilter, page],
  );

  const messagesQuery = useQuery<SupportListResponse>({
    queryKey: ["support-messages", filters],
    queryFn: () => fetchSupportMessages(filters),
    enabled: authed,
    refetchInterval: 60_000,
  });

  // Auto-mark NEW messages as READ when opened
  useEffect(() => {
    if (!selected) return;
    if (selected.status !== "NEW") return;
    updateSupportMessage(selected.id, { status: "READ" })
      .then((updated) => {
        const next = { ...undoMap, [selected.id]: "NEW" as SupportMessageStatus };
        setUndoMap(next);
        saveUndoMap(next);
        setSelected(updated);
        void queryClient.invalidateQueries({ queryKey: ["support-messages"] });
        void queryClient.invalidateQueries({ queryKey: ["support-messages", "count"] });
      })
      .catch(() => {
        // silent — admin can still update manually
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  const updateMutation = useMutation({
    mutationFn: (vars: {
      id: string;
      patch: { status?: SupportMessageStatus; adminNote?: string };
      prevStatus?: SupportMessageStatus;
    }) => updateSupportMessage(vars.id, vars.patch),
    onSuccess: (data, vars) => {
      toast.push("success", "Kaydedildi");
      if (
        vars.prevStatus &&
        vars.patch.status &&
        vars.patch.status !== vars.prevStatus
      ) {
        const next = { ...undoMap, [vars.id]: vars.prevStatus };
        setUndoMap(next);
        saveUndoMap(next);
      }
      void queryClient.invalidateQueries({ queryKey: ["support-messages"] });
      void queryClient.invalidateQueries({ queryKey: ["support-messages", "count"] });
      setSelected(data);
    },
    onError: (err) => {
      toast.push("error", err instanceof Error ? err.message : "Kaydedilemedi");
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => deleteSupportMessage(id, { hard: false }),
    onSuccess: () => {
      toast.push("success", "Mesaj arşivlendi");
      void queryClient.invalidateQueries({ queryKey: ["support-messages"] });
      setSelected(null);
    },
    onError: (err) => {
      toast.push("error", err instanceof Error ? err.message : "Arşivleme başarısız");
    },
  });

  const hardDeleteMutation = useMutation({
    mutationFn: (id: string) => deleteSupportMessage(id, { hard: true }),
    onSuccess: () => {
      toast.push("success", "Mesaj kalıcı olarak silindi");
      void queryClient.invalidateQueries({ queryKey: ["support-messages"] });
      setSelected(null);
    },
    onError: (err) => {
      toast.push("error", err instanceof Error ? err.message : "Silme başarısız");
    },
  });

  const items = messagesQuery.data?.data ?? [];
  const meta = messagesQuery.data?.meta;

  const filteredSorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    let arr = items;
    if (q) {
      arr = items.filter((it) =>
        [it.name, it.email, it.subject ?? "", it.body]
          .join(" ")
          .toLowerCase()
          .includes(q),
      );
    }
    const sorted = [...arr].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "createdAt":
          cmp = a.createdAt.localeCompare(b.createdAt);
          break;
        case "name":
          cmp = compareStrings(a.name, b.name);
          break;
        case "email":
          cmp = compareStrings(a.email, b.email);
          break;
        case "subject":
          cmp = compareStrings(a.subject, b.subject);
          break;
        case "status":
          cmp =
            SUPPORT_STATUS_ORDER.indexOf(a.status) -
            SUPPORT_STATUS_ORDER.indexOf(b.status);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [items, search, sortKey, sortDir]);

  function toggleSort(key: SortKey): void {
    if (key === sortKey) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "createdAt" ? "desc" : "asc");
    }
  }

  function sortIndicator(key: SortKey): string {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " ↑" : " ↓";
  }

  function handleSave(): void {
    if (!selected) return;
    const patch: { status?: SupportMessageStatus; adminNote?: string } = {};
    if (draftStatus !== selected.status) patch.status = draftStatus;
    if ((draftNote ?? "") !== (selected.adminNote ?? "")) {
      patch.adminNote = draftNote;
    }
    if (Object.keys(patch).length === 0) {
      toast.push("info", "Değişiklik yok");
      return;
    }
    updateMutation.mutate({
      id: selected.id,
      patch,
      prevStatus: selected.status,
    });
  }

  function handleUndo(): void {
    if (!selected) return;
    const prev = undoMap[selected.id];
    if (!prev) {
      toast.push("info", "Geri alınacak işlem yok");
      return;
    }
    updateMutation.mutate(
      {
        id: selected.id,
        patch: { status: prev },
      },
      {
        onSuccess: (data) => {
          const next = { ...undoMap };
          delete next[selected.id];
          setUndoMap(next);
          saveUndoMap(next);
          setSelected(data);
        },
      },
    );
  }

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-[var(--color-text)]">
          Destek Mesajları
        </h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {messagesQuery.isLoading
            ? "Yükleniyor…"
            : meta
              ? `${meta.total.toLocaleString("tr-TR")} mesaj`
              : `${items.length} mesaj`}
        </p>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Ad, e-posta, konu, mesaj…"
          className="w-72 rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]"
        />
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as SupportMessageStatus | "");
            setPage(1);
          }}
          className="rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm"
        >
          <option value="">Tüm durumlar</option>
          {SUPPORT_STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {SUPPORT_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

      {messagesQuery.isError ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 flex items-center justify-between">
          <span>
            {messagesQuery.error instanceof Error
              ? messagesQuery.error.message
              : "Veri alınamadı"}
          </span>
          <button
            type="button"
            onClick={() => void messagesQuery.refetch()}
            className="rounded-md border border-red-300 bg-white px-3 py-1 text-xs text-red-700 hover:bg-red-100"
          >
            Tekrar dene
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--color-border)] bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
                <tr>
                  <th
                    className="px-3 py-2 text-left cursor-pointer select-none"
                    onClick={() => toggleSort("name")}
                  >
                    Ad{sortIndicator("name")}
                  </th>
                  <th
                    className="px-3 py-2 text-left cursor-pointer select-none"
                    onClick={() => toggleSort("email")}
                  >
                    E-posta{sortIndicator("email")}
                  </th>
                  <th
                    className="px-3 py-2 text-left cursor-pointer select-none"
                    onClick={() => toggleSort("subject")}
                  >
                    Konu{sortIndicator("subject")}
                  </th>
                  <th
                    className="px-3 py-2 text-center cursor-pointer select-none"
                    onClick={() => toggleSort("status")}
                  >
                    Durum{sortIndicator("status")}
                  </th>
                  <th
                    className="px-3 py-2 text-left cursor-pointer select-none"
                    onClick={() => toggleSort("createdAt")}
                  >
                    Tarih{sortIndicator("createdAt")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {messagesQuery.isLoading ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-8 text-center text-[var(--color-text-muted)]"
                    >
                      Yükleniyor…
                    </td>
                  </tr>
                ) : filteredSorted.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-8 text-center text-[var(--color-text-muted)]"
                    >
                      Destek mesajı bulunamadı
                    </td>
                  </tr>
                ) : (
                  filteredSorted.map((m) => (
                    <tr
                      key={m.id}
                      className={`border-t border-[var(--color-border)] hover:bg-[var(--color-surface-muted)] cursor-pointer ${
                        m.status === "NEW" ? "font-medium" : ""
                      }`}
                      onClick={() => setSelected(m)}
                    >
                      <td className="px-3 py-2">
                        {m.customerId ? (
                          <Link
                            to={`/customers/${m.customerId}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-[var(--color-brand-blue)] hover:underline"
                          >
                            {m.name}
                          </Link>
                        ) : (
                          m.name
                        )}
                      </td>
                      <td className="px-3 py-2 text-[var(--color-text-muted)]">
                        {m.email}
                      </td>
                      <td className="px-3 py-2 text-[var(--color-text-muted)]">
                        {m.subject ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border ${statusColor(m.status)}`}
                        >
                          {SUPPORT_STATUS_LABELS[m.status]}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-[var(--color-text-muted)]">
                        {formatDateTime(m.createdAt)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {meta && meta.totalPages > 1 ? (
            <div className="flex items-center justify-between border-t border-[var(--color-border)] bg-[var(--color-surface-muted)] px-4 py-3 text-sm">
              <span className="text-[var(--color-text-muted)]">
                Sayfa {meta.page} / {meta.totalPages}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={meta.page <= 1 || messagesQuery.isFetching}
                  className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1 text-xs hover:bg-white/70 disabled:opacity-50"
                >
                  Önceki
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={meta.page >= meta.totalPages || messagesQuery.isFetching}
                  className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1 text-xs hover:bg-white/70 disabled:opacity-50"
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
            className="w-full max-w-lg h-full bg-white shadow-xl p-6 overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold">
                  {selected.customerId ? (
                    <Link
                      to={`/customers/${selected.customerId}`}
                      className="text-[var(--color-brand-blue)] hover:underline"
                    >
                      {selected.name}
                    </Link>
                  ) : (
                    selected.name
                  )}
                </h2>
                <p className="text-xs text-[var(--color-text-muted)]">
                  {formatDateTime(selected.createdAt)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              >
                ✕
              </button>
            </div>

            <dl className="space-y-3 text-sm mb-4">
              <div>
                <dt className="text-xs uppercase text-[var(--color-text-muted)]">
                  E-posta
                </dt>
                <dd>
                  <a
                    href={`mailto:${selected.email}`}
                    className="text-[var(--color-brand-blue)] hover:underline"
                  >
                    {selected.email}
                  </a>
                </dd>
              </div>
              {selected.subject ? (
                <div>
                  <dt className="text-xs uppercase text-[var(--color-text-muted)]">
                    Konu
                  </dt>
                  <dd>{selected.subject}</dd>
                </div>
              ) : null}
              <div>
                <dt className="text-xs uppercase text-[var(--color-text-muted)]">
                  Mesaj
                </dt>
                <dd className="whitespace-pre-wrap rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                  {selected.body}
                </dd>
              </div>
              {selected.ip || selected.userAgent ? (
                <div>
                  <dt className="text-xs uppercase text-[var(--color-text-muted)]">
                    Meta
                  </dt>
                  <dd className="text-xs text-[var(--color-text-muted)] font-mono break-all">
                    {selected.ip ?? "—"} · {selected.userAgent ?? "—"}
                  </dd>
                </div>
              ) : null}
            </dl>

            {selected.conversationId ? (
              <div className="mb-4 border-t border-[var(--color-border)] pt-4">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                  Konuşma
                </div>
                <ConversationChat
                  conversationId={selected.conversationId}
                  heightClass="max-h-[22rem]"
                />
              </div>
            ) : null}

            <div className="space-y-3 border-t border-[var(--color-border)] pt-4">
              <div>
                <label
                  htmlFor="status-select"
                  className="block text-xs uppercase text-[var(--color-text-muted)] mb-1"
                >
                  Durum
                </label>
                <select
                  id="status-select"
                  value={draftStatus}
                  onChange={(e) =>
                    setDraftStatus(e.target.value as SupportMessageStatus)
                  }
                  className="w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm"
                >
                  {SUPPORT_STATUS_ORDER.map((s) => (
                    <option key={s} value={s}>
                      {SUPPORT_STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor="admin-note"
                  className="block text-xs uppercase text-[var(--color-text-muted)] mb-1"
                >
                  Admin Notu
                </label>
                <textarea
                  id="admin-note"
                  value={draftNote}
                  onChange={(e) => setDraftNote(e.target.value)}
                  rows={4}
                  className="w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm"
                  placeholder="Bu mesaj hakkında dahili notunuz…"
                />
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={updateMutation.isPending}
                className="rounded-md bg-[var(--color-brand-blue)] px-3 py-1.5 text-sm text-white hover:bg-[var(--color-brand-navy)] disabled:opacity-50"
              >
                Kaydet
              </button>
              {undoMap[selected.id] ? (
                <button
                  type="button"
                  onClick={handleUndo}
                  disabled={updateMutation.isPending}
                  className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1.5 text-sm hover:bg-[var(--color-surface-muted)] disabled:opacity-50"
                  title={`Önceki: ${SUPPORT_STATUS_LABELS[undoMap[selected.id]]}`}
                >
                  Geri al ({SUPPORT_STATUS_LABELS[undoMap[selected.id]]})
                </button>
              ) : null}
              <a
                href={`mailto:${selected.email}?subject=${encodeURIComponent(
                  `RE: ${selected.subject ?? "Toptan Budur Destek"}`,
                )}`}
                className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1.5 text-sm hover:bg-[var(--color-surface-muted)]"
              >
                E-posta yaz
              </a>
              {selected.status !== "ARCHIVED" ? (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(selected)}
                  disabled={archiveMutation.isPending}
                  className="rounded-md border border-amber-200 bg-white px-3 py-1.5 text-sm text-amber-800 hover:bg-amber-50 disabled:opacity-50"
                >
                  Arşivle
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setConfirmHardDelete(selected)}
                disabled={hardDeleteMutation.isPending}
                className="ml-auto rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                Kalıcı sil
              </button>
            </div>
          </aside>
        </div>
      ) : null}

      {confirmDelete ? (
        <ConfirmDialog
          title="Mesajı arşivle"
          message={`"${confirmDelete.name}" mesajı arşivlenecek (geri alabilirsiniz). Devam edilsin mi?`}
          confirmLabel="Arşivle"
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            const id = confirmDelete.id;
            setConfirmDelete(null);
            archiveMutation.mutate(id);
          }}
        />
      ) : null}

      {confirmHardDelete ? (
        <ConfirmDialog
          title="Mesajı kalıcı sil"
          message={`"${confirmHardDelete.name}" mesajı veritabanından kalıcı olarak silinecek. Bu işlem geri alınamaz. Devam edilsin mi?`}
          confirmLabel="Kalıcı sil"
          destructive
          onCancel={() => setConfirmHardDelete(null)}
          onConfirm={() => {
            const id = confirmHardDelete.id;
            setConfirmHardDelete(null);
            hardDeleteMutation.mutate(id);
          }}
        />
      ) : null}
    </div>
  );
}
