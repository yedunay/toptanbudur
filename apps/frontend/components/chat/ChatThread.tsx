"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Film, ImagePlus, Send, X } from "lucide-react";
import { ApiError } from "@/lib/auth";
import {
  buildAttachmentSrc,
  fetchConversationMessages,
  markConversationRead,
  postConversationMessage,
  type ConversationMessage,
} from "@/lib/conversations";

const MAX_FILES = 5;
// Foto + video kabulü (2026-08-02): iPhone HEIC ve videolar filtreye takılıp
// SESSİZCE düşüyordu — bayiler hiç ek yükleyemiyordu. Kesin tür kararı
// backend'de magic-byte ile verilir; buradaki filtre yalnız kaba eleme.
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MEDIA_EXT_RE =
  /\.(heic|heif|jpe?g|png|webp|gif|avif|mp4|mov|m4v|webm|mkv|avi|3gp)$/i;

function isAcceptedMedia(f: File): boolean {
  if (f.type.startsWith("image/") || f.type.startsWith("video/")) return true;
  // Bazı cihazlar (özellikle telefonlar) type'ı boş gönderir — uzantıya bak.
  return f.type === "" && MEDIA_EXT_RE.test(f.name);
}

function isVideoFile(f: File): boolean {
  if (f.type.startsWith("video/")) return true;
  return /\.(mp4|mov|m4v|webm|mkv|avi|3gp)$/i.test(f.name);
}

/** Ek video mu? mimetype yoksa dosya adı uzantısından anla. */
function isVideoAttachment(att: {
  mimetype?: string | null;
  filename?: string | null;
}): boolean {
  if (att.mimetype?.startsWith("video/")) return true;
  return /\.(mp4|mov|m4v|webm|mkv|avi|3gp)$/i.test(att.filename ?? "");
}

interface ChatThreadProps {
  conversationId: string;
  /** Kısa görünüm için yükseklik sınıfı (varsayılan orta boy). */
  className?: string;
  /** Composer placeholder metni. */
  placeholder?: string;
}

function formatTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("tr-TR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/**
 * Yeniden kullanılabilir threaded chat görünümü. Hem iade-sipariş/satış
 * detayında hem destek taleplerinde aynı bileşen kullanılır. Karşı taraf
 * adı backend tarafından baş harflere maskelenmiş gelir ("Y.E.D.").
 */
export function ChatThread({
  conversationId,
  className,
  placeholder = "Mesajınızı yazın…",
}: ChatThreadProps) {
  const [messages, setMessages] = useState<ConversationMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchConversationMessages(conversationId);
      setMessages(data.messages ?? []);
      setError(null);
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : "Mesajlar yüklenemedi.";
      setError(msg);
      setMessages([]);
    }
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    void load();
    void markConversationRead(conversationId);
  }, [conversationId, load]);

  // Yeni mesaj geldiğinde aşağı kaydır.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const addFiles = useCallback(
    (incoming: FileList | null) => {
      if (!incoming || incoming.length === 0) return;
      // KRİTİK: FileList CANLIDIR — onChange sonrası `input.value=""` onu
      // BOŞALTIR. State güncelleyicisi sonradan koştuğu için listeyi burada,
      // SENKRON kopyalamak şart; yoksa ek sessizce kaybolur (2026-08-02'de
      // "görseli seçiyorum ama eklemiyor" şikâyetinin kökü buydu).
      const picked = Array.from(incoming);
      setError(null);
      setFiles((prev) => {
        const next = [...prev];
        for (const f of picked) {
          if (next.length >= MAX_FILES) break;
          if (!isAcceptedMedia(f)) {
            setError(`Fotoğraf veya video yükleyebilirsiniz: ${f.name}`);
            continue;
          }
          if (f.size > MAX_FILE_BYTES) {
            setError(`${f.name} 100 MB sınırını aşıyor.`);
            continue;
          }
          next.push(f);
        }
        return next.slice(0, MAX_FILES);
      });
    },
    [],
  );

  const removeFile = useCallback((idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const handleSend = useCallback(
    async (e: { preventDefault: () => void }) => {
      e.preventDefault();
      if (sending) return;
      if (body.trim().length === 0 && files.length === 0) {
        setError("Lütfen bir mesaj yazın veya görsel ekleyin.");
        return;
      }
      setSending(true);
      setError(null);
      try {
        const fd = new FormData();
        fd.append("body", body.trim());
        for (const f of files) fd.append("files", f, f.name);
        await postConversationMessage(conversationId, fd);
        setBody("");
        setFiles([]);
        await load();
      } catch (err) {
        const msg =
          err instanceof ApiError ? err.message : "Mesaj gönderilemedi.";
        setError(msg);
      } finally {
        setSending(false);
      }
    },
    [body, files, sending, conversationId, load],
  );

  return (
    <div
      className={[
        "flex flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-white shadow-sm",
        className ?? "",
      ].join(" ")}
    >
      <div
        ref={scrollRef}
        className="flex-1 space-y-3 overflow-y-auto bg-[var(--surface-muted)] p-4"
        style={{ minHeight: "16rem", maxHeight: "26rem" }}
        aria-live="polite"
      >
        {messages === null ? (
          <div className="space-y-3">
            <div className="h-12 w-2/3 animate-pulse rounded-2xl bg-white" />
            <div className="ml-auto h-12 w-2/3 animate-pulse rounded-2xl bg-white" />
          </div>
        ) : messages.length === 0 ? (
          <p className="py-10 text-center text-sm text-[var(--text-muted)]">
            Henüz mesaj yok. İlk mesajı siz yazın.
          </p>
        ) : (
          messages.map((m) => <MessageBubble key={m.id} message={m} />)
        )}
      </div>

      {error ? (
        <div
          role="alert"
          className="border-t border-red-200 bg-red-50 px-4 py-2 text-xs font-semibold text-red-700"
        >
          {error}
        </div>
      ) : null}

      <form
        onSubmit={handleSend}
        className="border-t border-[var(--border)] bg-white p-3"
      >
        {files.length > 0 ? (
          <ul className="mb-2 flex flex-wrap gap-2">
            {files.map((f, i) => {
              const video = isVideoFile(f);
              const url = video ? null : URL.createObjectURL(f);
              return (
                <li
                  key={`${f.name}-${i}`}
                  className="group relative h-14 w-14 overflow-hidden rounded-lg border border-slate-200"
                  title={f.name}
                >
                  {url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={url}
                      alt={f.name}
                      className="h-full w-full object-cover"
                      onLoad={() => URL.revokeObjectURL(url)}
                    />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center bg-slate-800 text-white">
                      <Film className="h-6 w-6" />
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white"
                    aria-label={`${f.name} kaldır`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}

        <div className="flex items-end gap-2">
          <label
            className="inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-slate-200 text-[var(--brand-blue)] transition hover:bg-blue-50"
            title="Fotoğraf / video ekle"
          >
            <ImagePlus className="h-5 w-5" />
            <input
              type="file"
              className="sr-only"
              multiple
              accept="image/*,video/*,.heic,.heif,.mov,.mp4"
              disabled={sending || files.length >= MAX_FILES}
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>

          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={1}
            placeholder={placeholder}
            maxLength={8000}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend(e);
              }
            }}
            className="max-h-28 min-h-[2.5rem] flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[var(--brand-blue)]"
          />

          <button
            type="submit"
            disabled={sending}
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-[var(--brand-blue)] px-4 text-sm font-bold text-white transition hover:bg-[var(--brand-navy)] disabled:opacity-60"
          >
            <Send className="h-4 w-4" />
            {sending ? "…" : "Gönder"}
          </button>
        </div>
      </form>
    </div>
  );
}

function MessageBubble({ message }: { message: ConversationMessage }) {
  const mine = message.mine;
  return (
    <div className={mine ? "flex justify-end" : "flex justify-start"}>
      <div
        className={[
          "max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm",
          mine
            ? "bg-[var(--brand-blue)] text-white"
            : "bg-white text-[var(--text)]",
        ].join(" ")}
      >
        {!mine ? (
          <p className="mb-0.5 text-[11px] font-bold text-[var(--brand-blue)]">
            {message.senderLabel}
          </p>
        ) : null}

        {message.body ? (
          <p className="whitespace-pre-wrap break-words">{message.body}</p>
        ) : null}

        {message.attachments && message.attachments.length > 0 ? (
          <ul className="mt-2 grid grid-cols-2 gap-2">
            {message.attachments.map((att, i) => {
              const src = buildAttachmentSrc(att.url);
              if (!src) return null;
              if (isVideoAttachment(att)) {
                return (
                  <li
                    key={`${message.id}-att-${i}`}
                    className="col-span-2 overflow-hidden rounded-lg"
                  >
                    {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                    <video
                      src={src}
                      controls
                      preload="metadata"
                      className="max-h-64 w-full rounded-lg bg-black"
                    />
                  </li>
                );
              }
              return (
                <li key={`${message.id}-att-${i}`} className="overflow-hidden rounded-lg">
                  <a href={src} target="_blank" rel="noopener noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={src}
                      alt={att.filename ?? "Ek görsel"}
                      className="h-24 w-full object-cover transition hover:opacity-90"
                      loading="lazy"
                    />
                  </a>
                </li>
              );
            })}
          </ul>
        ) : null}

        <p
          className={[
            "mt-1 text-[10px]",
            mine ? "text-blue-100" : "text-[var(--text-muted)]",
          ].join(" ")}
        >
          {formatTime(message.createdAt)}
        </p>
      </div>
    </div>
  );
}
