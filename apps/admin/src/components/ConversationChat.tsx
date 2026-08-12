import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { NavLink } from "react-router-dom";
import {
  fetchConversationThread,
  markConversationRead,
  sendConversationMessage,
  type AdminConversationContext,
  type ConversationMessage,
} from "../lib/conversations";
import { formatDateTime } from "../lib/orders";
import { useToast } from "./Toast";

const API_BASE_RAW =
  (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

function apiOrigin(): string {
  try {
    if (API_BASE_RAW.startsWith("http")) return new URL(API_BASE_RAW).origin;
    if (typeof window !== "undefined") return window.location.origin;
    return "";
  } catch {
    return "";
  }
}

/** Backend göreli `/api/storage/...` URL'i dönerse API origin'ine bağla. */
function buildSrc(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (!url.startsWith("/")) return url;
  const origin = apiOrigin();
  return origin ? `${origin}${url}` : url;
}

interface ConversationChatProps {
  conversationId: string;
  /** Açıldığında otomatik okundu işaretle. Default true. */
  autoMarkRead?: boolean;
  /** Mesaj listesinin maksimum yüksekliği (Tailwind class). */
  heightClass?: string;
  /** Üst başlık göstersin mi. Default true. */
  showHeader?: boolean;
  /**
   * Bir mesaj başarıyla gönderildikten sonra çağrılır. Üst bileşenin (ör.
   * destek talebi drawer'ı) talebin durumunu yenileyebilmesi için kullanılır —
   * admin mesaj gönderince backend talebi otomatik "Cevaplandı" yapar.
   */
  onMessageSent?: () => void;
}

/**
 * Üst bileşenin composer'a müdahale edebilmesi için imperative handle. Hızlı
 * yanıt çipleri mesajı ANINDA göndermek yerine composer kutusuna yazsın diye
 * kullanılır — admin "Gönder"e basınca yollanır.
 */
export interface ConversationChatHandle {
  /** Composer taslağını verilen metinle doldurur ve odaklanır. */
  setDraft: (text: string) => void;
}

/** Telefonu wa.me'ye uygun normalize eder (sadece rakamlar). */
function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D+/g, "");
  if (digits.length < 7) return null;
  // 5xxxxxxxxx → 905xxxxxxxxx
  if (digits.length === 10 && digits.startsWith("5")) return `90${digits}`;
  // 05xxxxxxxxx → 905xxxxxxxxx
  if (digits.length === 11 && digits.startsWith("05")) return `90${digits.slice(1)}`;
  return digits;
}

interface DetailRowProps {
  label: string;
  children: React.ReactNode;
}

function DetailRow({ label, children }: DetailRowProps): React.ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
        {label}
      </span>
      <span className="truncate text-sm text-[var(--color-text)]">
        {children}
      </span>
    </div>
  );
}

interface ContextPanelProps {
  context: AdminConversationContext;
}

