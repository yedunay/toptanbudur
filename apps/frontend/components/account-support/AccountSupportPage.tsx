"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { apiCustomer, ApiError, requireCustomer } from "@/lib/auth";
import { getCarrierTrackingUrl } from "@/lib/cargo-tracking";
import { ChatThread } from "@/components/chat/ChatThread";
import { SupportMetricGrid } from "./SupportMetricGrid";
import { SupportFilterBar } from "./SupportFilterBar";
import { SupportTicketsTable } from "./SupportTicketsTable";
import { SupportSidebar } from "./SupportSidebar";
import {
  buildMetrics,
  buildSummary,
  extractTickets,
  mapTickets,
} from "./support-mapper";
import type { TabKey, Ticket, TicketStatus } from "./types";

/* ------------------------------------------------------------------ */
/*  Shared helpers & sub-components (kept from original)              */
/* ------------------------------------------------------------------ */

const MAX_FILES = 5;
// Foto + video kabulü (2026-08-02): iPhone HEIC ve videolar filtreye takılıp
// sessizce düşüyordu. Kesin tür kararı backend'de (magic-byte); bu kaba eleme.
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MEDIA_EXT_RE =
  /\.(heic|heif|jpe?g|png|webp|gif|avif|mp4|mov|m4v|webm|mkv|avi|3gp)$/i;

function isAcceptedMedia(f: File): boolean {
  if (f.type.startsWith("image/") || f.type.startsWith("video/")) return true;
  return f.type === "" && MEDIA_EXT_RE.test(f.name);
}

function isVideoFile(f: File): boolean {
  if (f.type.startsWith("video/")) return true;
  return /\.(mp4|mov|m4v|webm|mkv|avi|3gp)$/i.test(f.name);
}
// İADE FATURASI (PDF) — yalnız 'iade' + sipariş faturalıysa zorunlu, 10 MB.
const MAX_INVOICE_BYTES = 10 * 1024 * 1024;

function buildAttachmentSrc(url: string | null): string | null {
  if (!url) return null;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  const base = process.env.NEXT_PUBLIC_API_URL ?? "";
  if (!base) return url;
  return `${base.replace(/\/$/, "")}${url.startsWith("/") ? url : `/${url}`}`;
}

interface ListEnvelope {
  success: boolean;
  data: Ticket[];
}

const STATUS_LABEL: Record<TicketStatus, string> = {
  NEW: "Beklemede",
  READ: "İncelemede",
  REPLIED: "Cevaplandı",
  ARCHIVED: "Kapalı",
};

