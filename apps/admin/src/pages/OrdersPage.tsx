import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRequireAuth } from "../lib/auth";
import {
  BULK_UPDATE_MAX,
  CARGO_COMPANY_LABELS,
  ORDER_MARKETPLACES,
  ORDER_MARKETPLACE_LABELS,
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  bulkUpdateOrders,
  countOrdersBySpecial,
  fetchOrder,
  fetchOrderStatusCounts,
  fetchOrders,
  formatOrderNo,
  formatShortDateTime,
  setOrderSupplierOrderNo,
  updateOrder,
  type BulkUpdateMode,
  type BulkUpdateOrdersInput,
  type BulkUpdateResult,
  type CargoCompany,
  type OrderFilters,
  type OrderListItem,
  type OrderMarketplace,
  type OrderSpecialFilter,
  type OrderStatus,
  type OrderStatusCounts,
  type OrdersResponse,
  type OrdersStats,
} from "../lib/orders";
import { formatTRY } from "../lib/products";
import { fetchSuppliers, type Supplier } from "../lib/suppliers";
import { fetchCustomers, type CustomerListItem } from "../lib/customers";
import ExportModal, { type ExportField } from "../components/ExportModal";
import { useToast } from "../components/Toast";
import { OrderSupplierPicker } from "../components/OrderSupplierPicker";
import { CustomerTagEditor } from "../components/CustomerTagEditor";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import {
  exportFromBackend,
  exportRowsAsCsv,
  isMissingEndpoint,
} from "../lib/exporting";
import { canAccess, getCurrentPermissions } from "../lib/permissions";

/**
 * Müşteriler sayfasındaki gibi kullanıcı sayfa boyutunu seçebilir. Backend
 * `pageSize`'ı 1–200 aralığına sıkıştırdığı için (admin-orders.service.ts)
 * "Tümü" seçeneği YOK; en büyük geçerli değer 200.
 */
type PageSizeOption = 25 | 50 | 100 | 200;
const PAGE_SIZE_OPTIONS: readonly PageSizeOption[] = [25, 50, 100, 200];
const DEFAULT_PAGE_SIZE: PageSizeOption = 25;

/** URL'den gelen ham `pageSize` değerini geçerli bir seçeneğe daraltır. */
function parsePageSize(raw: string | null): PageSizeOption {
  const n = Number(raw);
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(n)
    ? (n as PageSizeOption)
    : DEFAULT_PAGE_SIZE;
}

/**
 * Statü geçiş matrisi — Detay sayfasındaki STATUS_TRANSITIONS ve backend
 * C-ORDERS guard'ı (ALLOWED_STATUS_TRANSITIONS) ile BİREBİR aynı. Liste içi
 * inline dropdown ve toplu güncelleme yalnız bu izinli hedefleri göstermeli;
 * aksi halde örn. shipped→paid gibi backend'in reddedeceği (limbo/çift iade
 * riski olan) geçişler kullanıcıya sunuluyordu (#6).
 */
const STATUS_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  paid: ["preparing", "cancelled"],
  preparing: ["shipped", "cancelled"],
  shipped: ["refunded"],
  cancelled: [],
  refunded: [],
};

/**
 * Toplu güncellemede seçilebilecek hedef statüler. 'paid' BİLİNÇLİ olarak
 * yok — hiçbir statüden 'paid'e dönüş izinli değil (yeni sipariş zaten 'paid'
 * başlar, geri dönüş cari/stok tutarsızlığı üretir). #6 gereği bulk'tan
 * kaldırıldı.
 */
const BULK_TARGET_STATUSES: readonly OrderStatus[] = ORDER_STATUSES.filter(
  (s) => s !== "paid",
);

/**
 * Excel-benzeri resizable kolon altyapısı. Genişlikler localStorage'da
 * persist edilir; sayfa yenilense bile son ayar korunur.
 */
const COLUMN_WIDTHS_STORAGE_KEY = "admin-orders-col-widths-v1";

type ColumnKey =
  | "checkbox"
  | "products"
  | "customer"
  | "supplier"
  | "cargo"
  | "status"
  | "total"
  | "order"
  | "actions";

const DEFAULT_COLUMN_WIDTHS: Record<ColumnKey, number> = {
  checkbox: 44,
  products: 320,
  customer: 200,
  supplier: 180,
  cargo: 160,
  status: 130,
  total: 110,
  order: 160,
  actions: 56,
};

const MIN_COLUMN_WIDTH: Record<ColumnKey, number> = {
  checkbox: 36,
  products: 200,
  customer: 140,
  supplier: 120,
  cargo: 110,
  status: 100,
  total: 80,
  order: 120,
  actions: 48,
};

function useColumnWidths(): {
  widths: Record<ColumnKey, number>;
  startResize: (key: ColumnKey, e: React.PointerEvent<HTMLDivElement>) => void;
  resetWidths: () => void;
} {
  const [widths, setWidths] = useState<Record<ColumnKey, number>>(() => {
    if (typeof window === "undefined") return DEFAULT_COLUMN_WIDTHS;
    try {
      const raw = window.localStorage.getItem(COLUMN_WIDTHS_STORAGE_KEY);
      if (!raw) return DEFAULT_COLUMN_WIDTHS;
      const parsed = JSON.parse(raw) as Partial<Record<ColumnKey, number>>;
      return { ...DEFAULT_COLUMN_WIDTHS, ...parsed };
    } catch {
      return DEFAULT_COLUMN_WIDTHS;
    }
  });

  const widthsRef = useRef(widths);
  widthsRef.current = widths;

  useEffect(() => {
    try {
      window.localStorage.setItem(COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(widths));
    } catch {
      // localStorage may be unavailable (private mode); ignore
    }
  }, [widths]);

  const startResize = (key: ColumnKey, e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = widthsRef.current[key];
    const minWidth = MIN_COLUMN_WIDTH[key];
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: PointerEvent) => {
      const next = Math.max(minWidth, startWidth + (ev.clientX - startX));
      setWidths((prev) => (prev[key] === next ? prev : { ...prev, [key]: next }));
    };

    const onUp = (ev: PointerEvent) => {
      target.releasePointerCapture?.(ev.pointerId);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const resetWidths = () => setWidths(DEFAULT_COLUMN_WIDTHS);

  return { widths, startResize, resetWidths };
}

function ResizeHandle({
  columnKey,
  onStart,
}: {
  columnKey: ColumnKey;
  onStart: (key: ColumnKey, e: React.PointerEvent<HTMLDivElement>) => void;
}): React.ReactElement {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Kolon genişliğini ayarla"
      onPointerDown={(e) => onStart(columnKey, e)}
      onClick={(e) => e.stopPropagation()}
      className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize select-none touch-none hover:bg-[var(--color-brand-blue)]/40 active:bg-[var(--color-brand-blue)]/70"
    />
  );
}

function useCopyToClipboard(): (value: string | null | undefined, successMessage?: string) => void {
  const toast = useToast();
  return (value, successMessage = "Panoya kopyalandı") => {
    if (!value) return;
    void navigator.clipboard
      .writeText(value)
      .then(() => toast.push("success", successMessage))
      .catch(() => toast.push("error", "Kopyalanamadı"));
  };
}

function CopyButton({
  value,
  title = "Kopyala",
}: {
  value: string | null | undefined;
  title?: string;
}): React.ReactElement | null {
  const copy = useCopyToClipboard();
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        copy(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--color-text-muted)] hover:text-[var(--color-brand-blue)] hover:bg-[var(--color-surface-muted)] transition-colors"
    >
      {copied ? (
        <svg width="11" height="11" viewBox="0 0 20 20" fill="none">
          <path d="M5 10l3 3 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="11" height="11" viewBox="0 0 20 20" fill="none">
          <rect x="6" y="6" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M4 14V5a1 1 0 011-1h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}

/**
 * Orta boy kare kopyalama ikonu — ürün adının en başında durur. Tıklanınca
 * ürün adının TAMAMINI panoya kopyalar; kendi stopPropagation/preventDefault'u
 * sayesinde yanındaki "detaya git" Link'ini tetiklemez.
 */
function CopyIconSquare({
  value,
  title = "Kopyala",
  successMessage = "Panoya kopyalandı",
}: {
  value: string | null | undefined;
  title?: string;
  successMessage?: string;
}): React.ReactElement | null {
  const copy = useCopyToClipboard();
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        copy(value, successMessage);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}
      className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white text-[var(--color-text-muted)] shadow-sm transition-all hover:border-[var(--color-brand-blue)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-brand-blue)] active:scale-95"
    >
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
          <path d="M5 10l3 3 7-7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
          <rect x="6" y="6" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.6" />
          <path d="M4 14V5a1 1 0 011-1h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}

interface CopyableTextProps {
  value: string | null | undefined;
  title?: string;
  className?: string;
  children: React.ReactNode;
}

function CopyableText({
  value,
  title = "Tıkla, kopyala",
  className = "",
  children,
}: CopyableTextProps): React.ReactElement {
  const copy = useCopyToClipboard();
  return (
    <span
      role="button"
      tabIndex={0}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        copy(value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          copy(value);
        }
      }}
      className={`cursor-pointer rounded transition-colors hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-brand-blue)] ${className}`}
    >
      {children}
    </span>
  );
}

interface InlineOrderSupplierOrderNoProps {
  orderId: string;
  value: string | null;
}

/**
 * Sipariş bazında tedarikçi sipariş numarası — sipariş kolonunun altında
 * tek bir input olarak gösterilir. Tedarikçi tarafındaki sipariş numarası
 * (genelde tüm kalemler aynı numaraya bağlıdır) buraya girilir.
 */
function InlineOrderSupplierOrderNo({
  orderId,
  value,
}: InlineOrderSupplierOrderNoProps): React.ReactElement {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(value ?? "");
  const lastSavedRef = useRef(value ?? "");

  useEffect(() => {
    setDraft(value ?? "");
    lastSavedRef.current = value ?? "";
  }, [value]);

  const mutation = useMutation({
    mutationFn: (next: string | null) => setOrderSupplierOrderNo(orderId, next),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
      toast.push("success", "Tedarikçi sipariş no güncellendi");
    },
    onError: (err) => {
      toast.push(
        "error",
        err instanceof Error ? err.message : "Tedarikçi sipariş no güncellenemedi",
      );
      setDraft(lastSavedRef.current);
    },
  });

  function commit() {
    const trimmed = draft.trim();
    const next = trimmed.length > 0 ? trimmed : null;
    const prev = lastSavedRef.current.length > 0 ? lastSavedRef.current : null;
    if (next === prev) return;
    lastSavedRef.current = trimmed;
    mutation.mutate(next);
  }

  return (
    <div className="mb-1.5">
      <label className="block text-[9px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
        Tedarikçi Sip No
      </label>
      <input
        type="text"
        value={draft}
        placeholder="—"
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
        disabled={mutation.isPending}
        className="mt-0.5 w-full max-w-[140px] rounded-md border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[11px] text-slate-700 focus:border-[var(--color-brand-blue)] focus:outline-none focus:ring-1 focus:ring-[var(--color-brand-blue)] disabled:bg-slate-50"
      />
    </div>
  );
}

