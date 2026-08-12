import type { PopupBlock, PopupPosition, PopupSize } from "../../lib/popups";
import { BlockPreview } from "./blocks/BlockPreview";

/**
 * Pop-up canlı önizlemesi — müşteri ekranında nasıl görüneceğini birebir
 * yansıtır. Blok modu (content dolu) → BlockPreview; aksi halde legacy
 * başlık/metin/görsel/CTA. Konum, boyut/özel genişlik, arka plan, tema rengi
 * gerçek zamanlı gösterilir.
 */

export interface PopupPreviewProps {
  blocks?: PopupBlock[] | null;
  title?: string | null;
  body?: string | null;
  imageUrl?: string | null;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  position: PopupPosition;
  size: PopupSize;
  widthPx?: number | null;
  backgroundColor?: string | null;
  dismissible: boolean;
  themeColor?: string | null;
}

const DEFAULT_ACCENT = "#2563eb";
const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const POSITION_ALIGN: Record<PopupPosition, string> = {
  CENTER: "items-center justify-center",
  TOP: "items-start justify-center",
  BOTTOM: "items-end justify-center",
  TOP_LEFT: "items-start justify-start",
  TOP_RIGHT: "items-start justify-end",
  BOTTOM_LEFT: "items-end justify-start",
  BOTTOM_RIGHT: "items-end justify-end",
};

const SIZE_WIDTH: Record<PopupSize, string> = {
  SMALL: "w-1/2",
  MEDIUM: "w-2/3",
  LARGE: "w-11/12",
};

export function PopupPreview({
  blocks,
  title,
  body,
  imageUrl,
  ctaLabel,
  ctaUrl,
  position,
  size,
  widthPx,
  backgroundColor,
  dismissible,
  themeColor,
}: PopupPreviewProps) {
  const accent = themeColor && HEX_RE.test(themeColor) ? themeColor : DEFAULT_ACCENT;
  const cardBg = backgroundColor && HEX_RE.test(backgroundColor) ? backgroundColor : "#ffffff";
  const hasBlocks = Array.isArray(blocks) && blocks.length > 0;
  const hasCta = !hasBlocks && Boolean(ctaLabel && ctaLabel.trim() && ctaUrl && ctaUrl.trim());
  const widthClass = widthPx ? "w-11/12" : SIZE_WIDTH[size];

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-[var(--color-text-muted,#64748b)]">
        Müşteri ekranı önizlemesi
      </span>
      <div
        className={`relative flex max-h-[520px] overflow-auto rounded-xl border border-[var(--color-border,#e2e8f0)] bg-gradient-to-br from-slate-50 to-slate-100 p-4 ${POSITION_ALIGN[position]}`}
        aria-hidden="true"
      >
        <div className="pointer-events-none absolute inset-0 bg-slate-900/5" />

        <div
          className={`relative ${widthClass} max-w-full overflow-hidden rounded-2xl shadow-xl ring-1 ring-black/5`}
          style={{ backgroundColor: cardBg }}
        >
          {dismissible && (
            <span className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-white/80 text-slate-400 ring-1 ring-slate-200">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </span>
          )}

          {hasBlocks ? (
            <div className="p-4">
              <BlockPreview blocks={blocks!} accent={accent} />
            </div>
          ) : (
            <>
              <div className="h-1.5 w-full" style={{ backgroundColor: accent }} />
              {imageUrl && (
                <div className="h-24 w-full overflow-hidden bg-slate-100">
                  <img src={imageUrl} alt="" className="h-full w-full object-cover" />
                </div>
              )}
              <div className="px-4 py-3">
                <h3 className="line-clamp-2 text-sm font-semibold text-slate-900">
                  {(title && title.trim()) || "Pop-up başlığı"}
                </h3>
                <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs leading-relaxed text-slate-600">
                  {(body && body.trim()) || "Pop-up içeriği burada görünecek."}
                </p>
                {hasCta && (
                  <span
                    className="mt-3 inline-flex items-center rounded-lg px-3 py-1.5 text-xs font-semibold text-white shadow-sm"
                    style={{ backgroundColor: accent }}
                  >
                    {ctaLabel}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