const STATUS_CLASS: Record<TicketStatus, string> = {
  NEW: "bg-amber-50 text-amber-700 border-amber-200",
  READ: "bg-blue-50 text-blue-700 border-blue-200",
  REPLIED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  ARCHIVED: "bg-slate-100 text-slate-600 border-slate-200",
};

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("tr-TR", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function StatusBadge({ status }: { status: TicketStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS_CLASS[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Create Ticket Modal                                               */
/* ------------------------------------------------------------------ */

// Müşteri kafa karışmasın diye BİLİNÇLİ 4 tür (kullanıcı kararı 2026-08-01).
// Eski taleplerdeki kaldırılan kategoriler görüntülenmeye devam eder
// (support-mapper CATEGORY_LABEL) — yalnız YENİ talep açarken seçilemez.
const CATEGORY_OPTIONS = [
  { value: "", label: "— Kategori Seçin —" },
  { value: "kargo", label: "Kargo" },
  { value: "iptal", label: "İptal" },
  { value: "iade", label: "İade" },
  { value: "diger", label: "Diğer" },
];

interface CreateModalProps {
  initialOrderId?: string | null;
  initialOrderNumber?: string | null;
  /** Bağlı sipariş faturalandı mı? İADE talebinde faturalıysa iade faturası
   *  (PDF) yüklemek ZORUNLU olur (backend de zorlar). */
  initialInvoiced?: boolean;
  /** Sipariş detayından "İade Talebi" ile gelindiğinde kategoriyi önden seç. */
  initialCategory?: string | null;
  onClose: () => void;
  onCreated: (ticket: Ticket) => void;
}

function CreateTicketModal({
  initialOrderId,
  initialOrderNumber,
  initialInvoiced,
  initialCategory,
  onClose,
  onCreated,
}: CreateModalProps) {
  const orderBound = Boolean(initialOrderId);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState(initialCategory ?? "");
  const [files, setFiles] = useState<File[]>([]);
  // İade faturası (PDF) — yalnız kategori 'iade' için kullanılır.
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isReturn = category === "iade";
  // Sipariş faturalı mı? İlk değer URL'den (initialInvoiced) gelir; modal
  // içinde /me/orders/:id ile KESİN doğrulanır (backend `invoicedAt` otorite).
  // Böylece İade'ye genel "Destek Talebi" yolundan (invoiced param'sız) gelinse
  // bile faturalı siparişte PDF alanı doğru çıkar — çıkmaz (dead-end) olmaz.
  const [orderInvoiced, setOrderInvoiced] = useState<boolean>(
    Boolean(initialInvoiced),
  );
  // Faturalı siparişte iade faturası ZORUNLU; faturasızda hiç istenmez.
  const invoiceRequired = isReturn && orderInvoiced;

  function addFiles(incoming: FileList | null) {
    if (!incoming || incoming.length === 0) return;
    setError(null);
    const next = [...files];
    for (const f of Array.from(incoming)) {
      if (next.length >= MAX_FILES) {
        setError(`En fazla ${MAX_FILES} adet görsel ekleyebilirsiniz.`);
        break;
      }
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
    setFiles(next.slice(0, MAX_FILES));
  }

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  function pickInvoice(incoming: FileList | null) {
    const f = incoming?.[0];
    if (!f) return;
    setError(null);
    if (f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf")) {
      setError("İade faturası yalnızca PDF formatında olabilir.");
      return;
    }
    if (f.size > MAX_INVOICE_BYTES) {
      setError(`İade faturası 10 MB sınırını aşıyor: ${f.name}`);
      return;
    }
    setInvoiceFile(f);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  // Kategori "iptal"/"iade" seçildiğinde ve subject boşsa anlamlı varsayılan koy.
  useEffect(() => {
    if (subject || !initialOrderNumber) return;
    if (category === "iptal") {
      setSubject(`Sipariş İptal Talebi — #${initialOrderNumber}`);
    } else if (category === "iade") {
      setSubject(`Sipariş İade Talebi — #${initialOrderNumber}`);
    }
  }, [category, subject, initialOrderNumber]);

  // İADE + sipariş bağlı → siparişin GERÇEKTEN faturalı olup olmadığını çek
  // (URL param'ına güvenme; backend `invoicedAt` otoritedir). Hata olursa
  // initialInvoiced değerinde kalır; backend zaten kapıyı zorlar.
  useEffect(() => {
    if (!isReturn || !initialOrderId) return;
    let cancelled = false;
    apiCustomer<unknown>(`/me/orders/${encodeURIComponent(initialOrderId)}`, {
      method: "GET",
      general: true,
    })
      .then((data) => {
        if (cancelled) return;
        const o =
          data && typeof data === "object" && "data" in data
            ? (data as { data: unknown }).data
            : data;
        const rec = (o ?? {}) as {
          invoicedAt?: string | null;
          invoiceBatch?: { status?: string | null } | null;
        };
        setOrderInvoiced(
          Boolean(rec.invoicedAt) || rec.invoiceBatch?.status === "invoiced",
        );
      })
      .catch(() => {
        /* sessiz — initialInvoiced değerinde kal, backend yine zorlar */
      });
    return () => {
      cancelled = true;
    };
  }, [isReturn, initialOrderId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (body.trim().length < 2) {
      setError("Lütfen mesajınızı yazın.");
      return;
    }
    // Faturalı sipariş için iade faturası (PDF) zorunlu — talebi açmak için şart.
    if (invoiceRequired && !invoiceFile) {
      setError(
        "Bu sipariş faturalandırıldığı için iade talebinizi açabilmek üzere iade faturası (PDF) yüklemeniz gerekir.",
      );
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("body", body.trim());
      if (subject.trim()) fd.append("subject", subject.trim());
      if (category) fd.append("category", category);
      if (initialOrderId) {
        fd.append("orderId", initialOrderId);
        fd.append("kind", "order");
      } else {
        fd.append("kind", "general");
      }
      if (initialOrderNumber) fd.append("orderNumber", initialOrderNumber);
      for (const file of files) fd.append("files", file, file.name);
      // İade faturası (PDF) yalnız 'iade' kategorisinde gönderilir.
      if (isReturn && invoiceFile) {
        fd.append("returnInvoice", invoiceFile, invoiceFile.name);
      }

      await apiCustomer<{ ok: true; id: string }>("/me/support-tickets", {
        method: "POST",
        general: true,
        body: fd,
      });

      onCreated({
        id: "",
        subject: subject || null,
        body,
        status: "NEW",
        adminNote: null,
        kind: initialOrderId ? "order" : "general",
        category: category || null,
        orderId: initialOrderId ?? null,
        orderNumber: initialOrderNumber ?? null,
        marketplace: null,
        carrier: null,
        trackingCode: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        attachments: [],
      });
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : "Talebiniz iletilemedi. Lütfen tekrar deneyin.";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ticket-modal-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h3
            id="ticket-modal-title"
            className="text-base font-bold text-[var(--brand-navy)]"
          >
            {orderBound
              ? `Sipariş${initialOrderNumber ? ` #${initialOrderNumber}` : ""} için Talep Aç`
              : "Yeni Destek Talebi Oluştur"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            aria-label="Kapat"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">
              Konu (opsiyonel)
            </label>
            <input
              type="text"
              maxLength={200}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--brand-blue)] focus:outline-none"
              placeholder="Örn. Eksik ürün, fatura sorunu"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">
              Kategori
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--brand-blue)] focus:outline-none"
            >
              {CATEGORY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {isReturn ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
              <p className="font-semibold">
                Yalnızca kusurlu ürünlerin iadesi kabul edilir.
              </p>
              <p className="mt-1">
                Talebiniz incelenir; onaylanırsa size konuşma üzerinden bir iade
                adresi iletilir ve ürünü o adrese kargolamanız istenir. Ürün bize
                ulaşıp incelendikten sonra tutar cüzdan (cari) bakiyenize iade
                edilir.
              </p>
            </div>
          ) : null}

          {invoiceRequired ? (
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">
                İade Faturası (PDF) <span className="text-red-500">*</span>
              </label>
              <p className="mb-2 text-xs text-slate-500">
                Bu sipariş faturalandırıldığı için talebi açabilmek üzere iade
                faturanızı (PDF) yüklemeniz gerekir.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex cursor-pointer items-center rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-white">
                  + PDF Seç
                  <input
                    type="file"
                    className="sr-only"
                    accept="application/pdf"
                    onChange={(e) => {
                      pickInvoice(e.target.files);
                      e.target.value = "";
                    }}
                    disabled={submitting}
                  />
                </label>
                {invoiceFile ? (
                  <span className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700">
                    <span className="max-w-[180px] truncate">
                      {invoiceFile.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => setInvoiceFile(null)}
                      className="text-red-500 hover:text-red-700"
                      aria-label="İade faturasını kaldır"
                    >
                      ✕
                    </button>
                  </span>
                ) : (
                  <span className="text-xs text-slate-400">PDF seçilmedi</span>
                )}
              </div>
            </div>
          ) : null}

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">
              Mesajınız <span className="text-red-500">*</span>
            </label>
            <textarea
              required
              minLength={2}
              maxLength={8000}
              rows={5}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[var(--brand-blue)] focus:outline-none"
              placeholder={
                category === "iptal"
                  ? "İptal sebebinizi ve iptal etmek istediğiniz ürünleri belirtin..."
                  : category === "iade"
                    ? "İade etmek istediğiniz ürünü ve kusuru/gerekçeyi belirtin..."
                    : "Sorununuzu detaylandırın..."
              }
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">
              Fotoğraf / Video Ekle (opsiyonel · en fazla {MAX_FILES} adet ·
              100 MB)
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-white">
                + Dosya Seç
                <input
                  type="file"
                  className="sr-only"
                  multiple
                  accept="image/*,video/*,.heic,.heif,.mov,.mp4"
                  onChange={(e) => {
                    addFiles(e.target.files);
                    e.target.value = "";
                  }}
                  disabled={submitting || files.length >= MAX_FILES}
                />
              </label>
              <span className="text-xs text-slate-500">
                {files.length}/{MAX_FILES} seçildi
              </span>
            </div>
            {files.length > 0 ? (
              <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {files.map((f, i) => {
                  const video = isVideoFile(f);
                  const url = video ? null : URL.createObjectURL(f);
                  return (
                    <li
                      key={`${f.name}-${i}`}
                      className="group relative overflow-hidden rounded-lg border border-slate-200 bg-white"
                    >
                      {url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={url}
                          alt={f.name}
                          className="h-24 w-full object-cover"
                          onLoad={() => URL.revokeObjectURL(url)}
                        />
                      ) : (
                        <span className="flex h-24 w-full items-center justify-center bg-slate-800 text-2xl text-white">
                          🎬
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => removeFile(i)}
                        className="absolute right-1 top-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white opacity-0 transition group-hover:opacity-100"
                        aria-label={`${f.name} dosyasını kaldır`}
                      >
                        ✕ Kaldır
                      </button>
                      <div className="truncate px-2 py-1 text-[10px] text-slate-500">
                        {f.name}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>

          {error ? (
            <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
            <button type="button" onClick={onClose} disabled={submitting} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
              İptal
            </button>
            <button type="submit" disabled={submitting} className="rounded-lg bg-[var(--brand-blue)] px-5 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-[var(--brand-navy)] disabled:opacity-60">
              {submitting ? "Gönderiliyor..." : "Talebi Gönder"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Cargo Card                                                        */
/* ------------------------------------------------------------------ */

function CargoCard({ ticket }: { ticket: Ticket }) {
  const snap = ticket.orderSnapshot ?? null;
  const marketplace = ticket.marketplace ?? snap?.marketplace ?? null;
  const carrier = ticket.carrier ?? snap?.cargoCompany ?? null;
  const trackingCode = ticket.trackingCode ?? snap?.cargoBarcode ?? null;
  const hasInfo = Boolean(marketplace || carrier || trackingCode);
  if (!hasInfo) return null;
  const url = getCarrierTrackingUrl(carrier, trackingCode);
  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h4 className="text-sm font-bold text-[var(--brand-navy)]">Kargo Bilgileri</h4>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
        {marketplace ? (<div><dt className="text-xs text-slate-500">Satış Kanalı</dt><dd className="mt-0.5 font-semibold text-slate-900">{marketplace}</dd></div>) : null}
        {carrier ? (<div><dt className="text-xs text-slate-500">Kargo Firması</dt><dd className="mt-0.5 font-semibold text-slate-900">{carrier}</dd></div>) : null}
        {trackingCode ? (<div><dt className="text-xs text-slate-500">Kargo Kodu</dt><dd className="mt-0.5 font-mono text-xs font-semibold text-slate-900">{trackingCode}</dd></div>) : null}
      </dl>
      {url ? (<a href={url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex rounded-lg bg-[var(--brand-blue)] px-4 py-1.5 text-sm font-bold text-white shadow-sm transition hover:bg-[var(--brand-navy)]">Kargo Takip ↗</a>) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Order Snapshot Card — son müşteri + ürünler + fiyat               */
/* ------------------------------------------------------------------ */

function formatMoney(amount: string, currency: string): string {
  try {
    const n = Number(amount);
    if (!Number.isFinite(n)) return `${amount} ${currency}`;
    return new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency: currency || "TRY",
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${amount} ${currency}`;
  }
}

function OrderSnapshotCard({ ticket }: { ticket: Ticket }) {
  const snap = ticket.orderSnapshot;
  if (!snap) return null;
  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-bold text-[var(--brand-navy)]">Sipariş Bilgileri</h4>
        <Link
          href={`/hesabim/siparislerim/${snap.orderId}`}
          className="text-xs font-semibold text-[var(--brand-blue)] hover:underline"
        >
          Siparişe Git ↗
        </Link>
      </div>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-slate-500">Sipariş No</dt>
          <dd className="mt-0.5 font-mono text-xs font-semibold text-slate-900">
            #{snap.humanOrderNo}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Son Müşteri</dt>
          <dd className="mt-0.5 font-semibold text-slate-900">{snap.recipientName}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Tutar</dt>
          <dd className="mt-0.5 font-bold text-slate-900">
            {formatMoney(snap.total, snap.currency)}
          </dd>
        </div>
      </dl>
      {snap.items.length > 0 ? (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Ürünler ({snap.items.length})
          </p>
          <ul className="mt-2 divide-y divide-slate-100">
            {snap.items.map((it) => (
              <li key={it.id} className="flex items-center gap-3 py-2">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                  {it.imageUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={it.imageUrl}
                      alt={it.name}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <span className="text-[10px] text-slate-400">Görsel yok</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900">{it.name}</p>
                  <p className="text-xs text-slate-500">
                    {it.qty} adet · {formatMoney(it.unitPrice, snap.currency)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Ticket Detail Panel                                               */
/* ------------------------------------------------------------------ */

function TicketDetailPanel({
  ticket,
  onBack,
  onChanged,
}: {
  ticket: Ticket;
  onBack: () => void;
  onChanged: () => void;
}) {
  const orderHref =
    ticket.orderId ?? ticket.orderSnapshot?.orderId ?? "";
  const orderLabel =
    ticket.orderNumber ?? ticket.orderSnapshot?.humanOrderNo ?? null;

  // İADE akışı — müşteri "Ürünü Kargoya Verdim" adımı (yalnız APPROVED'da aktif).
  const isReturn = ticket.category === "iade" || !!ticket.returnStatus;
  const [shipFile, setShipFile] = useState<File | null>(null);
  const [shipSubmitting, setShipSubmitting] = useState(false);
  const [shipError, setShipError] = useState<string | null>(null);

  const submitReturnShipped = useCallback(async () => {
    if (!shipFile) {
      setShipError("Lütfen kargoya verdiğinize dair bir fotoğraf seçin.");
      return;
    }
    if (shipFile.size > 5 * 1024 * 1024) {
      setShipError("Fotoğraf 5 MB sınırını aşıyor.");
      return;
    }
    setShipSubmitting(true);
    setShipError(null);
    try {
      const fd = new FormData();
      fd.append("files", shipFile);
      await apiCustomer(`/me/support-tickets/${ticket.id}/return-shipped`, {
        method: "POST",
        body: fd,
        general: true,
      });
      setShipFile(null);
      onChanged();
    } catch (err) {
      setShipError(
        err instanceof ApiError
          ? err.message
          : "İşlem başarısız. Lütfen tekrar deneyin.",
      );
    } finally {
      setShipSubmitting(false);
    }
  }, [shipFile, ticket.id, onChanged]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/40" onClick={onBack} onKeyDown={(e) => e.key === "Escape" && onBack()} role="button" tabIndex={0} aria-label="Kapat" />
      <div className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white p-6 shadow-2xl sm:rounded-3xl">
        <div className="mb-4 flex items-start justify-between">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-black text-[var(--text)]">{ticket.subject || "Destek Talebi"}</h3>
            <p className="mt-0.5 text-sm text-[var(--text-muted)]">
              {ticket.ticketNo ? (
                <span className="mr-2 font-mono text-xs font-bold text-[var(--brand-navy)]">
                  {ticket.ticketNo}
                </span>
              ) : null}
              {formatDate(ticket.createdAt)}
              {orderLabel ? (<> · Sipariş <Link href={`/hesabim/siparislerim/${orderHref}`} className="font-semibold text-[var(--brand-blue)] hover:underline">#{orderLabel}</Link></>) : null}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={ticket.status} />
            <button type="button" onClick={onBack} className="rounded-full p-2 text-[var(--text-muted)] hover:bg-slate-100">&times;</button>
          </div>
        </div>

        <div className="whitespace-pre-wrap rounded-xl bg-[var(--surface-muted)] p-4 text-sm text-[var(--text)]">
          {ticket.body}
        </div>

        {/* İADE AKIŞI — müşteri adımı. Durum bazlı gösterim. */}
        {isReturn && ticket.returnStatus ? (
          <div className="mt-4 rounded-xl border border-[var(--border)] p-4">
            <h4 className="text-sm font-black text-[var(--text)]">İade Durumu</h4>

            {ticket.returnStatus === "REQUESTED" ? (
              <p className="mt-2 text-sm text-[var(--text-muted)]">
                İade talebiniz alındı, inceleniyor. Onaylandığında size iade
                adresini ileteceğiz.
              </p>
            ) : null}

            {ticket.returnStatus === "APPROVED" ? (
              <>
                <p className="mt-2 text-sm text-[var(--text)]">
                  İadeniz onaylandı. Ürünü aşağıdaki adrese kargolayın, ardından
                  kargoya verdiğinize dair fotoğrafı (kargo fişi/koli) yükleyip
                  <strong> “Ürünü Kargoya Verdim”</strong> butonuna basın. Ücret
                  iadeniz, ürün tarafımıza ulaşıp incelendikten sonra cüzdan
                  bakiyenize yapılır.
                </p>
                {ticket.returnAddress ? (
                  <div className="mt-3 rounded-lg bg-[var(--surface-muted)] p-3 text-sm">
                    <div className="font-bold text-[var(--text)]">
                      İade Adresi
                    </div>
                    <div className="mt-1 whitespace-pre-wrap text-[var(--text-muted)]">
                      {ticket.returnAddress}
                    </div>
                  </div>
                ) : null}
                <div className="mt-3">
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={shipSubmitting}
                    onChange={(e) => {
                      setShipError(null);
                      setShipFile(e.target.files?.[0] ?? null);
                    }}
                    className="block w-full text-sm text-[var(--text-muted)] file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--brand-blue)] file:px-4 file:py-2 file:text-sm file:font-bold file:text-white"
                  />
                  {shipError ? (
                    <p className="mt-2 text-xs font-semibold text-red-600">
                      {shipError}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    onClick={submitReturnShipped}
                    disabled={shipSubmitting || !shipFile}
                    className="mt-3 w-full rounded-xl bg-emerald-600 py-3 text-sm font-black text-white transition hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {shipSubmitting ? "Gönderiliyor…" : "Ürünü Kargoya Verdim"}
                  </button>
                </div>
              </>
            ) : null}

            {ticket.returnStatus === "SHIPPED_BACK" ? (
              <p className="mt-2 text-sm text-[var(--text)]">
                Ürünü kargoya verdiğinizi bildirdiniz, teşekkürler. Ürün
                tarafımıza ulaşıp incelendikten sonra ücret iadeniz cüzdan
                bakiyenize yapılacaktır.
              </p>
            ) : null}

            {ticket.returnStatus === "FINALIZED" ? (
              <p className="mt-2 text-sm font-semibold text-emerald-700">
                İadeniz tamamlandı. Sipariş tutarı cüzdan (cari) bakiyenize iade
                edildi.
              </p>
            ) : null}

            {ticket.returnStatus === "REJECTED" ? (
              <p className="mt-2 text-sm text-amber-700">
                İade talebiniz değerlendirildi ancak uygun bulunmadı. Ayrıntı
                için yazışmayı inceleyebilirsiniz.
              </p>
            ) : null}
          </div>
        ) : null}

        <OrderSnapshotCard ticket={ticket} />
        <CargoCard ticket={ticket} />

        {ticket.attachments && ticket.attachments.length > 0 ? (
          <div className="mt-4">
            <h4 className="text-sm font-black text-[var(--text)]">Eklenen Dosyalar ({ticket.attachments.length})</h4>
            <ul className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {ticket.attachments.map((att) => {
                const src = buildAttachmentSrc(att.url);
                if (!src) return null;
                const video =
                  (att.mimetype ?? "").startsWith("video/") ||
                  /\.(mp4|mov|m4v|webm|mkv|avi|3gp)$/i.test(att.filename ?? "");
                return (
                  <li key={att.id} className="overflow-hidden rounded-lg border border-slate-200">
                    {video ? (
                      // eslint-disable-next-line jsx-a11y/media-has-caption
                      <video src={src} controls preload="metadata" className="h-28 w-full bg-black object-contain" />
                    ) : (
                      <a href={src} target="_blank" rel="noopener noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={src} alt={att.filename} className="h-28 w-full object-cover transition hover:opacity-90" loading="lazy" />
                      </a>
                    )}
                    <div className="truncate px-2 py-1 text-[10px] text-slate-500">{att.filename}</div>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {ticket.conversationId ? (
          <div className="mt-4">
            <h4 className="mb-2 text-sm font-black text-[var(--text)]">
              Yazışma
            </h4>
            <ChatThread
              conversationId={ticket.conversationId}
              placeholder="Destek ekibine mesaj yazın…"
            />
          </div>
        ) : ticket.adminNote ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <h4 className="text-sm font-black text-emerald-900">Toptan Budur Yanıtı</h4>
            <div className="mt-2 whitespace-pre-wrap text-sm text-emerald-900">{ticket.adminNote}</div>
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            Henüz yanıt verilmedi. Ekibimiz en kısa sürede dönüş yapacaktır.
          </div>
        )}

        <button type="button" onClick={onBack} className="mt-6 w-full rounded-xl border border-[var(--border)] py-3 text-sm font-black text-[var(--text)] transition hover:bg-slate-50">
          Kapat
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Content                                                      */
/* ------------------------------------------------------------------ */

function DestekContent() {
  const auth = requireCustomer();
  const router = useRouter();
  const params = useSearchParams();

  const initialOrderId = params.get("orderId");
  const initialOrderNumber = params.get("orderNumber");
  const initialInvoiced = params.get("invoiced") === "1";
  const initialCategory = params.get("category");
  const wantsNew = params.get("new") === "1";

  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  // Modal açılış başlangıç değerleri (sipariş/kategori/faturalı). Auto-open
  // (İade Talebi linki) bunları URL'den snapshot'lar; sonra URL temizlenir ki
  // sonraki MANUEL "Yeni talep" açılışları bu bağlamla kirlenmesin (null = boş).
  const [modalInit, setModalInit] = useState<{
    orderId: string | null;
    orderNumber: string | null;
    invoiced: boolean;
    category: string | null;
  } | null>(null);
  const openBlankModal = useCallback(() => {
    setModalInit(null);
    setShowModal(true);
  }, []);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);

  // Filters
  const [activeTab, setActiveTab] = useState<TabKey>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const refresh = useCallback(async () => {
    try {
      const env = await apiCustomer<ListEnvelope>("/me/support-tickets", {
        method: "GET",
        general: true,
      });
      setTickets(env.data ?? []);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Talepler yüklenemedi.";
      setError(msg);
    }
  }, []);

  // Müşterinin kendi talebini kapatması (soft-archive → ARCHIVED). Backend
  // sahipliği customerId ile doğrular; idempotent — zaten kapalıysa da 200 döner.
  const handleCloseTicket = useCallback(
    async (id: string) => {
      if (typeof window !== "undefined") {
        const ok = window.confirm(
          "Bu destek talebini kapatmak istediğinize emin misiniz? Kapatılan talep yeniden açılamaz.",
        );
        if (!ok) return;
      }
      setClosingId(id);
      setError(null);
      try {
        await apiCustomer(`/me/support-tickets/${id}/close`, {
          method: "POST",
          general: true,
        });
        await refresh();
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : "Talep kapatılamadı.";
        setError(msg);
      } finally {
        setClosingId(null);
      }
    },
    [refresh],
  );

  useEffect(() => {
    if (auth.loading || !auth.customer) return;
    if (wantsNew) {
      // Başlangıç değerlerini URL temizlenmeden ÖNCE snapshot'la — açık modal
      // bundan beslenir, URL değişse de bozulmaz.
      setModalInit({
        orderId: initialOrderId,
        orderNumber: initialOrderNumber,
        invoiced: initialInvoiced,
        category: initialCategory,
      });
      setShowModal(true);
      // 'new' + iade bağlam paramlarını temizle → sonraki manuel açılışlar temiz.
      const next = new URLSearchParams(params);
      next.delete("new");
      next.delete("orderId");
      next.delete("orderNumber");
      next.delete("category");
      next.delete("invoiced");
      const qs = next.toString();
      router.replace(`/hesabim/destek${qs ? `?${qs}` : ""}`);
    }
  }, [
    auth.loading,
    auth.customer,
    wantsNew,
    params,
    router,
    initialOrderId,
    initialOrderNumber,
    initialInvoiced,
    initialCategory,
  ]);

  useEffect(() => {
    if (auth.loading || !auth.customer) return;
    void refresh();
  }, [auth.loading, auth.customer, refresh]);

  // Metrics (from all tickets)
  const metrics = useMemo(() => (tickets ? buildMetrics(tickets) : []), [tickets]);
  const summary = useMemo(() => (tickets ? buildSummary(tickets) : []), [tickets]);

  // Filtering
  const filtered = useMemo(() => {
    if (!tickets) return [];
    let result = tickets;

    // Tab filter
    if (activeTab === "open") result = result.filter((t) => t.status === "NEW" || t.status === "READ");
    else if (activeTab === "replied") result = result.filter((t) => t.status === "REPLIED");
    else if (activeTab === "closed") result = result.filter((t) => t.status === "ARCHIVED");

    // Status dropdown
    if (statusFilter) result = result.filter((t) => t.status === statusFilter);

    // Category
    if (categoryFilter) result = result.filter((t) => (t.category ?? "") === categoryFilter);

    // Search — subject/body + sipariş numarası + son müşteri ismi + ticketNo
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((t) => {
        const subject = (t.subject ?? "").toLowerCase();
        const body = t.body.toLowerCase();
        const orderNo = (t.orderNumber ?? "").toLowerCase();
        const snapOrderNo = (t.orderSnapshot?.humanOrderNo ?? "").toLowerCase();
        const recipient = (t.orderSnapshot?.recipientName ?? "").toLowerCase();
        const ticketNo = (t.ticketNo ?? "").toLowerCase();
        const cargoBarcode = (t.orderSnapshot?.cargoBarcode ?? "").toLowerCase();
        const cargoCompany = (t.orderSnapshot?.cargoCompany ?? "").toLowerCase();
        const productMatch =
          t.orderSnapshot?.items?.some((it) =>
            it.name.toLowerCase().includes(q),
          ) ?? false;
        return (
          subject.includes(q) ||
          body.includes(q) ||
          orderNo.includes(q) ||
          snapOrderNo.includes(q) ||
          recipient.includes(q) ||
          ticketNo.includes(q) ||
          cargoBarcode.includes(q) ||
          cargoCompany.includes(q) ||
          productMatch
        );
      });
    }

    return result;
  }, [tickets, activeTab, statusFilter, categoryFilter, searchQuery]);

  const tableItems = useMemo(() => mapTickets(filtered), [filtered]);
  const paginatedItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return tableItems.slice(start, start + pageSize);
  }, [tableItems, page, pageSize]);

  // Reset page on filter change
  useEffect(() => { setPage(1); }, [activeTab, statusFilter, categoryFilter, searchQuery]);

  const selectedTicket = useMemo(
    () => tickets?.find((t) => t.id === detailId) ?? null,
    [tickets, detailId],
  );

  if (auth.loading || tickets === null) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl bg-[var(--surface-muted)]" />
          ))}
        </div>
        <div className="h-11 animate-pulse rounded-xl bg-[var(--surface-muted)]" />
        <div className="h-80 animate-pulse rounded-3xl bg-[var(--surface-muted)]" />
      </div>
    );
  }

  if (!auth.customer) return null;

  return (
    <div className="space-y-5">
      {/* Header with create button */}
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={openBlankModal}
          className="inline-flex items-center gap-2 rounded-xl bg-[var(--brand-blue)] px-5 py-3 text-sm font-black text-white shadow-sm transition hover:bg-[var(--brand-navy)]"
        >
          <Plus className="h-4 w-4" />
          Yeni Destek Talebi Oluştur
        </button>
      </div>

      {error ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {/* Metrics */}
      <SupportMetricGrid metrics={metrics} />

      {/* Filters */}
      <SupportFilterBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        statusFilter={statusFilter}
        onStatusChange={setStatusFilter}
        categoryFilter={categoryFilter}
        onCategoryChange={setCategoryFilter}
        onFilter={() => setPage(1)}
      />

      {/* Content: Table + Sidebar */}
      {tickets.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[var(--border)] bg-white p-12 text-center">
          <p className="text-base font-black text-[var(--text)]">Henüz bir destek talebiniz bulunmuyor</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-[var(--text-muted)]">
            Yukarıdaki butonu kullanarak yeni talep oluşturabilirsiniz.
          </p>
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_290px]">
          <SupportTicketsTable
            items={paginatedItems}
            page={page}
            pageSize={pageSize}
            totalItems={tableItems.length}
            onPageChange={setPage}
            onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
            onViewDetail={setDetailId}
            onCloseTicket={handleCloseTicket}
            closingId={closingId}
          />
          <SupportSidebar
            summaryItems={summary}
            totalTickets={tickets.length}
            onNewTicket={openBlankModal}
          />
        </div>
      )}

      {/* Detail modal */}
      {selectedTicket ? (
        <TicketDetailPanel ticket={selectedTicket} onBack={() => setDetailId(null)} onChanged={refresh} />
      ) : null}

      {/* Create modal */}
      {showModal ? (
        <CreateTicketModal
          initialOrderId={modalInit?.orderId ?? null}
          initialOrderNumber={modalInit?.orderNumber ?? null}
          initialInvoiced={modalInit?.invoiced ?? false}
          initialCategory={modalInit?.category ?? null}
          onClose={() => setShowModal(false)}
          onCreated={async () => {
            setShowModal(false);
            await refresh();
          }}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Export                                                             */
/* ------------------------------------------------------------------ */

export function AccountSupportPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-3">
          <div className="h-9 w-48 animate-pulse rounded-xl bg-slate-200" />
          <div className="h-24 animate-pulse rounded-2xl bg-slate-200" />
        </div>
      }
    >
      <DestekContent />
    </Suspense>
  );
}