/**
 * Tedarikçi adından (ör. "İtedarik", "Go", "Xml Ticaret") deterministik bir
 * renk üretir. Aynı tedarikçi her zaman aynı renge düşer; FNV-1a 32-bit hash
 * ile palet seçimi yapılır, böylece yeni eklenen tedarikçiler bile stabil
 * renk alır. Renkler tailwind palette'inden, kontrast Aa-compliant.
 */
const SUPPLIER_BADGE_PALETTE = [
  { bg: "bg-blue-100", text: "text-blue-800", border: "border-blue-200" },
  { bg: "bg-emerald-100", text: "text-emerald-800", border: "border-emerald-200" },
  { bg: "bg-violet-100", text: "text-violet-800", border: "border-violet-200" },
  { bg: "bg-amber-100", text: "text-amber-800", border: "border-amber-200" },
  { bg: "bg-rose-100", text: "text-rose-800", border: "border-rose-200" },
  { bg: "bg-sky-100", text: "text-sky-800", border: "border-sky-200" },
  { bg: "bg-teal-100", text: "text-teal-800", border: "border-teal-200" },
  { bg: "bg-fuchsia-100", text: "text-fuchsia-800", border: "border-fuchsia-200" },
];

function supplierBadgeColor(name: string): (typeof SUPPLIER_BADGE_PALETTE)[number] {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i += 1) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return SUPPLIER_BADGE_PALETTE[h % SUPPLIER_BADGE_PALETTE.length];
}

interface LightboxImage {
  url: string;
  alt: string;
}

function ImageLightbox({
  image,
  onClose,
}: {
  image: LightboxImage | null;
  onClose: () => void;
}): React.ReactElement | null {
  useEffect(() => {
    if (!image) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [image, onClose]);

  if (!image) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Ürün görseli"
      onClick={onClose}
      className="fixed inset-0 z-[80] flex cursor-zoom-out items-center justify-center bg-black/80 p-4 backdrop-blur-sm animate-in fade-in"
    >
      <img
        src={image.url}
        alt={image.alt}
        className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
      />
      <button
        type="button"
        aria-label="Kapat"
        onClick={onClose}
        className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition-colors hover:bg-white/20"
      >
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
          <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

interface OrderNote {
  orderNo: string;
  note: string;
}

/**
 * Sipariş notunun tamamını gösteren popup. Liste satırındaki şerit notu
 * 2 satıra kırpar; uzun notlar burada tam okunur.
 */
function OrderNoteModal({
  note,
  onClose,
}: {
  note: OrderNote | null;
  onClose: () => void;
}): React.ReactElement | null {
  useEffect(() => {
    if (!note) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [note, onClose]);

  if (!note) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Sipariş notu"
      onClick={onClose}
      className="fixed inset-0 z-[80] flex items-start justify-center bg-black/50 p-4 pt-24 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-xl border border-amber-300 bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-3">
          <div className="text-sm font-semibold text-amber-900">
            📝 Sipariş Notu — {note.orderNo}
          </div>
          <button
            type="button"
            aria-label="Kapat"
            onClick={onClose}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-amber-900 transition-colors hover:bg-amber-100"
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <p className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap px-4 py-4 text-sm leading-relaxed text-[var(--color-text)]">
          {note.note}
        </p>
        <div className="flex justify-end gap-2 border-t border-[var(--color-border)] px-4 py-3">
          <CopyButton value={note.note} title="Notu kopyala" />
        </div>
      </div>
    </div>
  );
}

function ProductList({
  orderId,
  products,
  marketplace,
  onImageClick,
}: {
  orderId: string;
  products: OrderListItem["products"];
  marketplace?: OrderMarketplace | null;
  onImageClick: (url: string, alt: string) => void;
}): React.ReactElement {
  const list = products ?? [];
  if (list.length === 0) {
    return <span className="text-[var(--color-text-muted)]">—</span>;
  }
  const max = 3;
  const visible = list.slice(0, max);
  const rest = list.length - visible.length;
  const marketplaceLabel = marketplace ? ORDER_MARKETPLACE_LABELS[marketplace] : null;
  const marketplaceColor = marketplaceLabel ? supplierBadgeColor(marketplaceLabel) : null;
  return (
    <div className="flex flex-col gap-2 w-full">
      {visible.map((p) => (
        <div key={p.itemId} className="flex items-start gap-2">
          <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-white">
            {p.imageUrl ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  onImageClick(p.imageUrl as string, p.name);
                }}
                title="Görseli büyüt"
                aria-label={`${p.name} görselini büyüt`}
                className="block h-full w-full cursor-zoom-in"
              >
                <img
                  src={p.imageUrl}
                  alt={p.name}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </button>
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[10px] font-medium text-[var(--color-text-muted)]">
                {p.name.slice(0, 2).toUpperCase()}
              </div>
            )}
            {p.qty !== 1 ? (
              <span
                aria-label={`Adet ${p.qty}`}
                title={`Adet: ${p.qty}`}
                className="pointer-events-none absolute left-0 top-0 z-10 inline-flex min-w-[20px] items-center justify-center rounded-br-md rounded-tl-lg bg-red-600 px-1 py-0.5 text-[12px] font-extrabold leading-none text-white shadow-md ring-1 ring-white/60"
              >
                {p.qty}
              </span>
            ) : null}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-1.5">
              <CopyIconSquare
                value={p.name}
                title="Ürün adını kopyala"
                successMessage="Ürün adı kopyalandı"
              />
              <Link
                to={`/orders/${orderId}`}
                className="block text-[13px] font-medium leading-snug text-[var(--color-text-primary)] break-words [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:3] overflow-hidden hover:text-[var(--color-brand-blue)] hover:underline transition-colors"
                title={`${p.name} — sipariş detayını aç`}
              >
                {p.name}
              </Link>
            </div>
            {marketplaceLabel && marketplaceColor ? (
              <div className="mt-0.5">
                <span
                  className={`inline-flex items-center rounded-full border px-1.5 py-[1px] text-[10px] font-semibold ${marketplaceColor.bg} ${marketplaceColor.text} ${marketplaceColor.border}`}
                  title={`Satış Kanalı: ${marketplaceLabel}`}
                >
                  {marketplaceLabel}
                </span>
              </div>
            ) : null}
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              {p.qty > 1 ? (
                <span className="text-[11px] font-semibold text-red-600">× {p.qty} adet</span>
              ) : null}
              {/* Tedarikçi adına tıkla → tüm siparişi tek tedarikçiye al (kalem-kalem
                  DEĞİŞTİRİLEMEZ; bir sipariş = tek tedarikçi — kullanıcı kararı 2026-06-29). */}
              {p.supplierName ? (
                <OrderSupplierPicker orderId={orderId} triggerLabel={p.supplierName} />
              ) : null}
            </div>
          </div>
        </div>
      ))}
      {rest > 0 ? (
        <div
          className="text-[11px] font-medium text-[var(--color-text-muted)]"
          title={list.slice(max).map((p) => `${p.name}${p.qty > 1 ? ` × ${p.qty}` : ""}`).join("\n")}
        >
          +{rest} ürün daha
        </div>
      ) : null}
    </div>
  );
}

function statusColor(status: OrderStatus): string {
  switch (status) {
    case "shipped":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "paid":
    case "preparing":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "cancelled":
    case "refunded":
      return "bg-red-50 text-red-700 border-red-200";
    default:
      return "bg-gray-100 text-gray-700 border-gray-200";
  }
}

function statusChipActiveColor(status: OrderStatus | ""): string {
  if (status === "") return "bg-slate-900 text-white border-slate-900";
  switch (status) {
    case "shipped":
      return "bg-emerald-600 text-white border-emerald-600";
    case "paid":
    case "preparing":
      return "bg-amber-600 text-white border-amber-600";
    case "cancelled":
    case "refunded":
      return "bg-red-600 text-white border-red-600";
    default:
      return "bg-slate-800 text-white border-slate-800";
  }
}

interface StatusFilterChipsProps {
  active: OrderStatus | "";
  counts: OrderStatusCounts | null;
  isLoading: boolean;
  isFetching: boolean;
  onSelect: (next: OrderStatus | "") => void;
}

function StatusFilterChips({
  active,
  counts,
  isLoading,
  isFetching,
  onSelect,
}: StatusFilterChipsProps): React.ReactElement {
  const total = counts
    ? ORDER_STATUSES.reduce((acc, s) => acc + (counts[s] ?? 0), 0)
    : null;
  const fmt = (n: number | null) =>
    n === null ? "…" : n.toLocaleString("tr-TR");

  const chips: Array<{ key: OrderStatus | ""; label: string; count: number | null }> = [
    { key: "", label: "Tümü", count: total },
    ...ORDER_STATUSES.map((s) => ({
      key: s,
      label: ORDER_STATUS_LABELS[s],
      count: counts ? counts[s] : null,
    })),
  ];

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-white p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
          Durum filtresi
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${isFetching ? "bg-emerald-500 animate-pulse" : "bg-slate-300"}`}
            aria-hidden="true"
          />
          {isFetching ? "Canlı güncelleniyor" : "Otomatik yenileniyor"}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {chips.map((chip) => {
          const isActive = chip.key === active;
          const base =
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors select-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]";
          const cls = isActive
            ? statusChipActiveColor(chip.key)
            : chip.key === ""
              ? "bg-white text-[var(--color-text)] border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]"
              : `${statusColor(chip.key)} hover:opacity-80`;
          return (
            <button
              key={chip.key || "all"}
              type="button"
              onClick={() => onSelect(chip.key)}
              aria-pressed={isActive}
              className={`${base} ${cls}`}
            >
              <span>{chip.label}</span>
              <span
                className={`inline-flex min-w-[1.5rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${
                  isActive
                    ? "bg-white/25 text-white"
                    : "bg-black/5 text-[var(--color-text)]"
                }`}
              >
                {isLoading && chip.count === null ? "…" : fmt(chip.count)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface InlineStatusProps {
  order: OrderListItem;
  onUpdated: () => void;
}

function InlineStatusBadge({ order, onUpdated }: InlineStatusProps): React.ReactElement {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLUListElement>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number }>({
    top: 0,
    left: 0,
  });

  const mutation = useMutation({
    mutationFn: (nextStatus: OrderStatus) => updateOrder(order.id, { status: nextStatus }),
    onSuccess: () => {
      onUpdated();
      setOpen(false);
    },
    onError: (err) => {
      toast.push("error", err instanceof Error ? err.message : "Durum güncellenemedi");
    },
  });

  useLayoutEffect(() => {
    if (!open) return;
    function updatePosition() {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      const popoverWidth = 180;
      const viewportW = window.innerWidth;
      let left = rect.left;
      if (left + popoverWidth > viewportW - 8) {
        left = Math.max(8, viewportW - popoverWidth - 8);
      }
      const top = rect.bottom + 4;
      setPopoverPos({ top, left });
    }
    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <div className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen((v) => !v);
        }}
        disabled={mutation.isPending}
        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium border cursor-pointer select-none transition-opacity ${statusColor(order.status)} ${mutation.isPending ? "opacity-50" : "hover:opacity-80"}`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {ORDER_STATUS_LABELS[order.status]}
        <svg className="w-2.5 h-2.5 opacity-60" fill="none" viewBox="0 0 10 6">
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open
        ? createPortal(
            <ul
              ref={popoverRef}
              role="listbox"
              style={{
                position: "fixed",
                top: popoverPos.top,
                left: popoverPos.left,
                minWidth: 180,
                zIndex: 1000,
              }}
              className="rounded-xl border border-[var(--color-border)] bg-white shadow-xl py-1 text-sm"
            >
              {[order.status, ...(STATUS_TRANSITIONS[order.status] ?? [])].map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={s === order.status}
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      if (s !== order.status) mutation.mutate(s);
                      else setOpen(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 hover:bg-[var(--color-surface-muted)] transition-colors ${s === order.status ? "font-semibold" : ""}`}
                  >
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border ${statusColor(s)}`}>
                      {ORDER_STATUS_LABELS[s]}
                    </span>
                  </button>
                </li>
              ))}
            </ul>,
            document.body,
          )
        : null}
    </div>
  );
}

