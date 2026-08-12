import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRequireAuth } from "../lib/auth";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { useToast } from "../components/Toast";
import ConfirmDialog from "../components/ConfirmDialog";
import AttachmentGallery from "../components/AttachmentGallery";
import { useDebounce } from "../lib/useDebounce";
import { formatDateTime } from "../lib/orders";
import {
  approveDealerApplication,
  rejectDealerApplication,
  undoDealerApplication,
  isDealerApproveIdMismatch,
  buildWelcomeWhatsAppMessage,
  type ApproveDealerApplicationResult,
} from "../lib/dealerApplications";
import DealerApprovalModal from "../components/DealerApprovalModal";
import { telLink, waLink } from "../lib/contact";
import { ApiError, apiFetch } from "../lib/auth";
import {
  SOURCE_BADGE_CLASS,
  SOURCE_LABELS,
  UNIFIED_STATUS_LABELS,
  UNIFIED_STATUS_ORDER,
  deleteMessage,
  fetchAllMessages,
  updateMessageStatus,
  type MessageSource,
  type UnifiedMessage,
  type UnifiedStatus,
} from "../lib/messages";
import type { SupportMessage } from "../lib/supportMessages";

type SourceTab = "ALL" | MessageSource;

const TABS: ReadonlyArray<{ value: SourceTab; label: string }> = [
  { value: "ALL", label: "Hepsi" },
  { value: "CONTACT", label: "İletişim" },
  { value: "APPLICATION", label: "Bayilik Başvuruları" },
  { value: "INTEGRATION", label: "Entegrasyon Başvuruları" },
  { value: "SUPPORT", label: "Destek Talebi" },
  { value: "CALLBACK", label: "Geri Arama Talebi" },
];

function statusColor(status: UnifiedStatus): string {
  switch (status) {
    case "NEW":
      return "bg-amber-50 text-amber-800 border-amber-200";
    case "READ":
      return "bg-sky-50 text-sky-700 border-sky-200";
    case "REPLIED":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "RESOLVED":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "ARCHIVED":
      return "bg-slate-100 text-slate-600 border-slate-200";
  }
}

function normalizeSourceTab(raw: string | null): SourceTab {
  if (
    raw === "CONTACT" ||
    raw === "APPLICATION" ||
    raw === "INTEGRATION" ||
    raw === "SUPPORT" ||
    raw === "CALLBACK"
  ) {
    return raw;
  }
  return "ALL";
}

interface DraftState {
  status: UnifiedStatus;
  adminNote: string;
  name: string;
  email: string;
  phone: string;
}

/**
 * Admin paneli APPLICATION mesajını açtığında, adminNote textarea'sı boş
 * geliyorsa müşteriye gönderilecek kişiye özel hoş-geldin mesajını draft
 * olarak prefill ediyoruz. Bu içerik sadece state — admin Kaydet'e
 * basmazsa DB'ye yazılmaz, basarsa backend resolver'ı koruyan merge
 * (messages.ts → updateMessageStatus) devreye girer.
 *
 * Entegrasyon başvurularında bayilik onay akışı yok, bu yüzden prefill
 * uygulanmaz.
 */
function buildInitialDraft(msg: UnifiedMessage): DraftState {
  const existingNote = msg.adminNote ?? "";
  const isDealerApplication =
    msg.source === "APPLICATION" &&
    !msg.subject?.toLowerCase().includes("entegrasyon");
  const adminNote =
    isDealerApplication && existingNote.trim().length === 0
      ? buildWelcomeWhatsAppMessage({ fullName: msg.name })
      : existingNote;
  return {
    status: msg.status,
    adminNote,
    name: msg.name,
    email: msg.email ?? "",
    phone: msg.phone ?? "",
  };
}