function ContextPanel({ context }: ContextPanelProps): React.ReactElement {
  const {
    subject,
    ticketStatus,
    kind,
    category,
    customer,
    buyer,
    seller,
    order,
    product,
    supplier,
    shipping,
  } = context;

  // Müşteri = SUPPORT için customer, DEALER_RETURN_ORDER için buyer.
  const primaryCustomer = customer ?? buyer;
  const primaryPhone = normalizePhone(primaryCustomer?.phone);

  // Tedarikçi tarafındaki sip no — Order veya Product üzerinden gelebilir.
  const supplierOrderNo =
    order?.supplierOrderNo ?? product?.supplierOrderNo ?? null;

  const barcode = product?.barcode ?? null;
  const sku = product?.sku ?? null;
  const headerTitle =
    (order?.code ? `#${order.code}` : null) ?? subject ?? "Konuşma";

  return (
    <div className="border-b border-[var(--color-border)] bg-white px-4 py-3">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-base font-semibold text-[var(--color-text)]">
          {order?.code ? (
            <NavLink
              to={`/orders/${order.id}`}
              className="hover:text-[var(--color-brand-blue)] hover:underline"
            >
              {headerTitle}
            </NavLink>
          ) : (
            headerTitle
          )}
        </h3>
        {ticketStatus ? (
          <span className="rounded-full bg-[var(--color-surface-muted)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-text-muted)]">
            {ticketStatus}
          </span>
        ) : order?.status ? (
          <span className="rounded-full bg-[var(--color-surface-muted)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-text-muted)]">
            {order.status}
          </span>
        ) : null}
        {kind ? (
          <span className="text-[11px] text-[var(--color-text-muted)]">
            {kind}
            {category ? ` · ${category}` : ""}
          </span>
        ) : null}
      </div>

      {subject && order?.code ? (
        <p className="mb-3 line-clamp-2 text-sm text-[var(--color-text-muted)]">
          {subject}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
        {primaryCustomer ? (
          <DetailRow label="Müşteri">
            {primaryCustomer.id ? (
              <NavLink
                to={`/customers/${primaryCustomer.id}`}
                className="text-[var(--color-brand-blue)] hover:underline"
              >
                {primaryCustomer.name}
              </NavLink>
            ) : (
              primaryCustomer.name
            )}
          </DetailRow>
        ) : null}

        {primaryPhone ? (
          <DetailRow label="Telefon">
            <a
              href={`https://wa.me/${primaryPhone}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-600 hover:underline"
              title="WhatsApp ile aç"
            >
              {primaryCustomer?.phone}
            </a>
          </DetailRow>
        ) : null}

        {primaryCustomer?.email ? (
          <DetailRow label="E-posta">
            <a
              href={`mailto:${primaryCustomer.email}`}
              className="text-[var(--color-brand-blue)] hover:underline"
            >
              {primaryCustomer.email}
            </a>
          </DetailRow>
        ) : null}

        {seller && primaryCustomer?.id !== seller.id ? (
          <DetailRow label="Satıcı">
            {seller.id ? (
              <NavLink
                to={`/customers/${seller.id}`}
                className="text-[var(--color-brand-blue)] hover:underline"
              >
                {seller.name}
              </NavLink>
            ) : (
              seller.name
            )}
          </DetailRow>
        ) : null}

        {order ? (
          <DetailRow label="Sipariş">
            <NavLink
              to={`/orders/${order.id}`}
              className="text-[var(--color-brand-blue)] hover:underline"
            >
              #{order.code}
            </NavLink>
          </DetailRow>
        ) : null}

        {supplierOrderNo ? (
          <DetailRow label="Tedarikçi Sip. No">
            <span className="font-mono text-[13px]">{supplierOrderNo}</span>
          </DetailRow>
        ) : null}

        {(order?.marketplace ?? shipping?.marketplace) ? (
          <DetailRow label="Satış Kanalı">
            {order?.marketplace ?? shipping?.marketplace}
          </DetailRow>
        ) : null}

        {product ? (
          <DetailRow label="Ürün">
            {supplier?.id ? (
              <NavLink
                to={`/suppliers/${supplier.id}/products`}
                className="text-[var(--color-brand-blue)] hover:underline"
              >
                {product.name}
              </NavLink>
            ) : (
              product.name
            )}
          </DetailRow>
        ) : null}

        {sku ? (
          <DetailRow label="SKU">
            <span className="font-mono text-[13px]">{sku}</span>
          </DetailRow>
        ) : null}

        {barcode ? (
          <DetailRow label="Barkod">
            <span className="font-mono text-[13px]">{barcode}</span>
          </DetailRow>
        ) : null}

        {supplier ? (
          <DetailRow label="Tedarikçi">
            <NavLink
              to={`/suppliers/${supplier.id}/edit`}
              className="text-[var(--color-brand-blue)] hover:underline"
            >
              {supplier.name}
            </NavLink>
          </DetailRow>
        ) : null}

        {(order?.cargoCompany ?? shipping?.carrier) ? (
          <DetailRow label="Kargo">
            {order?.cargoCompany ?? shipping?.carrier}
          </DetailRow>
        ) : null}

        {(order?.cargoBarcode ??
          order?.trackingNumber ??
          shipping?.trackingCode) ? (
          <DetailRow label="Kargo Takip">
            <span className="font-mono text-[13px]">
              {order?.cargoBarcode ??
                order?.trackingNumber ??
                shipping?.trackingCode}
            </span>
          </DetailRow>
        ) : null}
      </div>
    </div>
  );
}

interface MessageBubbleProps {
  message: ConversationMessage;
}

function MessageBubble({ message }: MessageBubbleProps): React.ReactElement {
  const mine = message.mine;
  const isSystem = (message.senderType ?? "").toUpperCase() === "SYSTEM";

  if (isSystem) {
    return (
      <div className="my-2 flex justify-center">
        <div className="rounded-full bg-[var(--color-surface-muted)] px-3 py-1 text-[11px] text-[var(--color-text-muted)]">
          {message.body}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
      <div className="mb-0.5 px-1 text-[11px] font-medium text-[var(--color-text-muted)]">
        {message.senderLabel}
      </div>
      <div
        className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
          mine
            ? "rounded-br-sm bg-[var(--color-brand-blue)] text-white"
            : "rounded-bl-sm border border-[var(--color-border)] bg-white text-[var(--color-text)]"
        }`}
      >
        {message.body ? (
          <p className="whitespace-pre-wrap break-words">{message.body}</p>
        ) : null}
        {message.attachments && message.attachments.length > 0 ? (
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {message.attachments.map((att, idx) => {
              const src = buildSrc(att.url);
              if (!src) return null;
              const video =
                (att.mimetype ?? "").startsWith("video/") ||
                /\.(mp4|mov|m4v|webm|mkv|avi|3gp)$/i.test(att.filename ?? "");
              if (video) {
                return (
                  <video
                    key={att.id ?? `${idx}`}
                    src={src}
                    controls
                    preload="metadata"
                    className="col-span-2 max-h-64 w-full rounded-md bg-black"
                  />
                );
              }
              return (
                <a
                  key={att.id ?? `${idx}`}
                  href={src}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block overflow-hidden rounded-md border border-black/10"
                >
                  <img
                    src={src}
                    alt={att.filename ?? "ek"}
                    loading="lazy"
                    className="h-28 w-full object-cover"
                  />
                </a>
              );
            })}
          </div>
        ) : null}
      </div>
      <div
        className={`mt-0.5 px-1 text-[10px] text-[var(--color-text-muted)] ${
          mine ? "text-right" : "text-left"
        }`}
      >
        {formatDateTime(message.createdAt)}
      </div>
    </div>
  );
}

/**
 * Tekrar kullanılabilir admin sohbet görünümü: bir konuşma thread'ini
 * (mesajlar, tam senderLabel, görsel ekleri, zaman damgaları) ve bir composer
 * (metin + görsel ek) gösterir. Admin conversation endpoint'lerini kullanır.
 */
const ConversationChat = forwardRef<
  ConversationChatHandle,
  ConversationChatProps
>(function ConversationChat(
  {
    conversationId,
    autoMarkRead = true,
    heightClass = "max-h-[26rem]",
    showHeader = true,
    onMessageSent,
  },
  ref,
) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [draft, setDraft] = useState<string>("");
  const [files, setFiles] = useState<File[]>([]);

  // Üst bileşen (hızlı yanıt çipleri) composer'ı doldurabilsin.
  useImperativeHandle(
    ref,
    () => ({
      setDraft: (text: string) => {
        setDraft(text);
        textareaRef.current?.focus();
      },
    }),
    [],
  );

  const threadQuery = useQuery({
    queryKey: ["admin", "conversation", conversationId],
    queryFn: () => fetchConversationThread(conversationId),
    enabled: !!conversationId,
    refetchInterval: 15_000,
  });

  const messages = useMemo(
    () => threadQuery.data?.messages ?? [],
    [threadQuery.data],
  );

  // Mesaj yüklendiğinde otomatik en alta kaydır.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  // Açılışta okundu işaretle.
  useEffect(() => {
    if (!conversationId || !autoMarkRead) return;
    markConversationRead(conversationId)
      .then(() => {
        void queryClient.invalidateQueries({
          queryKey: ["admin", "conversations"],
        });
      })
      .catch(() => {
        // sessiz geç
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  const sendMutation = useMutation({
    mutationFn: (vars: { body: string; files: File[] }) =>
      sendConversationMessage(conversationId, {
        body: vars.body,
        files: vars.files,
      }),
    onSuccess: () => {
      setDraft("");
      setFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
      void threadQuery.refetch();
      void queryClient.invalidateQueries({
        queryKey: ["admin", "conversations"],
      });
      onMessageSent?.();
    },
    onError: (err) => {
      toast.push(
        "error",
        err instanceof Error ? err.message : "Mesaj gönderilemedi",
      );
    },
  });

  function handleSend(): void {
    const body = draft.trim();
    if (body.length === 0 && files.length === 0) {
      toast.push("info", "Mesaj boş olamaz");
      return;
    }
    sendMutation.mutate({ body, files });
  }

  function handleFilesPicked(picked: FileList | null): void {
    if (!picked) return;
    // Foto + video kabulü (2026-08-02); boş type'lı (telefon) dosyada uzantıya
    // bakılır — kesin tür kararı backend'de magic-byte ile verilir.
    const next = Array.from(picked).filter(
      (f) =>
        f.type.startsWith("image/") ||
        f.type.startsWith("video/") ||
        (f.type === "" &&
          /\.(heic|heif|jpe?g|png|webp|gif|avif|mp4|mov|m4v|webm|mkv|avi|3gp)$/i.test(
            f.name,
          )),
    );
    setFiles((prev) => [...prev, ...next]);
  }

  function removeFile(index: number): void {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  const context = threadQuery.data?.conversation?.context ?? null;

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-muted)]">
      {showHeader ? (
        context ? (
          <div className="relative">
            <ContextPanel context={context} />
            {threadQuery.isFetching ? (
              <span className="absolute right-3 top-2 text-[10px] text-[var(--color-text-muted)]">
                Yenileniyor…
              </span>
            ) : null}
          </div>
        ) : (
          <div className="flex items-center justify-between border-b border-[var(--color-border)] bg-white px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
              Konuşma
            </span>
            {threadQuery.isFetching ? (
              <span className="text-[11px] text-[var(--color-text-muted)]">
                Yenileniyor…
              </span>
            ) : null}
          </div>
        )
      ) : null}

      <div
        ref={scrollRef}
        className={`flex-1 space-y-3 overflow-y-auto p-3 ${heightClass}`}
      >
        {threadQuery.isLoading ? (
          <div className="py-8 text-center text-sm text-[var(--color-text-muted)]">
            Yükleniyor…
          </div>
        ) : threadQuery.isError ? (
          <div className="flex items-center justify-between rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <span>
              {threadQuery.error instanceof Error
                ? threadQuery.error.message
                : "Konuşma alınamadı"}
            </span>
            <button
              type="button"
              onClick={() => void threadQuery.refetch()}
              className="rounded-md border border-red-300 bg-white px-2 py-1 text-xs text-red-700 hover:bg-red-100"
            >
              Tekrar dene
            </button>
          </div>
        ) : messages.length === 0 ? (
          <div className="py-8 text-center text-sm text-[var(--color-text-muted)]">
            Henüz mesaj yok. İlk mesajı siz yazın.
          </div>
        ) : (
          messages.map((m) => <MessageBubble key={m.id} message={m} />)
        )}
      </div>

      {files.length > 0 ? (
        <div className="flex flex-wrap gap-2 border-t border-[var(--color-border)] bg-white px-3 py-2">
          {files.map((f, idx) => (
            <div
              key={`${f.name}-${idx}`}
              className="relative h-14 w-14 overflow-hidden rounded-md border border-[var(--color-border)]"
              title={f.name}
            >
              {f.type.startsWith("video/") ||
              /\.(mp4|mov|m4v|webm|mkv|avi|3gp)$/i.test(f.name) ? (
                <span className="flex h-full w-full items-center justify-center bg-slate-800 text-lg text-white">
                  ▶
                </span>
              ) : (
                <img
                  src={URL.createObjectURL(f)}
                  alt={f.name}
                  className="h-full w-full object-cover"
                />
              )}
              <button
                type="button"
                onClick={() => removeFile(idx)}
                className="absolute right-0 top-0 flex h-4 w-4 items-center justify-center bg-black/60 text-[10px] text-white"
                aria-label="Kaldır"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex items-end gap-2 border-t border-[var(--color-border)] bg-white p-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)]"
          aria-label="Fotoğraf / video ekle"
          title="Fotoğraf / video ekle"
        >
          <span aria-hidden="true">📎</span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*,.heic,.heif,.mov,.mp4"
          multiple
          className="hidden"
          onChange={(e) => handleFilesPicked(e.target.files)}
        />
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleSend();
            }
          }}
          rows={1}
          placeholder="Mesaj yazın… (Ctrl/⌘+Enter ile gönder)"
          className="max-h-28 min-h-[2.25rem] flex-1 resize-y rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={sendMutation.isPending}
          className="inline-flex h-9 shrink-0 items-center rounded-md bg-[var(--color-brand-blue)] px-4 text-sm font-semibold text-white hover:bg-[var(--color-brand-navy)] disabled:opacity-50"
        >
          {sendMutation.isPending ? "Gönderiliyor…" : "Gönder"}
        </button>
      </div>
    </div>
  );
});

export default ConversationChat;