interface SupplierMultiSelectProps {
  options: ReadonlyArray<{ value: string; label: string }>;
  isChecked: (id: string) => boolean;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  selectedCount: number;
  totalCount: number;
  allSelected: boolean;
  loading?: boolean;
}

/**
 * Tedarikçi çoklu-seçim filtresi. Varsayılan: tümü seçili ("Tümü" → filtre yok).
 * "Tümünü kapat" → hiçbiri seçili değil (hiçbir sipariş). Tek tedarikçi seçince
 * yalnız o gösterilir; tekrar eklenerek çoğaltılabilir. Hepsi seçili olunca
 * çağıran taraf seçimi "tümü"ye normalize eder (temiz URL + tedarikçisiz
 * siparişler de görünür).
 */
function SupplierMultiSelect({
  options,
  isChecked,
  onToggle,
  onSelectAll,
  onClearAll,
  selectedCount,
  totalCount,
  allSelected,
  loading,
}: SupplierMultiSelectProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (rootRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const noneSelected = !allSelected && selectedCount === 0;
  const summary = allSelected
    ? "Tümü"
    : noneSelected
      ? "Hiçbiri"
      : `${selectedCount} / ${totalCount} tedarikçi`;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-w-[170px] items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]"
      >
        <span
          className={`truncate ${allSelected ? "text-[var(--color-text)]" : "font-medium text-[var(--color-brand-blue)]"}`}
        >
          {summary}
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 20 20"
          fill="none"
          className={`shrink-0 text-[var(--color-text-muted)] transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path
            d="M5 7.5l5 5 5-5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open ? (
        <div className="absolute left-0 z-30 mt-1 w-64 rounded-lg border border-[var(--color-border)] bg-white shadow-lg">
          <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] px-3 py-2">
            <button
              type="button"
              onClick={onSelectAll}
              className="text-[11px] font-medium text-[var(--color-brand-blue)] hover:underline"
            >
              Tümünü seç
            </button>
            <button
              type="button"
              onClick={onClearAll}
              className="text-[11px] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:underline"
            >
              Tümünü kapat
            </button>
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {loading ? (
              <div className="px-3 py-2 text-[12px] text-[var(--color-text-muted)]">
                Yükleniyor…
              </div>
            ) : options.length === 0 ? (
              <div className="px-3 py-2 text-[12px] text-[var(--color-text-muted)]">
                Tedarikçi yok
              </div>
            ) : (
              options.map((opt) => (
                <label
                  key={opt.value}
                  className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-[var(--color-surface-muted)]"
                >
                  <input
                    type="checkbox"
                    checked={isChecked(opt.value)}
                    onChange={() => onToggle(opt.value)}
                    className="h-4 w-4 cursor-pointer rounded border-[var(--color-border)] text-[var(--color-brand-blue)] focus:ring-[var(--color-brand-blue)]"
                  />
                  <span className="truncate">{opt.label}</span>
                </label>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface BayiFilterSelectProps {
  /** Seçili bayi id'si; "" = tüm bayiler (filtre yok). */
  value: string;
  onChange: (id: string) => void;
  /** Auth gate — müşteri listesi ancak giriş yapılınca çekilir. */
  enabled: boolean;
}

/** CustomerListItem'ı görüntülenebilir bir etikete indirger. */
function bayiLabel(c: CustomerListItem): { primary: string; sub: string } {
  const primary = c.name || c.bayiNo || c.email || c.id;
  const sub = [c.bayiNo, c.email].filter(Boolean).join(" · ");
  return { primary, sub };
}

/**
 * Bayiye göre tek-seçim filtresi. Tıklayınca TÜM bayiler açılır; üstteki arama
 * kutusu client-side filtreler (ad / bayi no / e-posta). Arama YALNIZ bizim
 * bayileri (Customer) tarar — bayinin kendi son müşterisini değil. Seçim exact
 * `customerId` olarak siparişler sorgusuna gider (bulanık `q` değil).
 */
function BayiFilterSelect({
  value,
  onChange,
  enabled,
}: BayiFilterSelectProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (rootRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const customersQuery = useQuery({
    queryKey: ["customers", "for-filter"],
    queryFn: () => fetchCustomers({ pageSize: "all" }),
    enabled,
    staleTime: 5 * 60_000,
  });
  const customers: CustomerListItem[] = customersQuery.data?.data ?? [];

  const selected = customers.find((c) => c.id === value) ?? null;
  const summary =
    value === ""
      ? "Tüm bayiler"
      : selected
        ? bayiLabel(selected).primary
        : "Bayi seçili";

  const q = term.trim().toLocaleLowerCase("tr");
  const filtered =
    q.length === 0
      ? customers
      : customers.filter((c) => {
          const hay = `${c.name ?? ""} ${c.bayiNo ?? ""} ${c.email ?? ""}`.toLocaleLowerCase(
            "tr",
          );
          return hay.includes(q);
        });

  const pick = (id: string): void => {
    onChange(id);
    setOpen(false);
    setTerm("");
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-w-[180px] items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]"
      >
        <span
          className={`truncate ${value === "" ? "text-[var(--color-text)]" : "font-medium text-[var(--color-brand-blue)]"}`}
        >
          {summary}
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 20 20"
          fill="none"
          className={`shrink-0 text-[var(--color-text-muted)] transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path
            d="M5 7.5l5 5 5-5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open ? (
        <div className="absolute left-0 z-30 mt-1 w-72 rounded-lg border border-[var(--color-border)] bg-white shadow-lg">
          <div className="border-b border-[var(--color-border)] p-2">
            <input
              type="text"
              autoFocus
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Bayi ara (ad / bayi no / e-posta)…"
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]"
            />
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            <button
              type="button"
              onClick={() => pick("")}
              className={`flex w-full items-center px-3 py-1.5 text-left text-sm hover:bg-[var(--color-surface-muted)] ${value === "" ? "font-medium text-[var(--color-brand-blue)]" : ""}`}
            >
              Tüm bayiler
            </button>
            {customersQuery.isLoading ? (
              <div className="px-3 py-2 text-[12px] text-[var(--color-text-muted)]">
                Yükleniyor…
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-2 text-[12px] text-[var(--color-text-muted)]">
                Sonuç yok
              </div>
            ) : (
              filtered.map((c) => {
                const { primary, sub } = bayiLabel(c);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => pick(c.id)}
                    className={`flex w-full flex-col items-start px-3 py-1.5 text-left text-sm hover:bg-[var(--color-surface-muted)] ${c.id === value ? "bg-[var(--color-surface-muted)]" : ""}`}
                  >
                    <span className="truncate font-medium text-[var(--color-text)]">
                      {primary}
                    </span>
                    {sub ? (
                      <span className="truncate text-[11px] text-[var(--color-text-muted)]">
                        {sub}
                      </span>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface BulkUpdateModalProps {
  selectedIds: Set<string>;
  filters: OrderFilters;
  filteredTotal: number;
  suppliers: Supplier[];
  onClose: () => void;
  onDone: (result: BulkUpdateResult) => void;
}

function BulkUpdateModal({
  selectedIds,
  filters,
  filteredTotal,
  suppliers,
  onClose,
  onDone,
}: BulkUpdateModalProps): React.ReactElement {
  const toast = useToast();
  const hasSelection = selectedIds.size > 0;
  const [mode, setMode] = useState<BulkUpdateMode>(hasSelection ? "selected" : "filtered");
  const [toStatus, setToStatus] = useState<OrderStatus>("preparing");
  const [fromStatus, setFromStatus] = useState<OrderStatus>("paid");
  const [notify, setNotify] = useState<boolean>(true);
  const [notes, setNotes] = useState<string>("");
  // Modal içinde ayrıca seçilebilen tedarikçi — boş string "Tüm tedarikçiler".
  // `selected` modunda anlamsız (zaten ID listesi geçiyoruz) — UI'da disable edilir.
  // `filtered`/`transition` modunda admin sayfa filtresine ek olarak burada
  // override edilebilir.
  // Sayfa filtresinde tam olarak bir tedarikçi seçiliyse modal picker'ı onunla
  // ön-doldur; çoklu/tümü/hiçbiri durumunda boş ("Tüm tedarikçiler").
  const [supplierId, setSupplierId] = useState<string>(
    filters.supplierIds && filters.supplierIds.length === 1
      ? filters.supplierIds[0]
      : "",
  );

  const effectiveCount = useMemo(() => {
    if (mode === "selected") return selectedIds.size;
    if (mode === "filtered") return filteredTotal;
    return Math.min(filteredTotal, BULK_UPDATE_MAX);
  }, [mode, selectedIds.size, filteredTotal]);

  // Hedef statü seçenekleri: transition modunda yalnız kaynak statünün izinli
  // geçişleri; selected/filtered modunda (kaynaklar heterojen olabilir)
  // 'paid' hariç tüm statüler. Hiçbir durumda 'paid' hedef sunulmaz (#6).
  const targetOptions = useMemo<readonly OrderStatus[]>(() => {
    if (mode === "transition") return STATUS_TRANSITIONS[fromStatus];
    return BULK_TARGET_STATUSES;
  }, [mode, fromStatus]);

  // Seçenek listesi değiştiğinde geçerli olmayan toStatus'u ilk geçerli
  // değere çek — örn. transition kaynağı 'shipped' seçilince yalnız 'refunded'
  // kalır, 'preparing' otomatik düşürülür.
  useEffect(() => {
    if (targetOptions.length > 0 && !targetOptions.includes(toStatus)) {
      setToStatus(targetOptions[0]);
    }
  }, [targetOptions, toStatus]);

  const exceedsLimit = effectiveCount > BULK_UPDATE_MAX;
  const canSubmit =
    !exceedsLimit &&
    effectiveCount > 0 &&
    targetOptions.includes(toStatus) &&
    (mode !== "selected" || selectedIds.size > 0) &&
    (mode !== "transition" || fromStatus !== toStatus);

  const mutation = useMutation({
    mutationFn: (): Promise<BulkUpdateResult> => {
      const trimmedNotes = notes.trim();
      const payload: BulkUpdateOrdersInput = {
        mode,
        toStatus,
        notify,
      };
      if (trimmedNotes) payload.notes = trimmedNotes;

      if (mode === "selected") {
        payload.orderIds = Array.from(selectedIds);
      } else {
        // filtered / transition: mevcut admin filtrelerini düz alanlar olarak geçir.
        // Tedarikçi modal içinde override edilebilir; boş ise "tüm tedarikçiler".
        if (mode === "transition") payload.fromStatus = fromStatus;
        if (mode === "filtered" && filters.status) payload.status = filters.status;
        // Tedarikçi kapsamı: modal içi override (tekil) varsa onu; yoksa sayfa
        // filtresinin çoklu seçimini (boş dizi = hiçbiri) aynen aktar.
        if (supplierId) payload.supplierId = supplierId;
        else if (filters.supplierIds !== undefined)
          payload.supplierIds = filters.supplierIds;
        if (filters.from) payload.dateFrom = filters.from;
        if (filters.to) payload.dateTo = filters.to;
        if (filters.customer) payload.q = filters.customer;
      }
      return bulkUpdateOrders(payload);
    },
    onSuccess: (result) => {
      const okN = result.succeeded.length;
      const failN = result.failed.length;
      if (failN === 0) {
        toast.push("success", `${okN} sipariş güncellendi`);
      } else if (okN === 0) {
        toast.push("error", `Hiçbiri güncellenemedi (${failN} hata)`);
      } else {
        toast.push("info", `${okN} güncellendi, ${failN} başarısız`);
      }
      onDone(result);
    },
    onError: (err) => {
      toast.push("error", err instanceof Error ? err.message : "Toplu güncelleme başarısız");
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-[var(--color-border)] bg-white p-6 shadow-xl">
        <h3 className="text-base font-semibold text-[var(--color-text)]">Toplu durum güncelle</h3>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          Maksimum {BULK_UPDATE_MAX} sipariş aynı anda güncellenebilir.
        </p>

        {/* Mode */}
        <div className="mt-4 space-y-2">
          <span className="block text-xs font-medium text-[var(--color-text-muted)]">Kapsam</span>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <label
              className={`flex cursor-pointer flex-col rounded-lg border px-3 py-2 text-xs transition-colors ${mode === "selected" ? "border-[var(--color-brand-blue)] bg-blue-50" : "border-[var(--color-border)] bg-white hover:bg-[var(--color-surface-muted)]"} ${!hasSelection ? "opacity-50" : ""}`}
            >
              <input
                type="radio"
                name="bulk-mode"
                value="selected"
                checked={mode === "selected"}
                disabled={!hasSelection}
                onChange={() => setMode("selected")}
                className="sr-only"
              />
              <span className="font-medium text-[var(--color-text)]">Seçili olanlar</span>
              <span className="mt-0.5 text-[var(--color-text-muted)]">{selectedIds.size} sipariş</span>
            </label>
            <label
              className={`flex cursor-pointer flex-col rounded-lg border px-3 py-2 text-xs transition-colors ${mode === "filtered" ? "border-[var(--color-brand-blue)] bg-blue-50" : "border-[var(--color-border)] bg-white hover:bg-[var(--color-surface-muted)]"}`}
            >
              <input
                type="radio"
                name="bulk-mode"
                value="filtered"
                checked={mode === "filtered"}
                onChange={() => setMode("filtered")}
                className="sr-only"
              />
              <span className="font-medium text-[var(--color-text)]">Filtrelenmiş tümü</span>
              <span className="mt-0.5 text-[var(--color-text-muted)]">{filteredTotal} sipariş</span>
            </label>
            <label
              className={`flex cursor-pointer flex-col rounded-lg border px-3 py-2 text-xs transition-colors ${mode === "transition" ? "border-[var(--color-brand-blue)] bg-blue-50" : "border-[var(--color-border)] bg-white hover:bg-[var(--color-surface-muted)]"}`}
            >
              <input
                type="radio"
                name="bulk-mode"
                value="transition"
                checked={mode === "transition"}
                onChange={() => setMode("transition")}
                className="sr-only"
              />
              <span className="font-medium text-[var(--color-text)]">Statü geçişi</span>
              <span className="mt-0.5 text-[var(--color-text-muted)]">A → B toplu</span>
            </label>
          </div>
        </div>

        {/* Status selects */}
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {mode === "transition" ? (
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
                Kaynak durum (yalnızca bu)
              </label>
              <select
                value={fromStatus}
                onChange={(e) => setFromStatus(e.target.value as OrderStatus)}
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]"
              >
                {ORDER_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {ORDER_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
              Hedef durum
            </label>
            <select
              value={toStatus}
              onChange={(e) => setToStatus(e.target.value as OrderStatus)}
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]"
            >
              {targetOptions.map((s) => (
                <option key={s} value={s}>
                  {ORDER_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
            {mode === "transition" && targetOptions.length === 0 ? (
              <p className="mt-1 text-[11px] text-amber-700">
                {ORDER_STATUS_LABELS[fromStatus]} durumu terminaldir — bu
                statüden başka bir statüye geçiş yapılamaz.
              </p>
            ) : null}
          </div>
        </div>

        {/* Supplier filter — selected modunda anlamsız (zaten ID listesi gidiyor) */}
        <div className="mt-4">
          <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
            Tedarikçi
          </label>
          <select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            disabled={mode === "selected"}
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <option value="">Tüm tedarikçiler</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {mode === "selected" ? (
            <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
              Seçili olanlar modunda zaten seçilen siparişler güncellenir.
            </p>
          ) : null}
        </div>

        {/* Notes */}
        <div className="mt-4">
          <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
            Not (opsiyonel)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Tüm güncellenen siparişlerin notuna eklenir"
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]"
          />
        </div>

        {/* Notify */}
        <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={notify}
            onChange={(e) => setNotify(e.target.checked)}
            className="h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-brand-blue)] focus:ring-[var(--color-brand-blue)]"
          />
          <span>Müşterilere durum değişikliği e-postası gönder</span>
        </label>

        {/* Warning */}
        {exceedsLimit ? (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {effectiveCount} sipariş seçildi — sınır {BULK_UPDATE_MAX}. Lütfen filtreyi daraltın ya da
            seçimi azaltın.
          </div>
        ) : null}

        {/* Footer */}
        <div className="mt-6 flex items-center justify-between gap-3">
          <span className="text-xs text-[var(--color-text-muted)]">
            Etkilenecek: <strong>{effectiveCount}</strong> sipariş
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={mutation.isPending}
              className="rounded-lg border border-[var(--color-border)] bg-white px-4 py-2 text-sm hover:bg-[var(--color-surface-muted)] disabled:opacity-50 transition-colors"
            >
              İptal
            </button>
            <button
              type="button"
              onClick={() => mutation.mutate()}
              disabled={!canSubmit || mutation.isPending}
              className="rounded-lg bg-[var(--color-brand-blue)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {mutation.isPending ? "Güncelleniyor…" : "Güncelle"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }): React.ReactElement {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-white px-5 py-4">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-[var(--color-text)]">{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{sub}</p> : null}
    </div>
  );
}

/**
 * Stat bar'ın altında ince bir "günün nabzı" şeridi: bugünün siparişi/cirosu,
 * dün ile karşılaştırma trendi ve filtreye uyanlar arasında en çok sipariş
 * veren müşteri. Görsel olarak fazla yer tutmayacak şekilde tek satır halinde
 * pill-divider düzeniyle çizilir.
 */
function DailyPulseStrip({ stats }: { stats: OrdersStats }): React.ReactElement {
  const today = stats.today;
  const yesterday = stats.yesterday;
  const countDelta = today.count - yesterday.count;
  const revenueDelta = today.revenue - yesterday.revenue;
  const revenuePct =
    yesterday.revenue > 0
      ? (revenueDelta / yesterday.revenue) * 100
      : today.revenue > 0
        ? 100
        : 0;
  const top = stats.topCustomer;

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface-muted)]/50 px-4 py-2 text-xs">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-brand-blue)]" />
        <span className="text-[var(--color-text-muted)]">Bugün</span>
        <span className="font-semibold text-[var(--color-text)] tabular-nums">
          {today.count.toLocaleString("tr-TR")}
        </span>
        <span className="text-[var(--color-text-muted)]">sipariş ·</span>
        <span className="font-semibold text-[var(--color-text)] tabular-nums">
          {formatTRY(today.revenue)}
        </span>
      </span>

      <TrendChip
        label="Dün cirosu"
        delta={revenueDelta}
        percent={revenuePct}
        valueLabel={formatTRY(yesterday.revenue)}
      />

      <span className="inline-flex items-center gap-1 text-[var(--color-text-muted)]">
        <span>Dün siparişi:</span>
        <span className="font-medium tabular-nums text-[var(--color-text)]">
          {yesterday.count.toLocaleString("tr-TR")}
        </span>
        {countDelta !== 0 ? (
          <span
            className={
              countDelta > 0
                ? "tabular-nums text-emerald-600"
                : "tabular-nums text-rose-600"
            }
          >
            ({countDelta > 0 ? "+" : ""}
            {countDelta})
          </span>
        ) : null}
      </span>

      {top ? (
        <span className="inline-flex items-center gap-1.5 text-[var(--color-text-muted)]">
          <span>En çok sipariş:</span>
          <span
            className="max-w-[180px] truncate font-medium text-[var(--color-text)]"
            title={top.name}
          >
            {top.name}
          </span>
          <span className="tabular-nums">
            ({top.orderCount.toLocaleString("tr-TR")} · {formatTRY(top.revenue)})
          </span>
        </span>
      ) : null}
    </div>
  );
}

function TrendChip({
  label,
  delta,
  percent,
  valueLabel,
}: {
  label: string;
  delta: number;
  percent: number;
  valueLabel: string;
}): React.ReactElement {
  const isUp = delta > 0;
  const isDown = delta < 0;
  const arrow = isUp ? "▲" : isDown ? "▼" : "·";
  const color = isUp
    ? "text-emerald-600"
    : isDown
      ? "text-rose-600"
      : "text-[var(--color-text-muted)]";
  const pctText = `${Math.abs(percent).toFixed(0)}%`;
  return (
    <span className="inline-flex items-center gap-1.5 text-[var(--color-text-muted)]">
      <span>{label}:</span>
      <span className="font-medium tabular-nums text-[var(--color-text)]">{valueLabel}</span>
      <span className={`inline-flex items-center gap-0.5 font-medium tabular-nums ${color}`}>
        <span>{arrow}</span>
        <span>{pctText}</span>
      </span>
    </span>
  );
}

function renderSupplierCell(o: OrderListItem): React.ReactNode {
  const names = o.supplierNames ?? [];
  const supplierLabel: React.ReactNode =
    names.length === 0 ? (
      <span className="text-[var(--color-text-muted)]">—</span>
    ) : names.length === 1 ? (
      <span>{names[0]}</span>
    ) : names.length <= 3 ? (
      <span>{names.join(", ")}</span>
    ) : (
      <span title={names.join(", ")}>Birden fazla ({names.length})</span>
    );

  return (
    <div className="flex flex-col gap-1">
      <InlineOrderSupplierOrderNo orderId={o.id} value={o.supplierOrderNo ?? null} />
      {supplierLabel}
      {o.manualPurchasePending ? (
        <span
          className="inline-flex w-fit items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700"
          title="Bu sipariş için tedarikçiden alım yapılması bekleniyor."
        >
          🛒 Manuel alım bekliyor
        </span>
      ) : null}
    </div>
  );
}

/**
 * Sipariş listesindeki tıklanabilir sözde-durum çipi.
 * Sayı 0 olsa da görünür kalır — patron "hiç yok" bilgisini de
 * görsün diye; aktifken renkli dolgu alır.
 */
function SpecialFilterChip({
  label,
  title,
  count,
  active,
  loading,
  tone,
  onClick,
}: {
  label: string;
  title: string;
  count: number;
  active: boolean;
  loading: boolean;
  tone: "amber" | "rose";
  onClick: () => void;
}): React.ReactElement {
  const palette =
    tone === "amber"
      ? {
          active: "border-amber-500 bg-amber-500 text-white",
          idle: "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100",
          badge: active ? "bg-white/25 text-white" : "bg-amber-200/70 text-amber-900",
        }
      : {
          active: "border-rose-500 bg-rose-500 text-white",
          idle: "border-rose-300 bg-rose-50 text-rose-800 hover:bg-rose-100",
          badge: active ? "bg-white/25 text-white" : "bg-rose-200/70 text-rose-900",
        };
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={
        "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition " +
        (active ? palette.active : palette.idle)
      }
    >
      {label}
      <span
        className={
          "inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none " +
          palette.badge
        }
      >
        {loading ? "…" : count > 99 ? "99+" : count}
      </span>
    </button>
  );
}

function renderCargoCell(o: OrderListItem): React.ReactNode {
  const company = o.cargoCompany;
  const barcode = o.cargoBarcode ?? o.trackingNumber;
  if (!company && !barcode) return <span className="text-[var(--color-text-muted)]">—</span>;

  const lower = company ? String(company).toLowerCase() : "";
  const label = company
    ? (CARGO_COMPANY_LABELS[lower.toUpperCase() as CargoCompany] ?? company)
    : null;

  return (
    <CopyableText
      value={barcode}
      title="Kargo barkodunu kopyala"
      className="block -m-1 space-y-0.5 p-1"
    >
      {label ? <div className="text-xs font-medium">{label}</div> : null}
      {barcode ? (
        <div className="flex items-center gap-1">
          <span className="font-mono text-[11px] text-[var(--color-text-muted)]">{barcode}</span>
          <CopyButton value={barcode} title="Kargo barkodunu kopyala" />
        </div>
      ) : null}
    </CopyableText>
  );
}

export default function OrdersPage(): React.ReactElement | null {
  useDocumentTitle("Siparişler");
  const authed = useRequireAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showExport, setShowExport] = useState<boolean>(false);
  // Sipariş dökümü Excel'i maliyet/kâr içerir — yalnızca OWNER dışa aktarabilir.
  // Backend de @Roles('OWNER') ile zorlar; bu yalnızca butonu gizleyen UX katmanı.
  const isOwner = getCurrentPermissions().role === "OWNER";
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkModal, setShowBulkModal] = useState<boolean>(false);
  const [lightboxImage, setLightboxImage] = useState<LightboxImage | null>(null);
  // Tamamı popup'ta gösterilen sipariş notu (liste şeridinde 2 satıra kırpılır).
  const [openNote, setOpenNote] = useState<OrderNote | null>(null);
  // Hangi siparişin PDF'i şu an indiriliyor (satır ikonunda spinner için).
  const [pdfLoadingId, setPdfLoadingId] = useState<string | null>(null);
  const { widths: colWidths, startResize, resetWidths } = useColumnWidths();

  // PDF kolonu: detaya girmeden satırdaki ikona basınca siparişin PDF'ini
  // doğrudan indirir. Liste sorgusu imzalı URL üretmediği için tıklamada
  // fetchOrder() ile taze 1 saatlik URL alınır; blob'a çekip indiririz,
  // CORS engellerse imzalı URL yeni sekmede açılır (fallback).
  const handleDownloadPdf = async (orderId: string, orderNo: string) => {
    if (pdfLoadingId) return;
    setPdfLoadingId(orderId);
    try {
      const detail = await fetchOrder(orderId);
      const url = detail.pdfUrl;
      if (!url) {
        toast.push("error", "Bu siparişin PDF'i bulunamadı");
        return;
      }
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`pdf fetch ${res.status}`);
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = `siparis-${orderNo || orderId}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(objectUrl);
      } catch {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    } catch (err) {
      toast.push("error", err instanceof Error ? err.message : "PDF indirilemedi");
    } finally {
      setPdfLoadingId(null);
    }
  };

  const [page, setPage] = useState<number>(
    Math.max(1, Number(searchParams.get("page") ?? "1") || 1),
  );
  const [pageSize, setPageSize] = useState<PageSizeOption>(() =>
    parsePageSize(searchParams.get("pageSize")),
  );
  const [status, setStatus] = useState<OrderStatus | "">(
    (searchParams.get("status") as OrderStatus | null) ?? "",
  );
  // Sözde-durum filtresi ("Manuel bekliyor" çipi).
  // Gerçek OrderStatus'tan bağımsız; ikisi birlikte de kullanılabilir.
  const [special, setSpecial] = useState<OrderSpecialFilter | "">(
    (searchParams.get("special") as OrderSpecialFilter | null) ?? "",
  );
  const [customerInput, setCustomerInput] = useState<string>(
    searchParams.get("customer") ?? "",
  );
  // Debounce'u inline tutuyoruz (eski: useDebounce). Sebep: header'daki global
  // sipariş aramasından gelen DIŞ URL değişikliklerinde (aşağıdaki reverse-sync)
  // debounce'lı değeri de ANINDA güncellememiz gerekiyor. Aksi halde 300ms'lik
  // pencerede forward-sync eski değeri URL'e geri yazıp yeni aramayı eziyordu.
  const [debouncedCustomer, setDebouncedCustomer] = useState<string>(customerInput);
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedCustomer(customerInput), 300);
    return () => clearTimeout(handle);
  }, [customerInput]);
  const [from, setFrom] = useState<string>(searchParams.get("from") ?? "");
  const [to, setTo] = useState<string>(searchParams.get("to") ?? "");
  // Satış kanalı filtresi (tek seçim). "" = tümü.
  const [marketplace, setMarketplace] = useState<string>(
    searchParams.get("marketplace") ?? "",
  );
  // Bayi filtresi (tek seçim, exact Customer.id). "" = tüm bayiler.
  const [customerId, setCustomerId] = useState<string>(
    searchParams.get("customerId") ?? "",
  );
  // Çoklu tedarikçi seçimi. null = "tümü" (filtre yok); Set = açıkça seçilmiş
  // alt küme (boş Set = "hiçbiri"). URL'den okunur: ?supplierIds=a,b (boş =
  // hiçbiri) veya legacy ?supplierId=a (tek tedarikçi).
  const [supplierSel, setSupplierSel] = useState<Set<string> | null>(() => {
    const multi = searchParams.get("supplierIds");
    if (multi !== null) {
      return new Set(multi.split(",").map((s) => s.trim()).filter(Boolean));
    }
    const single = searchParams.get("supplierId");
    return single ? new Set([single]) : null;
  });
  // Kararlı imza — effect bağımlılıkları ve URL karşılaştırması için.
  const supplierSelKey = useMemo(
    () =>
      supplierSel === null
        ? "__all__"
        : Array.from(supplierSel).sort().join(","),
    [supplierSel],
  );
  // API filtresi: null → undefined (filtre yok); Set → dizi (boş dizi =
  // "hiçbiri" → hiçbir sipariş).
  const supplierIdsFilter = useMemo<string[] | undefined>(
    // Sıralı → aynı seçim daima aynı react-query anahtarına düşer.
    () => (supplierSel === null ? undefined : Array.from(supplierSel).sort()),
    [supplierSel],
  );

  useEffect(() => {
    const next = new URLSearchParams();
    if (page > 1) next.set("page", String(page));
    if (pageSize !== DEFAULT_PAGE_SIZE) next.set("pageSize", String(pageSize));
    if (status) next.set("status", status);
    if (debouncedCustomer.trim()) next.set("customer", debouncedCustomer.trim());
    if (from) next.set("from", from);
    if (to) next.set("to", to);
    if (marketplace) next.set("marketplace", marketplace);
    if (customerId) next.set("customerId", customerId);
    // Çoklu seçim: yalnız "tümü" DIŞINDA URL'e yaz. Boş Set → "supplierIds="
    // (hiçbiri) olarak round-trip eder. supplierSelKey sıralı kanonik formdur.
    if (supplierSelKey !== "__all__") {
      next.set("supplierIds", supplierSelKey);
    }
    if (special) next.set("special", special);
    setSearchParams(next, { replace: true });
  }, [page, pageSize, status, special, debouncedCustomer, from, to, marketplace, customerId, supplierSelKey, setSearchParams]);

  // Reverse-sync: URL → state. Header'daki global sipariş arama (AdminShell),
  // bu sayfa ZATEN mount'luyken navigate('/orders?customer=…') ile gelir; route'ta
  // `key` olmadığı için bileşen yeniden mount OLMAZ, dolayısıyla yukarıdaki
  // mount-time init'ler tekrar çalışmaz ve ilk aramadan sonraki aramalar
  // uygulanmazdı. Bu yüzden URL dışarıdan değiştiğinde filtre state'ini elle
  // yeniden kuruyoruz. Yalnızca GERÇEKTEN farklı olan değerleri set ediyoruz;
  // böylece forward-sync'in kendi yazdığı URL'ler ile karşılaştırma no-op olur
  // (ping-pong / sonsuz döngü yok) ve sayfa içi yazma sırasında debounce
  // penceresinde input ezilmez (searchParams o sırada değişmediği için bu effect
  // tetiklenmez). Bağımlılık SADECE [searchParams] olmalı — state'i de eklemek
  // yazma anında URL henüz güncellenmemişken input'u eski değere geri ezerdi.
  useEffect(() => {
    const urlCustomer = searchParams.get("customer") ?? "";
    const urlStatus = (searchParams.get("status") as OrderStatus | null) ?? "";
    const urlFrom = searchParams.get("from") ?? "";
    const urlTo = searchParams.get("to") ?? "";
    const urlMarketplace = searchParams.get("marketplace") ?? "";
    const urlCustomerId = searchParams.get("customerId") ?? "";
    const urlMulti = searchParams.get("supplierIds");
    const urlSel: Set<string> | null =
      urlMulti !== null
        ? new Set(urlMulti.split(",").map((s) => s.trim()).filter(Boolean))
        : (() => {
            const single = searchParams.get("supplierId");
            return single ? new Set([single]) : null;
          })();
    const urlSelKey =
      urlSel === null ? "__all__" : Array.from(urlSel).sort().join(",");
    const urlPage = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
    const urlPageSize = parsePageSize(searchParams.get("pageSize"));
    if (urlCustomer !== customerInput) {
      setCustomerInput(urlCustomer);
      setDebouncedCustomer(urlCustomer); // dış değer nihai — 300ms gecikmeyi atla
    }
    if (urlStatus !== status) setStatus(urlStatus);
    if (urlFrom !== from) setFrom(urlFrom);
    if (urlTo !== to) setTo(urlTo);
    if (urlMarketplace !== marketplace) setMarketplace(urlMarketplace);
    if (urlCustomerId !== customerId) setCustomerId(urlCustomerId);
    if (urlSelKey !== supplierSelKey) setSupplierSel(urlSel);
    if (urlPage !== page) setPage(urlPage);
    if (urlPageSize !== pageSize) setPageSize(urlPageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const filtersFirstRenderRef = useRef(true);
  useEffect(() => {
    // Skip the first render so a deep-link like ?page=5 — or returning to
    // /orders?page=5 from a detail page — is not clobbered by a reset to 1.
    if (filtersFirstRenderRef.current) {
      filtersFirstRenderRef.current = false;
      return;
    }
    setPage(1);
    setSelectedIds(new Set());
  }, [status, special, debouncedCustomer, from, to, marketplace, customerId, supplierSelKey]);

  // Sayfa boyutu değişince ilk sayfaya dön ve seçimi temizle; aksi halde yüksek
  // bir `page` değeri yeni boyutta boş sayfaya düşebilir (Müşteriler ile aynı).
  const handlePageSizeChange = (next: PageSizeOption): void => {
    setPageSize(next);
    setPage(1);
    setSelectedIds(new Set());
  };

  const filters: OrderFilters = useMemo(
    () => ({
      page,
      pageSize,
      status: status || undefined,
      customer: debouncedCustomer.trim() || undefined,
      customerId: customerId || undefined,
      marketplace: marketplace || undefined,
      from: from || undefined,
      to: to || undefined,
      supplierIds: supplierIdsFilter,
      special: special || undefined,
    }),
    [page, pageSize, status, special, debouncedCustomer, customerId, marketplace, from, to, supplierIdsFilter],
  );

  const ordersQuery = useQuery<OrdersResponse>({
    queryKey: ["orders", filters],
    queryFn: () => fetchOrders(filters),
    enabled: authed,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  const statusCountsFilters = useMemo(
    () => ({
      customer: debouncedCustomer.trim() || undefined,
      customerId: customerId || undefined,
      marketplace: marketplace || undefined,
      from: from || undefined,
      to: to || undefined,
      supplierIds: supplierIdsFilter,
    }),
    [debouncedCustomer, customerId, marketplace, from, to, supplierIdsFilter],
  );

  const statusCountsQuery = useQuery<OrderStatusCounts>({
    queryKey: ["orders", "status-counts", statusCountsFilters],
    queryFn: () => fetchOrderStatusCounts(statusCountsFilters),
    enabled: authed,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    staleTime: 5_000,
  });

  // Sözde-durum sayacı: "Manuel bekliyor" çipi. Aynı ekran filtrelerini
  // (bayi/tarih/tedarikçi/pazaryeri) kullanır ki çipteki sayı, tıklanınca
  // gelen liste ile birebir tutsun.
  const manualPendingCountQuery = useQuery({
    queryKey: ["orders", "special-count", "manual_pending", statusCountsFilters],
    queryFn: () => countOrdersBySpecial("manual_pending", statusCountsFilters),
    enabled: authed,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    staleTime: 5_000,
  });

  // Tedarikçi listesi 'suppliers' sayfa iznine bağlı — yalnız Siparişler izni
  // olan çalışanda bu uç 403 döner; sorguyu hiç atmayıp filtreyi gizliyoruz
  // (aksi halde her yüklemede sessiz 403 + boş filtre).
  const canSeeSuppliers = canAccess("suppliers");
  // Bayi filtresi GET /admin/customers'ı tarar — o uç 'customers' iznine bağlı.
  // İzinsiz çalışanda filtreyi hiç çizmiyoruz (aksi halde boş açılır liste + 403).
  const canSeeCustomers = canAccess("customers");
  const suppliersQuery = useQuery({
    queryKey: ["suppliers", "for-filter"],
    queryFn: () => fetchSuppliers({ pageSize: 100 }),
    enabled: authed && canSeeSuppliers,
    staleTime: 5 * 60_000,
  });
  const supplierList: Supplier[] = suppliersQuery.data?.data ?? [];
  const supplierOptions = useMemo(
    () => supplierList.map((s) => ({ value: s.id, label: s.name })),
    [supplierList],
  );

  // Tedarikçi çoklu-seçim türevleri.
  const totalSuppliers = supplierOptions.length;
  const selectedSupplierCount =
    supplierSel === null ? totalSuppliers : supplierSel.size;
  const allSuppliersSelected =
    supplierSel === null ||
    (totalSuppliers > 0 && supplierSel.size === totalSuppliers);
  // Filtre "aktif" = tümü gösterilmiyor (alt küme ya da hiçbiri).
  const supplierFilterActive = !allSuppliersSelected;
  const isSupplierChecked = (id: string): boolean =>
    supplierSel === null ? true : supplierSel.has(id);
  const toggleSupplier = (id: string): void => {
    setSupplierSel((prev) => {
      const base = prev === null ? new Set(supplierOptions.map((o) => o.value)) : new Set(prev);
      if (base.has(id)) base.delete(id);
      else base.add(id);
      // Hepsi seçili hale geldiyse "tümü"ye (null) normalize et → temiz URL +
      // tedarikçisiz (manuel/depo) siparişler de görünür.
      if (totalSuppliers > 0 && base.size === totalSuppliers) return null;
      return base;
    });
  };
  const selectAllSuppliers = (): void => setSupplierSel(null);
  const clearAllSuppliers = (): void => setSupplierSel(new Set());

  // "Tümü"ye normalizasyon güvenlik ağı: deep-link (?supplierIds=a,b,… tüm
  // tedarikçileri sayar) ya da tüm kutuların elle işaretlendiği durumda Set tüm
  // bilinen tedarikçileri kapsıyorsa null'a indir. Aksi halde UI "Tümü" gösterir
  // ama supplierIdsFilter hâlâ dolu dizi gönderip tedarikçisiz (manuel/depo/
  // pazaryeri) siparişleri sessizce gizlerdi. Tedarikçiler yüklendikten sonra
  // (totalSuppliers > 0) çalışır.
  useEffect(() => {
    if (
      supplierSel !== null &&
      totalSuppliers > 0 &&
      supplierOptions.every((o) => supplierSel.has(o.value))
    ) {
      setSupplierSel(null);
    }
  }, [supplierSel, totalSuppliers, supplierOptions]);

  const data = ordersQuery.data;
  const orders = data?.data ?? [];
  const meta = data?.meta;
  const stats = data?.stats ?? null;

  const activeFilters =
    [status, debouncedCustomer.trim(), from, to, marketplace, customerId].filter(
      Boolean,
    ).length + (supplierFilterActive ? 1 : 0);

  // Status geçiş animasyonu: önceki durumları takip et, değişen satırlara
  // 2sn yeşil ince çizgi animasyonu ekle. İlk render baseline kabul edilir
  // (animasyon yalnızca gerçek transition'lar için tetiklenir).
  const prevStatusMapRef = useRef<Map<string, OrderStatus> | null>(null);
  const [recentlyChangedIds, setRecentlyChangedIds] = useState<Set<string>>(
    () => new Set(),
  );

  useEffect(() => {
    if (orders.length === 0) return;
    if (prevStatusMapRef.current === null) {
      // İlk veri — baseline kaydet, animasyon tetikleme.
      prevStatusMapRef.current = new Map(orders.map((o) => [o.id, o.status]));
      return;
    }
    const prev = prevStatusMapRef.current;
    const changed: string[] = [];
    const nextMap = new Map<string, OrderStatus>();
    for (const o of orders) {
      nextMap.set(o.id, o.status);
      const previousStatus = prev.get(o.id);
      if (previousStatus !== undefined && previousStatus !== o.status) {
        changed.push(o.id);
      }
    }
    prevStatusMapRef.current = nextMap;
    if (changed.length === 0) return;
    setRecentlyChangedIds((current) => {
      const next = new Set(current);
      for (const id of changed) next.add(id);
      return next;
    });
    const timer = window.setTimeout(() => {
      setRecentlyChangedIds((current) => {
        if (current.size === 0) return current;
        const next = new Set(current);
        for (const id of changed) next.delete(id);
        return next;
      });
    }, 2100);
    return () => window.clearTimeout(timer);
  }, [orders]);

  return (
    <div className="space-y-6">
      <style>{`
        @keyframes orderRowStatusChange {
          0% {
            box-shadow: inset 0 0 0 0 rgba(16, 185, 129, 0);
            background-color: rgba(16, 185, 129, 0);
          }
          15% {
            box-shadow: inset 0 0 0 2px rgba(16, 185, 129, 1);
            background-color: rgba(16, 185, 129, 0.06);
          }
          85% {
            box-shadow: inset 0 0 0 2px rgba(16, 185, 129, 1);
            background-color: rgba(16, 185, 129, 0.06);
          }
          100% {
            box-shadow: inset 0 0 0 0 rgba(16, 185, 129, 0);
            background-color: rgba(16, 185, 129, 0);
          }
        }
        .order-row-just-changed > td {
          animation: orderRowStatusChange 2000ms ease-in-out 1;
        }
        .order-row-just-changed > td:first-child {
          box-shadow: inset 2px 0 0 0 rgba(16, 185, 129, 0);
        }
        .order-row-just-changed > td:last-child {
          box-shadow: inset -2px 0 0 0 rgba(16, 185, 129, 0);
        }
        @media (prefers-reduced-motion: reduce) {
          .order-row-just-changed > td {
            animation: none;
            background-color: rgba(16, 185, 129, 0.08);
          }
        }
      `}</style>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--color-text)]">Siparişler</h1>
          <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">
            {meta ? `${meta.total.toLocaleString("tr-TR")} sipariş` : "Yükleniyor…"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowBulkModal(true)}
            className="rounded-lg border border-[var(--color-brand-blue)] bg-[var(--color-brand-blue)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 transition-opacity"
          >
            Toplu Güncelle
            {selectedIds.size > 0 ? (
              <span className="ml-1.5 rounded-full bg-white/25 px-1.5 py-0.5 text-[10px]">
                {selectedIds.size}
              </span>
            ) : null}
          </button>
          {isOwner ? (
            <button
              type="button"
              onClick={() => setShowExport(true)}
              className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-1.5 text-sm hover:bg-[var(--color-surface-muted)] transition-colors"
            >
              Excel'e Aktar
            </button>
          ) : null}
        </div>
      </div>

      {/* Stat cards */}
      {!ordersQuery.isLoading && meta ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Toplam Sipariş" value={meta.total.toLocaleString("tr-TR")} />
            <StatCard
              label="Toplam Ciro"
              value={formatTRY(stats?.totalRevenue ?? 0)}
              sub={
                activeFilters > 0
                  ? `Filtreye uyan ${meta.total.toLocaleString("tr-TR")} sipariş`
                  : "Tüm zamanlar"
              }
            />
            <StatCard
              label="Sayfa"
              value={`${meta.page} / ${meta.totalPages}`}
              sub={`${pageSize} sipariş/sayfa`}
            />
            <StatCard
              label="Filtre"
              value={activeFilters > 0 ? `${activeFilters} aktif` : "Yok"}
              sub={status ? ORDER_STATUS_LABELS[status] : "Tüm durumlar"}
            />
          </div>
          {stats ? <DailyPulseStrip stats={stats} /> : null}
        </div>
      ) : null}

      {/* Status filter chips (live) */}
      <StatusFilterChips
        active={status}
        counts={statusCountsQuery.data ?? null}
        isLoading={statusCountsQuery.isLoading}
        isFetching={statusCountsQuery.isFetching}
        onSelect={(next) => setStatus(next)}
      />

      {/* Sözde-durum çipi: elle alım bekleyen */}
      <div className="-mt-1 mb-3 flex flex-wrap items-center gap-2">
        <SpecialFilterChip
          label="🛒 Manuel bekliyor"
          title="Henüz tedarikçiden alınmamış ödenmiş siparişler"
          count={manualPendingCountQuery.data ?? 0}
          active={special === "manual_pending"}
          loading={manualPendingCountQuery.isLoading}
          tone="amber"
          onClick={() =>
            setSpecial((prev) => (prev === "manual_pending" ? "" : "manual_pending"))
          }
        />
        {special ? (
          <button
            type="button"
            onClick={() => setSpecial("")}
            className="text-xs text-[var(--color-text-muted)] underline hover:text-[var(--color-text)]"
          >
            filtreyi temizle
          </button>
        ) : null}
      </div>

      {/* Filter bar */}
      <div className="rounded-xl border border-[var(--color-border)] bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          {/* Search */}
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Ara</label>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[var(--color-text-muted)]">
                <svg width="13" height="13" viewBox="0 0 20 20" fill="none">
                  <circle cx="8.5" cy="8.5" r="5.75" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M13 13l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </span>
              <input
                type="search"
                value={customerInput}
                onChange={(e) => setCustomerInput(e.target.value)}
                placeholder="müşteri, sipariş no, tedarikçi sip no, SKU, ürün adı ve kargo barkodu ile aratma"
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]"
              />
            </div>
          </div>

          {/* Status */}
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Durum</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as OrderStatus | "")}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]"
            >
              <option value="">Tümü</option>
              {ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>{ORDER_STATUS_LABELS[s]}</option>
              ))}
            </select>
          </div>

          {/* Satış kanalı (tek seçim) */}
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Satış Kanalı</label>
            <select
              value={marketplace}
              onChange={(e) => setMarketplace(e.target.value)}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]"
            >
              <option value="">Tümü</option>
              {ORDER_MARKETPLACES.map((m) => (
                <option key={m} value={m}>{ORDER_MARKETPLACE_LABELS[m]}</option>
              ))}
            </select>
          </div>

          {/* Bayi (aramalı tek seçim) — yalnız 'customers' izni olanlara */}
          {canSeeCustomers && (
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Bayi</label>
            <BayiFilterSelect
              value={customerId}
              onChange={setCustomerId}
              enabled={authed && canSeeCustomers}
            />
          </div>
          )}

          {/* Supplier (çoklu seçim) — yalnız 'suppliers' izni olanlara */}
          {canSeeSuppliers && (
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Tedarikçi</label>
            <SupplierMultiSelect
              options={supplierOptions}
              isChecked={isSupplierChecked}
              onToggle={toggleSupplier}
              onSelectAll={selectAllSuppliers}
              onClearAll={clearAllSuppliers}
              selectedCount={selectedSupplierCount}
              totalCount={totalSuppliers}
              allSelected={allSuppliersSelected}
              loading={suppliersQuery.isLoading}
            />
          </div>
          )}

          {/* Date range */}
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Başlangıç</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Bitiş</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]"
            />
          </div>

          {/* Clear filters */}
          {activeFilters > 0 ? (
            <button
              type="button"
              onClick={() => {
                setStatus("");
                setCustomerInput("");
                setFrom("");
                setTo("");
                setMarketplace("");
                setCustomerId("");
                setSupplierSel(null);
              }}
              className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-muted)] transition-colors"
            >
              Temizle
            </button>
          ) : null}
        </div>
      </div>

      {/* Table */}
      {ordersQuery.isError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {ordersQuery.error instanceof Error ? ordersQuery.error.message : "Veri alınamadı"}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-white">
          <div className="flex items-center justify-end px-3 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-surface-muted)]/50">
            <button
              type="button"
              onClick={resetWidths}
              title="Kolon genişliklerini varsayılana döndür"
              className="text-[11px] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-brand-blue)] transition-colors"
            >
              Kolonları sıfırla
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="text-sm" style={{ tableLayout: "fixed", width: "max-content", minWidth: "100%" }}>
              <colgroup>
                <col style={{ width: colWidths.checkbox }} />
                <col style={{ width: colWidths.products }} className="hidden md:table-column" />
                <col style={{ width: colWidths.customer }} />
                <col style={{ width: colWidths.supplier }} className="hidden sm:table-column" />
                <col style={{ width: colWidths.cargo }} className="hidden lg:table-column" />
                <col style={{ width: colWidths.status }} />
                <col style={{ width: colWidths.total }} />
                <col style={{ width: colWidths.order }} />
                <col style={{ width: colWidths.actions }} />
              </colgroup>
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
                  <th className="relative px-3 py-3 text-center">
                    <input
                      type="checkbox"
                      aria-label="Tümünü seç"
                      checked={orders.length > 0 && orders.every((o) => selectedIds.has(o.id))}
                      ref={(el) => {
                        if (!el) return;
                        const some = orders.some((o) => selectedIds.has(o.id));
                        const all = orders.length > 0 && orders.every((o) => selectedIds.has(o.id));
                        el.indeterminate = some && !all;
                      }}
                      onChange={(e) => {
                        const next = new Set(selectedIds);
                        if (e.target.checked) {
                          orders.forEach((o) => next.add(o.id));
                        } else {
                          orders.forEach((o) => next.delete(o.id));
                        }
                        setSelectedIds(next);
                      }}
                      className="h-4 w-4 cursor-pointer rounded border-[var(--color-border)] text-[var(--color-brand-blue)] focus:ring-[var(--color-brand-blue)]"
                    />
                    <ResizeHandle columnKey="checkbox" onStart={startResize} />
                  </th>
                  <th className="relative hidden px-4 py-3 text-left md:table-cell">
                    Ürünler
                    <ResizeHandle columnKey="products" onStart={startResize} />
                  </th>
                  <th className="relative px-4 py-3 text-left">
                    Müşteri
                    <ResizeHandle columnKey="customer" onStart={startResize} />
                  </th>
                  <th className="relative hidden px-4 py-3 text-left sm:table-cell">
                    Tedarikçi
                    <ResizeHandle columnKey="supplier" onStart={startResize} />
                  </th>
                  <th className="relative hidden px-4 py-3 text-left lg:table-cell">
                    Kargo
                    <ResizeHandle columnKey="cargo" onStart={startResize} />
                  </th>
                  <th className="relative px-4 py-3 text-center">
                    Durum
                    <ResizeHandle columnKey="status" onStart={startResize} />
                  </th>
                  <th className="relative px-4 py-3 text-right">
                    Tutar
                    <ResizeHandle columnKey="total" onStart={startResize} />
                  </th>
                  <th className="relative px-4 py-3 text-left">
                    Sipariş
                    <ResizeHandle columnKey="order" onStart={startResize} />
                  </th>
                  <th className="px-4 py-3 text-center">PDF</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {ordersQuery.isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 9 }).map((__, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="h-4 animate-pulse rounded bg-[var(--color-surface-muted)]" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : orders.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-12 text-center text-sm text-[var(--color-text-muted)]">
                      {activeFilters > 0 ? "Filtrelerinizle eşleşen sipariş bulunamadı." : "Henüz sipariş yok."}
                    </td>
                  </tr>
                ) : (
                  orders.map((o) => (
                    <Fragment key={o.id}>
                    <tr
                      className={`hover:bg-[var(--color-surface-muted)] transition-colors${recentlyChangedIds.has(o.id) ? " order-row-just-changed" : ""}`}
                    >
                      {/* Checkbox */}
                      <td className="px-3 py-3 text-center overflow-hidden">
                        <input
                          type="checkbox"
                          aria-label={`Sipariş ${o.orderNumber} seç`}
                          checked={selectedIds.has(o.id)}
                          onChange={(e) => {
                            const next = new Set(selectedIds);
                            if (e.target.checked) next.add(o.id);
                            else next.delete(o.id);
                            setSelectedIds(next);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="h-4 w-4 cursor-pointer rounded border-[var(--color-border)] text-[var(--color-brand-blue)] focus:ring-[var(--color-brand-blue)]"
                        />
                      </td>

                      {/* Ürünler (isim + thumbnail) — hidden <md */}
                      <td className="hidden px-4 py-3 align-top overflow-hidden md:table-cell">
                        <ProductList
                          orderId={o.id}
                          products={o.products}
                          marketplace={o.marketplace ?? null}
                          onImageClick={(url, alt) => setLightboxImage({ url, alt })}
                        />
                      </td>

                      {/* Müşteri — hücrenin tamamı son müşteri adını kopyalar (yoksa bayi adı) */}
                      <td className="px-4 py-3 align-top overflow-hidden">
                        <CopyableText
                          value={o.endCustomerName || o.customerName}
                          title={o.endCustomerName ? "Son müşteri adını kopyala" : "Müşteri adını kopyala"}
                          className="block -m-1 p-1"
                        >
                          {/* Bayi adı → bayi (Customer) detay sayfasına link.
                              stopPropagation ile hücrenin kopyalama davranışını
                              tetiklemez; navigasyon normal çalışır. */}
                          {o.customerId ? (
                            <Link
                              to={`/customers/${o.customerId}`}
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => e.stopPropagation()}
                              title="Bayi detayına git"
                              className="font-medium break-words text-[var(--color-brand-blue)] hover:underline"
                            >
                              {o.customerName}
                            </Link>
                          ) : (
                            <div className="font-medium break-words">{o.customerName}</div>
                          )}
                          {o.customerId ? (
                            <div
                              className="mt-1"
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => e.stopPropagation()}
                            >
                              <CustomerTagEditor
                                customerId={o.customerId}
                                tags={o.customerTags ?? []}
                                autoTags={o.customerAutoTags ?? []}
                                onChanged={() =>
                                  void queryClient.invalidateQueries({
                                    queryKey: ["orders"],
                                  })
                                }
                              />
                            </div>
                          ) : null}
                          {o.endCustomerName ? (
                            <div className="mt-0.5 flex items-center gap-1 text-xs text-[var(--color-brand-blue)]">
                              <span className="break-words">Müşteri: {o.endCustomerName}</span>
                              <CopyButton value={o.endCustomerName} title="Son müşteri adını kopyala" />
                            </div>
                          ) : null}
                        </CopyableText>
                      </td>

                      {/* Tedarikçi — hidden <sm */}
                      <td className="hidden px-4 py-3 align-top text-[var(--color-text-muted)] overflow-hidden sm:table-cell">
                        {renderSupplierCell(o)}
                      </td>

                      {/* Kargo (company + barcode merged) — hidden <lg */}
                      <td className="hidden px-4 py-3 align-top overflow-hidden lg:table-cell">
                        {renderCargoCell(o)}
                      </td>

                      {/* Durum */}
                      <td className="px-4 py-3 text-center align-top overflow-hidden">
                        <InlineStatusBadge
                          order={o}
                          onUpdated={() => queryClient.invalidateQueries({ queryKey: ["orders"] })}
                        />
                      </td>

                      {/* Tutar */}
                      <td className="px-4 py-3 text-right tabular-nums font-medium align-top overflow-hidden">
                        {formatTRY(o.total)}
                      </td>

                      {/* Sipariş no — insan-okur sipariş numarası (61...) + tarih altta */}
                      <td className="px-4 py-3 align-top overflow-hidden">
                        <Link
                          to={`/orders/${o.id}`}
                          className="block font-medium tabular-nums hover:text-[var(--color-brand-blue)] transition-colors break-words"
                        >
                          {formatOrderNo(o.humanOrderNo, o.orderNumber)}
                        </Link>
                        <div className="mt-0.5 tabular-nums text-[11px] text-[var(--color-text-muted)]">
                          {formatShortDateTime(o.createdAt)}
                        </div>
                      </td>

                      {/* PDF — satırdan doğrudan indir (detaya girmeden) */}
                      <td className="px-4 py-3 text-center">
                        {o.hasPdf ? (
                          <button
                            type="button"
                            onClick={() =>
                              handleDownloadPdf(
                                o.id,
                                o.humanOrderNo || o.orderNumber,
                              )
                            }
                            disabled={pdfLoadingId === o.id}
                            className="rounded p-1 text-[var(--color-text-muted)] hover:text-[var(--color-primary)] hover:bg-[var(--color-surface-muted)] transition-colors disabled:cursor-wait disabled:opacity-60"
                            title="PDF indir"
                          >
                            {pdfLoadingId === o.id ? (
                              <svg
                                className="animate-spin"
                                width="15"
                                height="15"
                                viewBox="0 0 20 20"
                                fill="none"
                              >
                                <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="2" strokeOpacity="0.25" />
                                <path d="M17 10a7 7 0 00-7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                              </svg>
                            ) : (
                              <svg width="15" height="15" viewBox="0 0 20 20" fill="none">
                                <path d="M10 3v9m0 0l-3.5-3.5M10 12l3.5-3.5M4 15h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                          </button>
                        ) : (
                          <span className="text-[var(--color-text-muted)]" title="PDF yok">
                            —
                          </span>
                        )}
                      </td>
                    </tr>

                    {/* Sipariş notu şeridi — notu olan sipariş satırının hemen
                        altında tam genişlikte; gözden kaçmaması KRİTİK. Tıklayınca
                        notun tamamı popup'ta açılır. */}
                    {o.notes ? (
                      <tr className="bg-amber-50">
                        <td colSpan={9} className="border-l-4 border-amber-400 px-4 py-2">
                          <button
                            type="button"
                            onClick={() =>
                              setOpenNote({
                                orderNo: formatOrderNo(o.humanOrderNo, o.orderNumber),
                                note: o.notes as string,
                              })
                            }
                            title="Notun tamamını gör"
                            className="flex w-full items-start gap-2 text-left"
                          >
                            <span className="mt-px inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-400 bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-900">
                              ⚠️ Sipariş Notu
                            </span>
                            <span className="line-clamp-2 text-sm leading-snug text-amber-900 hover:underline">
                              {o.notes}
                            </span>
                          </button>
                        </td>
                      </tr>
                    ) : null}

                    {/* Auto-route yönlendirme notu (ADMIN-ONLY) — yalnız İtedarik↔TB'de
                        İtedarik daha ucuzken TB'den alınan siparişlerde çıkar; küçük
                        gri satır. Müşteriye ASLA gösterilmez. */}
                    {o.dispatchRoutingNote ? (
                      <tr>
                        <td colSpan={9} className="px-4 pb-1 pt-0">
                          <span className="text-[11px] text-slate-400">
                            ↪ {o.dispatchRoutingNote}
                          </span>
                        </td>
                      </tr>
                    ) : null}
                    </Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {meta ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] bg-[var(--color-surface-muted)] px-4 py-3 text-xs">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="text-[var(--color-text-muted)]">
                  {(meta.total > 0
                    ? (meta.page - 1) * meta.pageSize + 1
                    : 0
                  ).toLocaleString("tr-TR")}
                  –
                  {Math.min(meta.page * meta.pageSize, meta.total).toLocaleString("tr-TR")}{" "}
                  / {meta.total.toLocaleString("tr-TR")}
                </span>
                <label className="flex items-center gap-1.5 text-[var(--color-text-muted)]">
                  <span>Sayfa başına</span>
                  <select
                    value={String(pageSize)}
                    onChange={(e) =>
                      handlePageSizeChange(parsePageSize(e.target.value))
                    }
                    disabled={ordersQuery.isFetching}
                    className="rounded-md border border-[var(--color-border)] bg-white px-2 py-1 text-[var(--color-text)] disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
                  >
                    {PAGE_SIZE_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {meta.totalPages > 1 ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={meta.page <= 1 || ordersQuery.isFetching}
                    className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1 hover:bg-white/70 disabled:opacity-50 transition-colors"
                  >
                    ← Önceki
                  </button>
                  <span className="px-1 text-[var(--color-text-muted)]">
                    {meta.page} / {meta.totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage((p) => p + 1)}
                    disabled={meta.page >= meta.totalPages || ordersQuery.isFetching}
                    className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1 hover:bg-white/70 disabled:opacity-50 transition-colors"
                  >
                    Sonraki →
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      {showBulkModal ? (
        <BulkUpdateModal
          selectedIds={selectedIds}
          filters={filters}
          filteredTotal={meta?.total ?? 0}
          suppliers={supplierList}
          onClose={() => setShowBulkModal(false)}
          onDone={() => {
            setShowBulkModal(false);
            setSelectedIds(new Set());
            queryClient.invalidateQueries({ queryKey: ["orders"] });
          }}
        />
      ) : null}

      {showExport ? (
        <ExportModal
          title="Siparişleri Excel'e aktar"
          description="Filtre seçin veya tüm siparişleri indirin."
          fields={
            [
              {
                key: "status",
                label: "Durum",
                type: "select",
                options: ORDER_STATUSES.map((s) => ({ value: s, label: ORDER_STATUS_LABELS[s] })),
              },
              { key: "customer", label: "Müşteri (ad/e-posta)", type: "text" },
              { key: "supplierId", label: "Tedarikçi", type: "select", options: supplierOptions },
              { key: "from", label: "Başlangıç tarihi", type: "date" },
              { key: "to", label: "Bitiş tarihi", type: "date" },
            ] satisfies ReadonlyArray<ExportField>
          }
          initialValues={{
            status: status || undefined,
            customer: debouncedCustomer || undefined,
            from: from || undefined,
            to: to || undefined,
            // Tam olarak bir tedarikçi seçiliyse export formunu onunla ön-doldur;
            // çoklu/tümü durumunda boş (admin formda tek tedarikçi seçer).
            supplierId:
              supplierSel && supplierSel.size === 1
                ? Array.from(supplierSel)[0]
                : undefined,
          }}
          onClose={() => setShowExport(false)}
          onSubmit={async (values, scope) => {
            const exportFilters =
              scope === "all"
                ? { scope: "all" as const }
                : {
                    scope: "filtered" as const,
                    status: values.status as string | undefined,
                    customer: values.customer as string | undefined,
                    from: values.from as string | undefined,
                    to: values.to as string | undefined,
                    supplierId: values.supplierId as string | undefined,
                  };
            try {
              const result = await exportFromBackend("orders", exportFilters);
              if (result.ok) {
                toast.push("success", `${result.filename} indirildi`);
                setShowExport(false);
                return;
              }
              if (result.status === 404 || result.status === 501) {
                const stamp = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Istanbul" });
                const cargoLabel = (raw: string | null | undefined): string => {
                  if (!raw) return "";
                  const key = raw.toUpperCase() as CargoCompany;
                  return CARGO_COMPANY_LABELS[key] ?? raw;
                };
                const marketplaceLabel = (raw: string | null | undefined): string => {
                  if (!raw) return "";
                  const key = raw.toLowerCase() as keyof typeof ORDER_MARKETPLACE_LABELS;
                  return ORDER_MARKETPLACE_LABELS[key] ?? raw;
                };
                // Bu CSV tedarikçiye gider — fiyat/kâr KESİNLİKLE yok; bayi adı
                // yerine bayi kodu (BAYI-XXXXXX) paylaşılır. Backend XLSX ile
                // aynı kolon düzeni: her ÜRÜN KALEMİ bir satır (Ürün Adı + Adet).
                // SKU/Barkod liste payload'ında olmadığından bu hızlı fallback'te
                // boştur — tam değerler yalnızca backend Excel'inde gelir.
                // Tedarikçi filtresi seçiliyse yalnızca o tedarikçinin kalemleri
                // satır olur (backend ile aynı: başka tedarikçinin ürünü sızmaz).
                const csvSupplierId =
                  scope === "filtered"
                    ? (values.supplierId as string | undefined)
                    : undefined;
                exportRowsAsCsv(
                  orders.flatMap((o) => {
                    const base = {
                      humanOrderNo: o.humanOrderNo ?? "",
                      createdAt: o.createdAt,
                      status: ORDER_STATUS_LABELS[o.status],
                      bayiId: o.bayiNo ?? "",
                      marketplace: marketplaceLabel(o.marketplace ?? null),
                      supplierOrderNo: o.supplierOrderNo ?? "",
                      cargoCompany: cargoLabel(
                        typeof o.cargoCompany === "string" ? o.cargoCompany : null,
                      ),
                      cargoBarcode: o.cargoBarcode ?? o.trackingNumber ?? "",
                    };
                    const items = (o.products ?? []).filter(
                      (p) => !csvSupplierId || p.supplierId === csvSupplierId,
                    );
                    if (items.length === 0) {
                      // Tedarikçi filtresi varken eşleşen kalemi olmayan siparişi
                      // tamamen ATLA (sızıntı yok). Filtre yoksa kalem verisi
                      // olmayan siparişi yine de tek satırla göster.
                      if (csvSupplierId) return [];
                      return [
                        {
                          ...base,
                          sku: "",
                          barcode: "",
                          productName: "",
                          qty: "" as string | number,
                          supplier: (o.supplierNames ?? []).join(", "),
                        },
                      ];
                    }
                    return items.map((p) => ({
                      ...base,
                      sku: "",
                      barcode: "",
                      productName: p.name,
                      qty: p.qty as string | number,
                      supplier: p.supplierName ?? "",
                    }));
                  }),
                  [
                    { key: "humanOrderNo", label: "Sipariş No" },
                    { key: "createdAt", label: "Sipariş Tarihi" },
                    { key: "status", label: "Durum" },
                    { key: "bayiId", label: "Bayi ID" },
                    { key: "marketplace", label: "Satış Kanalı" },
                    { key: "sku", label: "Stok Kodu (SKU)" },
                    { key: "barcode", label: "Barkod" },
                    { key: "productName", label: "Ürün Adı" },
                    { key: "qty", label: "Adet" },
                    { key: "supplier", label: "Tedarikçi" },
                    { key: "supplierOrderNo", label: "Tedarikçi Sipariş No" },
                    { key: "cargoCompany", label: "Kargo Firması" },
                    { key: "cargoBarcode", label: "Kargo Barkodu" },
                  ],
                  `siparisler-${stamp}.csv`,
                );
                toast.push(
                  "info",
                  "Backend XLSX endpoint'i hazır değil — geçici CSV indirildi (yalnızca görünen sayfa; SKU/barkod yalnızca tam Excel'de).",
                );
                setShowExport(false);
                return;
              }
              toast.push("error", `Export hata: HTTP ${result.status}`);
            } catch (err) {
              if (isMissingEndpoint(err)) {
                toast.push("info", "Backend export endpoint'i hazır değil.");
              } else {
                toast.push("error", err instanceof Error ? err.message : "Export başarısız");
              }
            }
          }}
        />
      ) : null}

      <ImageLightbox image={lightboxImage} onClose={() => setLightboxImage(null)} />

      <OrderNoteModal note={openNote} onClose={() => setOpenNote(null)} />
    </div>
  );
}