export default function MesajlarPage(): React.ReactElement | null {
  useDocumentTitle("Mesajlar & İstekler");
  const authed = useRequireAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const sourceTab = normalizeSourceTab(searchParams.get("source"));
  const [statusFilter, setStatusFilter] = useState<UnifiedStatus | "">("");
  const [searchInput, setSearchInput] = useState<string>("");
  const search = useDebounce(searchInput, 250);

  const [selected, setSelected] = useState<UnifiedMessage | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<UnifiedMessage | null>(null);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [approvalResult, setApprovalResult] =
    useState<ApproveDealerApplicationResult | null>(null);

  useEffect(() => {
    if (selected) {
      setDraft(buildInitialDraft(selected));
      setApproveError(null);
    } else {
      setDraft(null);
      setApproveError(null);
    }
  }, [selected]);

  const setSourceTab = (tab: SourceTab): void => {
    const params = new URLSearchParams(searchParams);
    if (tab === "ALL") params.delete("source");
    else params.set("source", tab);
    setSearchParams(params, { replace: true });
  };

  const messagesQuery = useQuery({
    queryKey: ["messages", sourceTab, statusFilter],
    queryFn: () =>
      fetchAllMessages({
        source: sourceTab,
        status: statusFilter || undefined,
      }),
    enabled: authed,
    // Anlık güncelleme için 15 sn'lik polling — yeni mesaj/istek gecikmesin
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  // Yeni satır highlight'i için son görülen ID seti — gelen yeni kayıtlar
  // birkaç saniye yumuşak bir flash ile vurgulanır.
  const [seenIds, setSeenIds] = useState<Set<string>>(new Set());
  const [recentIds, setRecentIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!messagesQuery.data) return;
    const currentKeys = new Set(
      messagesQuery.data.map((m) => `${m.source}:${m.id}`),
    );
    if (seenIds.size === 0) {
      // İlk yükleme — sadece bilineni doldur
      setSeenIds(currentKeys);
      return;
    }
    const incoming: string[] = [];
    currentKeys.forEach((k) => {
      if (!seenIds.has(k)) incoming.push(k);
    });
    if (incoming.length > 0) {
      setRecentIds((prev) => {
        const next = new Set(prev);
        incoming.forEach((k) => next.add(k));
        return next;
      });
      setSeenIds(currentKeys);
      // 4 saniye sonra highlight'i kaldır
      const timer = window.setTimeout(() => {
        setRecentIds((prev) => {
          const next = new Set(prev);
          incoming.forEach((k) => next.delete(k));
          return next;
        });
      }, 4_000);
      return () => window.clearTimeout(timer);
    }
    // Silinenleri seenIds'ten temizle
    setSeenIds(currentKeys);
  }, [messagesQuery.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = messagesQuery.data ?? [];

  // Bildirim deep-link'i: `/mesajlar?...&messageId=<id>` (destek mesajı id'si)
  // veya `/mesajlar?...&conversationId=<id>` (sohbet id'si). İlgili kaydı
  // listede bul → detay panelini aç → param'ı URL'den temizle (KonusmalarPage
  // deseni). messageId destek mesajının kendi id'siyle (m.id) eşleşir;
  // conversationId ise SUPPORT kaydının ham conversationId'siyle eşleştirilir.
  // (#34b)
  useEffect(() => {
    const messageId = searchParams.get("messageId");
    const conversationId = searchParams.get("conversationId");
    if (!messageId && !conversationId) return;
    if (items.length === 0) return; // veri henüz gelmedi — sonraki render'da dene

    const match = items.find((m) => {
      if (messageId && m.id === messageId) return true;
      if (
        conversationId &&
        m.source === "SUPPORT" &&
        (m.raw as SupportMessage).conversationId === conversationId
      ) {
        return true;
      }
      return false;
    });
    if (match) setSelected(match);

    // Eşleşme bulunsa da bulunmasa da param'ı temizle — aksi halde her
    // refetch'te tekrar tetiklenir ve admin başka bir kaydı açamaz.
    const next = new URLSearchParams(searchParams);
    next.delete("messageId");
    next.delete("conversationId");
    setSearchParams(next, { replace: true });
  }, [searchParams, items, setSearchParams]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length === 0) return items;
    return items.filter((m) =>
      [m.name, m.email ?? "", m.phone ?? "", m.subject ?? "", m.body]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [items, search]);

  const updateMutation = useMutation({
    mutationFn: async (vars: {
      msg: UnifiedMessage;
      status: UnifiedStatus;
      adminNote?: string;
      // Ad/E-posta/Telefon düzenlemesi — yalnız değişenler doludur. Form
      // kaynaklı mesajlarda (CONTACT/APPLICATION/INTEGRATION/CALLBACK)
      // backend /admin/forms PATCH'i bu alanları kabul eder (#34a). SUPPORT
      // mesajları bu alanları desteklemediği için contact gönderilmez.
      contact?: { name?: string; email?: string; phone?: string };
    }) => {
      // Önce iletişim alanlarını (varsa) kalıcılaştır — Form PATCH'i name/email/
      // phone whitelist'inde (UpdateFormDto). Status/not güncellemesi kendi
      // mapper'ı (updateMessageStatus) üzerinden ayrıca yapılır; o akış notes'a
      // dealerApplicationId satırını geri ekleyerek Form↔DealerApplication
      // bağını korur, bu yüzden bozmuyoruz.
      if (
        vars.contact &&
        vars.msg.source !== "SUPPORT" &&
        Object.keys(vars.contact).length > 0
      ) {
        await apiFetch(`/admin/forms/${vars.msg.id}`, {
          method: "PATCH",
          body: JSON.stringify(vars.contact),
        });
      }
      return updateMessageStatus(vars.msg, vars.status, vars.adminNote);
    },
    onSuccess: (data) => {
      toast.push("success", "Kaydedildi");
      void queryClient.invalidateQueries({ queryKey: ["messages"] });
      void queryClient.invalidateQueries({ queryKey: ["forms", "count"] });
      void queryClient.invalidateQueries({ queryKey: ["support-messages", "count"] });
      setSelected(data);
    },
    onError: (err) => {
      toast.push("error", err instanceof Error ? err.message : "Kaydedilemedi");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (msg: UnifiedMessage) => deleteMessage(msg),
    onSuccess: () => {
      toast.push("success", "Silindi");
      void queryClient.invalidateQueries({ queryKey: ["messages"] });
      void queryClient.invalidateQueries({ queryKey: ["forms", "count"] });
      void queryClient.invalidateQueries({ queryKey: ["support-messages", "count"] });
      setSelected(null);
    },
    onError: (err) => {
      toast.push("error", err instanceof Error ? err.message : "Silinemedi");
    },
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => approveDealerApplication(id),
    onSuccess: (result) => {
      setApproveError(null);
      // Tek kullanımlık parolayı modal ile göster — toast'a parola yazmıyoruz.
      setApprovalResult(result);
      void queryClient.invalidateQueries({ queryKey: ["messages"] });
      void queryClient.invalidateQueries({ queryKey: ["dealer-applications"] });
      void queryClient.invalidateQueries({ queryKey: ["forms", "count"] });
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (err) => {
      // APPLICATION sekmesi Form modelinden besleniyor; gönderilen id Form id.
      // Backend bu id'yi DealerApplication tablosunda bulamayınca 404 döner.
      // Bu durumu inline mesaj olarak göster (toast değil).
      if (isDealerApproveIdMismatch(err)) {
        setApproveError(
          "Bu kayıt Form tablosundan geliyor; backend onay endpoint'i şu an " +
            "DealerApplication ID bekliyor. Backend ekibinden Form ID kabul eden " +
            "polymorphic onay (veya yeni POST /admin/forms/:id/approve-application " +
            "uç noktası) talep edildi. Geçici çözüm: durumu \"Çözüldü\" yapıp Bayi " +
            "Başvuruları (legacy) sayfasından manuel onaylayın.",
        );
        return;
      }
      const code = err instanceof ApiError ? ` (HTTP ${err.status})` : "";
      setApproveError(
        (err instanceof Error ? err.message : "Onaylama başarısız") + code,
      );
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => rejectDealerApplication(id),
    onSuccess: () => {
      toast.push("success", "Başvuru reddedildi");
      void queryClient.invalidateQueries({ queryKey: ["messages"] });
      void queryClient.invalidateQueries({ queryKey: ["dealer-applications"] });
      void queryClient.invalidateQueries({ queryKey: ["forms", "count"] });
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (err) => {
      toast.push("error", err instanceof Error ? err.message : "İşlem başarısız");
    },
  });

  const undoMutation = useMutation({
    mutationFn: (id: string) => undoDealerApplication(id),
    onSuccess: () => {
      toast.push("success", "Onay geri alındı");
      void queryClient.invalidateQueries({ queryKey: ["messages"] });
      void queryClient.invalidateQueries({ queryKey: ["dealer-applications"] });
      void queryClient.invalidateQueries({ queryKey: ["forms", "count"] });
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (err) => {
      toast.push(
        "error",
        err instanceof Error
          ? err.message
          : "Onay geri alınamadı. (Backend endpoint'i hazır olmayabilir.)",
      );
    },
  });

  function handleSave(): void {
    if (!selected || !draft) return;
    const patchStatus = draft.status !== selected.status ? draft.status : undefined;
    const patchNote =
      (draft.adminNote ?? "") !== (selected.adminNote ?? "") ? draft.adminNote : undefined;

    // Ad/E-posta/Telefon düzenlemesi — yalnız Form kaynaklı mesajlarda
    // backend kabul eder. Değişen alanları topla (#34a).
    const contact: { name?: string; email?: string; phone?: string } = {};
    if (selected.source !== "SUPPORT") {
      const nextName = draft.name.trim();
      const nextEmail = draft.email.trim();
      const nextPhone = draft.phone.trim();
      if (nextName && nextName !== selected.name) contact.name = nextName;
      // Backend UpdateFormDto e-posta/telefon için @IsEmail/@IsTrPhone uygular;
      // boş string'i reddeder (400). Bu yüzden yalnız DOLU ve değişmiş değerleri
      // gönderiyoruz — alan temizleme backend'ce desteklenmiyor.
      if (nextEmail && nextEmail !== (selected.email ?? "")) {
        contact.email = nextEmail;
      }
      if (nextPhone && nextPhone !== (selected.phone ?? "")) {
        contact.phone = nextPhone;
      }
    }
    const hasContactChange = Object.keys(contact).length > 0;

    if (patchStatus === undefined && patchNote === undefined && !hasContactChange) {
      toast.push("info", "Değişiklik yok");
      return;
    }
    updateMutation.mutate({
      msg: selected,
      status: patchStatus ?? selected.status,
      adminNote: patchNote,
      contact: hasContactChange ? contact : undefined,
    });
  }

  function handleReset(): void {
    if (!selected) return;
    setDraft(buildInitialDraft(selected));
  }

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-[var(--color-text)]">
          Mesajlar &amp; İstekler
        </h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {messagesQuery.isLoading
            ? "Yükleniyor…"
            : `${filteredItems.length} kayıt`}
        </p>
      </header>

      <div
        role="tablist"
        aria-label="Kaynak"
        className="mb-4 flex flex-wrap items-center gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-1"
      >
        {TABS.map((tab) => {
          const active = tab.value === sourceTab;
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setSourceTab(tab.value)}
              className={
                "px-3 py-1.5 text-sm rounded-md transition-colors " +
                (active
                  ? "bg-white text-[var(--color-text)] shadow-sm border border-[var(--color-border)]"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]")
              }
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Ad, e-posta, telefon, konu, mesaj…"
          className="w-full sm:w-72 rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as UnifiedStatus | "")}
          className="rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm"
        >
          <option value="">Tüm durumlar</option>
          {UNIFIED_STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {UNIFIED_STATUS_LABELS[s]}
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
                  <th className="px-3 py-2 text-left">Kaynak</th>
                  <th className="px-3 py-2 text-left">Ad</th>
                  <th className="px-3 py-2 text-left hidden sm:table-cell">E-posta</th>
                  <th className="px-3 py-2 text-left">Telefon</th>
                  <th className="px-3 py-2 text-left hidden md:table-cell">Konu/Mesaj</th>
                  <th className="px-3 py-2 text-center">Durum</th>
                  <th className="px-3 py-2 text-left hidden lg:table-cell">Tarih</th>
                </tr>
              </thead>
              <tbody>
                {messagesQuery.isLoading ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-[var(--color-text-muted)]">
                      Yükleniyor…
                    </td>
                  </tr>
                ) : filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-[var(--color-text-muted)]">
                      Kayıt yok
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((m) => {
                    const key = `${m.source}:${m.id}`;
                    const isNewRow = recentIds.has(key);
                    return (
                    <tr
                      key={key}
                      onClick={() => setSelected(m)}
                      className={`border-t border-[var(--color-border)] hover:bg-[var(--color-surface-muted)] cursor-pointer transition-colors ${
                        m.status === "NEW" ? "font-medium" : ""
                      } ${isNewRow ? "bg-amber-50 animate-pulse" : ""}`}
                    >
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${SOURCE_BADGE_CLASS[m.source]}`}
                        >
                          {SOURCE_LABELS[m.source]}
                        </span>
                        {/* Reklamdan gelen başvuru — bir bakışta görünsün */}
                        {m.meta?.utmSource || m.meta?.gclid ? (
                          <span
                            className="ml-1 inline-flex items-center rounded-full border border-blue-300 bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-700"
                            title={`Reklam: ${m.meta?.utmSource ?? "google"}${m.meta?.utmTerm ? ` · ${m.meta.utmTerm}` : ""}`}
                          >
                            📣 Reklam
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">{m.name}</td>
                      <td className="px-3 py-2 text-[var(--color-text-muted)] hidden sm:table-cell">
                        <div className="truncate max-w-[16rem]">{m.email ?? "—"}</div>
                      </td>
                      <td
                        className="px-3 py-2 text-[var(--color-text-muted)]"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {m.phone ? (
                          <div className="flex items-center gap-2">
                            <a
                              href={telLink(m.phone) ?? "#"}
                              className="hover:underline"
                              title="Ara"
                            >
                              {m.phone}
                            </a>
                            {waLink(m.phone) ? (
                              <a
                                href={waLink(m.phone) ?? "#"}
                                target="_blank"
                                rel="noreferrer"
                                title="WhatsApp"
                                className="text-emerald-600 hover:text-emerald-700 text-xs"
                              >
                                WA
                              </a>
                            ) : null}
                          </div>
                        ) : (
                          <span>—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-[var(--color-text-muted)] hidden md:table-cell">
                        <div className="truncate max-w-[24rem]">
                          {m.subject ?? m.body.slice(0, 80)}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${statusColor(m.status)}`}
                        >
                          {UNIFIED_STATUS_LABELS[m.status]}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-[var(--color-text-muted)] hidden lg:table-cell">
                        {formatDateTime(m.createdAt)}
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selected && draft ? (
        <div
          className="fixed inset-0 z-40 bg-black/40 flex justify-end"
          onClick={() => setSelected(null)}
        >
          <aside
            className="w-full max-w-xl h-full bg-white shadow-xl p-6 overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Mesaj detayı"
          >
            <div className="mb-4 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${SOURCE_BADGE_CLASS[selected.source]}`}
                  >
                    {SOURCE_LABELS[selected.source]}
                  </span>
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${statusColor(selected.status)}`}
                  >
                    {UNIFIED_STATUS_LABELS[selected.status]}
                  </span>
                </div>
                <h2 className="mt-2 text-lg font-semibold truncate">{selected.name}</h2>
                <p className="text-xs text-[var(--color-text-muted)]">
                  {formatDateTime(selected.createdAt)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                aria-label="Kapat"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <label className="block text-sm">
                <span className="mb-1 block text-xs uppercase text-[var(--color-text-muted)]">
                  Ad Soyad
                </span>
                <input
                  type="text"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  className="w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm"
                />
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block text-sm">
                  <span className="mb-1 block text-xs uppercase text-[var(--color-text-muted)]">
                    E-posta
                  </span>
                  <input
                    type="email"
                    value={draft.email}
                    onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                    className="w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm"
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-xs uppercase text-[var(--color-text-muted)]">
                    Telefon
                  </span>
                  <input
                    type="tel"
                    value={draft.phone}
                    onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                    className="w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm"
                  />
                </label>
              </div>
              {selected.subject ? (
                <div>
                  <span className="mb-1 block text-xs uppercase text-[var(--color-text-muted)]">
                    Konu
                  </span>
                  <p className="text-sm">{selected.subject}</p>
                </div>
              ) : null}
              <div>
                <span className="mb-1 block text-xs uppercase text-[var(--color-text-muted)]">
                  Mesaj
                </span>
                <p className="whitespace-pre-wrap rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm">
                  {selected.body || "—"}
                </p>
              </div>
              {selected.source === "SUPPORT" ? (
                <AttachmentGallery
                  attachments={selected.attachments}
                  label="Müşteri Görselleri"
                />
              ) : null}
              {selected.meta?.company ? (
                <div className="text-sm">
                  <span className="text-xs uppercase text-[var(--color-text-muted)]">
                    Firma:
                  </span>{" "}
                  {selected.meta.company}
                </div>
              ) : null}
              {selected.meta?.vergiNo ? (
                <div className="text-sm">
                  <span className="text-xs uppercase text-[var(--color-text-muted)]">
                    Vergi / TC No:
                  </span>{" "}
                  {selected.meta.vergiNo}
                </div>
              ) : null}
              {selected.meta?.vergiDairesi ? (
                <div className="text-sm">
                  <span className="text-xs uppercase text-[var(--color-text-muted)]">
                    Vergi Dairesi:
                  </span>{" "}
                  {selected.meta.vergiDairesi}
                </div>
              ) : null}
              {selected.meta?.integrationSoftware ? (
                <div className="text-sm">
                  <span className="text-xs uppercase text-[var(--color-text-muted)]">
                    Entegrasyon yazılımı:
                  </span>{" "}
                  {selected.meta.integrationSoftware}
                </div>
              ) : null}
              {selected.meta?.package ? (
                <div className="text-sm">
                  <span className="text-xs uppercase text-[var(--color-text-muted)]">
                    Paket:
                  </span>{" "}
                  {selected.meta.package}
                </div>
              ) : null}
              {selected.meta?.ip || selected.meta?.userAgent ? (
                <div className="text-xs text-[var(--color-text-muted)] font-mono break-all">
                  {selected.meta.ip ?? "—"} · {selected.meta.userAgent ?? "—"}
                </div>
              ) : null}
              {/* Reklam atıfı — utm/gclid dolu ise başvurunun reklam kaynağını göster */}
              {selected.meta?.utmSource || selected.meta?.gclid ? (
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 space-y-1">
                  <div className="text-xs font-bold uppercase tracking-wide text-blue-700">
                    📣 Reklam Kaynağı
                  </div>
                  <div className="text-sm text-blue-900">
                    {[selected.meta.utmSource, selected.meta.utmMedium]
                      .filter(Boolean)
                      .join(" / ") || "—"}
                    {selected.meta.utmCampaign ? ` · Kampanya: ${selected.meta.utmCampaign}` : ""}
                  </div>
                  {selected.meta.utmTerm ? (
                    <div className="text-sm text-blue-900">
                      <span className="text-xs uppercase text-blue-600">Aranan kelime:</span>{" "}
                      <strong>{selected.meta.utmTerm}</strong>
                    </div>
                  ) : null}
                  {selected.meta.landingPage ? (
                    <div className="text-xs text-blue-700 break-all">
                      Giriş: {selected.meta.landingPage}
                    </div>
                  ) : null}
                  {selected.meta.gclid ? (
                    <div className="text-xs text-blue-600 font-mono break-all">
                      gclid: {selected.meta.gclid}
                    </div>
                  ) : null}
                </div>
              ) : selected.meta?.referrer ? (
                <div className="text-xs text-[var(--color-text-muted)] break-all">
                  Geldiği yer: {selected.meta.referrer}
                </div>
              ) : null}
            </div>

            <div className="mt-4 space-y-3 border-t border-[var(--color-border)] pt-4">
              <label className="block text-sm">
                <span className="mb-1 block text-xs uppercase text-[var(--color-text-muted)]">
                  Durum
                </span>
                <select
                  value={draft.status}
                  onChange={(e) => setDraft({ ...draft, status: e.target.value as UnifiedStatus })}
                  className="w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm"
                >
                  {UNIFIED_STATUS_ORDER.map((s) => (
                    <option key={s} value={s}>
                      {UNIFIED_STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-xs uppercase text-[var(--color-text-muted)]">
                  Admin Notu
                </span>
                <textarea
                  value={draft.adminNote}
                  onChange={(e) => setDraft({ ...draft, adminNote: e.target.value })}
                  rows={4}
                  className="w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm"
                  placeholder="Bu kayıt hakkında dahili notunuz…"
                />
              </label>
            </div>

            {selected.source === "APPLICATION" && !selected.subject?.toLowerCase().includes("entegrasyon") ? (
              (() => {
                const appStatus = selected.dealerApplicationStatus ?? null;
                const isApproved = appStatus === "APPROVED";
                const isRejected = appStatus === "REJECTED";
                const STATUS_LABEL: Record<string, string> = {
                  PENDING: "Onay Bekliyor",
                  PRE_REGISTERED: "Ön Kayıt",
                  APPROVED: "Onaylandı",
                  REJECTED: "Reddedildi",
                };
                const STATUS_BADGE: Record<string, string> = {
                  PENDING: "bg-amber-100 text-amber-800 border-amber-300",
                  PRE_REGISTERED: "bg-sky-100 text-sky-800 border-sky-300",
                  APPROVED: "bg-emerald-100 text-emerald-800 border-emerald-300",
                  REJECTED: "bg-red-100 text-red-800 border-red-300",
                };
                return (
                  <div className="mt-4 rounded-md border border-violet-200 bg-violet-50/40 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-violet-900 uppercase tracking-wide">
                        Bayilik Başvuru İşlemleri
                      </p>
                      {appStatus ? (
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_BADGE[appStatus]}`}
                        >
                          {STATUS_LABEL[appStatus]}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {!isApproved ? (
                        <button
                          type="button"
                          onClick={() => approveMutation.mutate(selected.id)}
                          disabled={approveMutation.isPending}
                          className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-60"
                        >
                          {approveMutation.isPending ? "Onaylanıyor…" : "Onayla"}
                        </button>
                      ) : null}
                      {!isRejected ? (
                        <button
                          type="button"
                          onClick={() => rejectMutation.mutate(selected.id)}
                          disabled={rejectMutation.isPending}
                          className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-60"
                        >
                          Reddet
                        </button>
                      ) : null}
                      {isApproved || isRejected ? (
                        <button
                          type="button"
                          onClick={() => undoMutation.mutate(selected.id)}
                          disabled={undoMutation.isPending}
                          className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1.5 text-sm hover:bg-[var(--color-surface-muted)] disabled:opacity-60"
                          title="Onayı geri al"
                        >
                          Onayı Geri Al
                        </button>
                      ) : null}
                    </div>
                    {!isApproved ? (
                      <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs leading-relaxed text-amber-900">
                        <p>
                          <strong>Onayla</strong> → Sistem tek kullanımlık geçici parola üretir,
                          müşteriye e-posta ile gönderir ve aynı parolayı açılan pencerede{" "}
                          <strong>bir kez</strong> gösterir.
                        </p>
                        <p className="mt-1">
                          ⚠ E-posta ulaşmama ihtimaline karşı parolayı modal kapanmadan{" "}
                          <strong>mutlaka not alın veya “Kopyala” ile yedekleyin</strong> —
                          tekrar görüntülenemez. Müşteri ilk girişte parolasını değiştirmek
                          zorundadır.
                        </p>
                      </div>
                    ) : (
                      <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-2.5 text-xs leading-relaxed text-emerald-900">
                        Bu başvuru <strong>onaylandı</strong> ve müşteri hesabı aktif
                        (Müşteriler sayfasından da onaylanmış olabilir). Geri almak için{" "}
                        <strong>Onayı Geri Al</strong>'ı kullanın.
                      </p>
                    )}
                    {approveError ? (
                      <div
                        role="alert"
                        className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700"
                      >
                        {approveError}
                      </div>
                    ) : null}
                  </div>
                );
              })()
            ) : null}

            <div className="mt-6 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={updateMutation.isPending}
                className="rounded-md bg-[var(--color-brand-blue)] px-3 py-1.5 text-sm text-white hover:bg-[var(--color-brand-navy)] disabled:opacity-50"
              >
                Kaydet
              </button>
              <button
                type="button"
                onClick={handleReset}
                disabled={updateMutation.isPending}
                className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1.5 text-sm hover:bg-[var(--color-surface-muted)]"
              >
                Geri Al
              </button>
              {selected.email ? (
                <a
                  href={`mailto:${selected.email}?subject=${encodeURIComponent(
                    `RE: ${selected.subject ?? "Toptan Budur"}`,
                  )}`}
                  className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1.5 text-sm hover:bg-[var(--color-surface-muted)]"
                >
                  E-posta yaz
                </a>
              ) : null}
              {selected.phone && telLink(selected.phone) ? (
                <a
                  href={telLink(selected.phone) ?? "#"}
                  className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1.5 text-sm hover:bg-[var(--color-surface-muted)]"
                >
                  Ara
                </a>
              ) : null}
              {selected.phone && waLink(selected.phone) ? (
                <a
                  href={waLink(selected.phone) ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md border border-emerald-200 bg-white px-3 py-1.5 text-sm text-emerald-700 hover:bg-emerald-50"
                >
                  WhatsApp
                </a>
              ) : null}
              <button
                type="button"
                onClick={() => setConfirmDelete(selected)}
                className="ml-auto rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
              >
                Sil
              </button>
            </div>
          </aside>
        </div>
      ) : null}

      {confirmDelete ? (
        <ConfirmDialog
          title="Kaydı sil"
          message={`"${confirmDelete.name}" kaydı kalıcı olarak silinecek. Devam edilsin mi?`}
          confirmLabel="Sil"
          destructive
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            const target = confirmDelete;
            setConfirmDelete(null);
            deleteMutation.mutate(target);
          }}
        />
      ) : null}

      {approvalResult ? (
        <DealerApprovalModal
          customer={approvalResult.customer}
          oneTimePassword={approvalResult.oneTimePassword ?? null}
          alreadyApproved={approvalResult.alreadyApproved}
          onClose={() => setApprovalResult(null)}
        />
      ) : null}
    </div>
  );
}
