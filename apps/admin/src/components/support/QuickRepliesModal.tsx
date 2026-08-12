import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createQuickReply,
  deleteQuickReply,
  fetchQuickReplies,
  updateQuickReply,
  QUICK_REPLY_INTENT_LABELS,
  QUICK_REPLY_INTENT_OPTIONS,
  type QuickReply,
  type QuickReplyIntent,
} from "../../lib/support-quick-replies";
import { useToast } from "../Toast";

interface Props {
  open: boolean;
  onClose: () => void;
}

interface Draft {
  id: string | null;
  title: string;
  body: string;
  intent: QuickReplyIntent | "";
  isActive: boolean;
}

const EMPTY_DRAFT: Draft = {
  id: null,
  title: "",
  body: "",
  intent: "",
  isActive: true,
};

const inputClass =
  "w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm shadow-inner outline-none transition-colors focus:border-sky-400 focus:ring-2 focus:ring-sky-100";

/**
 * Sipariş Talebi "Hızlı Yanıtlar" yönetimi: listeleme, içerik görüntüleme,
 * yeni ekleme, düzenleme, silme, aktif/pasif. Şablonlarda {siparisNo} ve {ad}
 * yer tutucuları gönderim anında doldurulur.
 */
export default function QuickRepliesModal({
  open,
  onClose,
}: Props): React.ReactElement | null {
  const qc = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);

  const listQuery = useQuery({
    queryKey: ["support-quick-replies"],
    queryFn: fetchQuickReplies,
    enabled: open,
  });
  const items = listQuery.data ?? [];

  const saveMutation = useMutation({
    mutationFn: async (d: Draft) => {
      const payload = {
        title: d.title.trim(),
        body: d.body,
        intent: (d.intent || null) as QuickReplyIntent | null,
        isActive: d.isActive,
      };
      return d.id ? updateQuickReply(d.id, payload) : createQuickReply(payload);
    },
    onSuccess: () => {
      toast.push("success", "Hızlı yanıt kaydedildi");
      void qc.invalidateQueries({ queryKey: ["support-quick-replies"] });
      setDraft(EMPTY_DRAFT);
    },
    onError: (e) =>
      toast.push("error", e instanceof Error ? e.message : "Kaydedilemedi"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteQuickReply(id),
    onSuccess: () => {
      toast.push("success", "Hızlı yanıt silindi");
      void qc.invalidateQueries({ queryKey: ["support-quick-replies"] });
      setDraft(EMPTY_DRAFT);
    },
    onError: (e) =>
      toast.push("error", e instanceof Error ? e.message : "Silinemedi"),
  });

  const toggleMutation = useMutation({
    mutationFn: (it: QuickReply) =>
      updateQuickReply(it.id, { isActive: !it.isActive }),
    onSuccess: (_data, it) => {
      toast.push("success", it.isActive ? "Pasife alındı" : "Aktifleştirildi");
      void qc.invalidateQueries({ queryKey: ["support-quick-replies"] });
    },
    onError: (e) =>
      toast.push("error", e instanceof Error ? e.message : "Güncellenemedi"),
  });

  if (!open) return null;

  function handleSave(): void {
    if (draft.title.trim().length < 2) {
      toast.push("info", "Başlık en az 2 karakter olmalı");
      return;
    }
    if (draft.body.trim().length < 2) {
      toast.push("info", "İçerik boş olamaz");
      return;
    }
    saveMutation.mutate(draft);
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Hızlı Yanıtlar"
        className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-white shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-[var(--color-text)]">
              Hızlı Yanıtlar
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Sipariş taleplerini yanıtlarken tek tıkla göndereceğiniz hazır
              metinler. Yer tutucular:{" "}
              <code className="rounded bg-slate-100 px-1">{"{siparisNo}"}</code>{" "}
              ve <code className="rounded bg-slate-100 px-1">{"{ad}"}</code>{" "}
              gönderim anında otomatik doldurulur.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            aria-label="Kapat"
          >
            ✕
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* Sol: liste */}
          <div className="flex min-h-0 flex-1 flex-col border-b border-[var(--color-border)] md:border-b-0 md:border-r">
            <div className="flex items-center justify-between px-4 py-2.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Yanıtlar ({items.length})
              </span>
              <button
                type="button"
                onClick={() => setDraft(EMPTY_DRAFT)}
                className="rounded-lg bg-sky-600 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-sky-700"
              >
                + Yeni
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
              {listQuery.isLoading ? (
                <p className="px-3 py-6 text-center text-sm text-slate-400">
                  Yükleniyor…
                </p>
              ) : items.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-slate-400">
                  Henüz hızlı yanıt yok.
                </p>
              ) : (
                items.map((it) => (
                  <button
                    type="button"
                    key={it.id}
                    onClick={() =>
                      setDraft({
                        id: it.id,
                        title: it.title,
                        body: it.body,
                        intent: it.intent ?? "",
                        isActive: it.isActive,
                      })
                    }
                    className={`mb-1.5 w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                      draft.id === it.id
                        ? "border-sky-300 bg-sky-50"
                        : "border-transparent hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-[var(--color-text)]">
                        {it.title}
                      </span>
                      {!it.isActive && (
                        <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                          Pasif
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2">
                      {it.intent && (
                        <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                          {QUICK_REPLY_INTENT_LABELS[it.intent]}
                        </span>
                      )}
                      <span className="truncate text-xs text-slate-500">
                        {it.body.replace(/\s+/g, " ").slice(0, 60)}
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Sağ: editör */}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
            <div className="mb-3">
              <label className="mb-1 block text-xs font-semibold text-slate-600">
                Başlık (buton üzerinde görünür)
              </label>
              <input
                value={draft.title}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, title: e.target.value }))
                }
                placeholder="örn. İptal Onaylandı"
                className={inputClass}
              />
            </div>

            <div className="mb-3">
              <label className="mb-1 block text-xs font-semibold text-slate-600">
                Kategori (opsiyonel — onay/ret butonlarına otomatik eşlenir)
              </label>
              <select
                value={draft.intent}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    intent: e.target.value as QuickReplyIntent | "",
                  }))
                }
                className={inputClass}
              >
                {QUICK_REPLY_INTENT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="mb-3 flex min-h-0 flex-1 flex-col">
              <label className="mb-1 block text-xs font-semibold text-slate-600">
                İçerik
              </label>
              <textarea
                value={draft.body}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, body: e.target.value }))
                }
                placeholder="Sayın {ad}, {siparisNo} numaralı siparişinize ilişkin…"
                className={`${inputClass} min-h-[160px] flex-1 resize-y font-normal`}
              />
            </div>

            <label className="mb-3 flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={draft.isActive}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, isActive: e.target.checked }))
                }
                className="h-4 w-4 accent-sky-600"
              />
              Aktif (talep yanıtlarken listede görünür)
            </label>

            <div className="flex items-center justify-between gap-2">
              <div>
                {draft.id && (
                  <button
                    type="button"
                    onClick={() => {
                      if (draft.id) deleteMutation.mutate(draft.id);
                    }}
                    disabled={deleteMutation.isPending}
                    className="rounded-lg border border-rose-200 px-3 py-2 text-sm font-medium text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-50"
                  >
                    Sil
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                {draft.id && (
                  <button
                    type="button"
                    onClick={() => setDraft(EMPTY_DRAFT)}
                    className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
                  >
                    Yeni
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saveMutation.isPending}
                  className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-700 disabled:opacity-50"
                >
                  {draft.id ? "Güncelle" : "Ekle"}
                </button>
              </div>
            </div>

            {items.length > 0 && (
              <p className="mt-3 text-[11px] text-slate-400">
                Listeden bir yanıta tıklayarak içeriğini görüntüleyip
                düzenleyebilir; soldaki kartlarda pasifleri ayırt edebilirsiniz.
              </p>
            )}
            {/* aktif/pasif hızlı toggle, düzenlenen kayıt için */}
            {draft.id && (
              <button
                type="button"
                onClick={() => {
                  const it = items.find((x) => x.id === draft.id);
                  if (it) toggleMutation.mutate(it);
                }}
                disabled={toggleMutation.isPending}
                className="mt-2 self-start text-xs font-medium text-sky-600 hover:underline disabled:opacity-50"
              >
                {draft.isActive ? "Pasife al" : "Aktifleştir"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
