"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import type { ClientPopup, PopupBlock, PopupPosition, PopupSize } from "@/lib/popups";
import { PopupBlocks, blocksHaveButton } from "./PopupBlocks";

/**
 * Müşteri ekranındaki tek bir pop-up'ı render eder. İki mod:
 *  - BLOK modu (popup.content dolu): görsel blok düzenleyici tasarımı
 *    (rozet/başlık/hero/kutu/görsel/video/buton…) — özel genişlik + arka plan.
 *  - LEGACY mod: başlık + düz metin + görsel + tek CTA (eski basit pop-up).
 *
 * Modern beyaz tema korunur; yalnızca CENTER konumu ekranı karartır, kenar/köşe
 * konumları engellemeyen "toast" gibi davranır.
 *
 * Kapatma semantiği — kullanıcıyı asla tuzağa düşürmeyiz:
 *  - `dismissible` true  → X düğmesi var, Escape ve (CENTER'da) arka plana tıklama kapatır.
 *  - `dismissible` false → CTA/buton ile ilerlenir; ama hiç buton/CTA yoksa yine kapatılabilir.
 */

interface PopupModalProps {
  popup: ClientPopup;
  /** Kapatıldı (X / Escape / arka plan). Sunucuda "dismiss" olarak işaretlenir. */
  onClose: () => void;
  /** CTA / buton tıklandı. Sunucuda "click" olarak işaretlenir. */
  onCtaClick: () => void;
}

const DEFAULT_ACCENT = "#2563eb";
const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const CTA_INTERNAL_RE = /^\//;
const CTA_ABSOLUTE_RE = /^https?:\/\//i;

// Fixed kapsayıcının hizalaması — kart bu kutu içinde konumlanır.
const POSITION_CONTAINER: Record<PopupPosition, string> = {
  CENTER: "items-center justify-center p-4",
  TOP: "items-start justify-center p-4 pt-6 sm:pt-10",
  BOTTOM: "items-end justify-center p-4 pb-6 sm:pb-10",
  TOP_LEFT: "items-start justify-start p-4 sm:p-6",
  TOP_RIGHT: "items-start justify-end p-4 sm:p-6",
  // Sol-alt köşe WhatsApp FAB'ı ile çakışmasın diye fazladan alt boşluk.
  BOTTOM_LEFT: "items-end justify-start p-4 sm:p-6 sm:pb-24",
  BOTTOM_RIGHT: "items-end justify-end p-4 sm:p-6",
};

const SIZE_MAXW: Record<PopupSize, string> = {
  SMALL: "max-w-sm",
  MEDIUM: "max-w-md",
  LARGE: "max-w-2xl",
};

function resolveColor(value: string | null, fallback: string): string {
  return value && HEX_RE.test(value) ? value : fallback;
}

export function PopupModal({ popup, onClose, onCtaClick }: PopupModalProps) {
  const [mounted, setMounted] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const titleId = useId();
  const bodyId = useId();

  const accent = resolveColor(popup.themeColor, DEFAULT_ACCENT);
  const blocks: PopupBlock[] | null =
    Array.isArray(popup.content) && popup.content.length > 0
      ? popup.content
      : null;

  const hasLegacyCta = !blocks && Boolean(popup.ctaLabel && popup.ctaUrl);
  const hasInteractive = blocks ? blocksHaveButton(blocks) : hasLegacyCta;
  const hasBackdrop = popup.position === "CENTER";
  // Buton/CTA yoksa, dismissible false olsa bile kapatılabilir olmalı (tuzak yok).
  const canClose = popup.dismissible || !hasInteractive;

  // Giriş animasyonu: bir sonraki frame'de görünür hale getir.
  useEffect(() => {
    const handle = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(handle);
  }, []);

  // Erişilebilirlik: açılınca odağı kartın üzerine taşı; kapanınca odağı pop-up
  // açılmadan önceki öğeye geri ver (klavye kullanıcısı bağlamını kaybetmesin).
  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    cardRef.current?.focus();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, []);

  // Odak tuzağı — yalnızca karartan (aria-modal=true, CENTER) pop-up'ta Tab,
  // kart içinde döner; odak arka plandaki sayfaya kaçmaz.
  useEffect(() => {
    if (!hasBackdrop) return;
    const card = cardRef.current;
    if (!card) return;
    function onTrapKey(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const focusable = Array.from(
        card!.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (focusable.length === 0) {
        e.preventDefault();
        card!.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || active === card) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    card.addEventListener("keydown", onTrapKey);
    return () => card.removeEventListener("keydown", onTrapKey);
  }, [hasBackdrop]);

  // Escape ile kapatma (kapatılabilir olduğunda).
  useEffect(() => {
    if (!canClose) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canClose, onClose]);

  // Yalnızca karartan (CENTER) pop-up'ta arka plan kaydırmasını kilitle.
  useEffect(() => {
    if (!hasBackdrop) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [hasBackdrop]);

  // Buton/CTA tıklaması: dönüşümü işaretle + ilerle; dahili aynı-sekme linkte
  // SPA gezinmesi (tam reload / oturum kaybı yok).
  const handleInteractiveClick = (
    e: MouseEvent<HTMLAnchorElement>,
    href: string | undefined,
    newTab: boolean,
  ) => {
    const plain =
      e.button === 0 &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.shiftKey &&
      !e.altKey &&
      !e.defaultPrevented;
    onCtaClick();
    if (href && !newTab && CTA_INTERNAL_RE.test(href) && plain) {
      e.preventDefault();
      router.push(href);
    }
  };

  // Legacy CTA href çözümü.
  const ctaTarget = popup.ctaNewTab ? "_blank" : "_self";
  const ctaHref =
    popup.ctaUrl &&
    (CTA_ABSOLUTE_RE.test(popup.ctaUrl) || CTA_INTERNAL_RE.test(popup.ctaUrl))
      ? popup.ctaUrl
      : popup.ctaUrl
        ? `https://${popup.ctaUrl}`
        : undefined;

  const cardBg = resolveColor(popup.backgroundColor, "#ffffff");
  // widthPx YALNIZCA genişliği özelleştirir; yükseklik her zaman max-h-[90vh]
  // ile sınırlı kalır ve içerik gerekirse içeride kayar (uzun blok tasarımları
  // / video aspect oranları için). Standart bir boyuta bağlı kalmaz.
  const cardStyle: CSSProperties = {
    backgroundColor: cardBg,
    ...(popup.widthPx ? { maxWidth: `${popup.widthPx}px` } : {}),
  };
  // Özel genişlik verilmişse boyut ön ayar sınıfını uygulama (style maxWidth kazanır).
  const widthClass = popup.widthPx ? "" : SIZE_MAXW[popup.size];

  return (
    <div
      className={`pointer-events-none fixed inset-0 z-[60] flex ${POSITION_CONTAINER[popup.position]}`}
      role="dialog"
      aria-modal={hasBackdrop}
      aria-labelledby={titleId}
      aria-describedby={bodyId}
    >
      {/* Arka plan karartması — yalnızca CENTER */}
      {hasBackdrop && (
        <div
          className={`pointer-events-auto absolute inset-0 bg-slate-900/50 backdrop-blur-[2px] transition-opacity duration-300 motion-reduce:transition-none ${
            mounted ? "opacity-100" : "opacity-0"
          }`}
          onClick={canClose ? onClose : undefined}
          aria-hidden="true"
        />
      )}

      {/* Kart */}
      <div
        ref={cardRef}
        tabIndex={-1}
        style={cardStyle}
        className={`pointer-events-auto relative flex max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl shadow-2xl shadow-slate-900/20 ring-1 ring-slate-900/5 outline-none transition-all duration-300 ease-out motion-reduce:transition-none ${widthClass} ${
          mounted
            ? "translate-y-0 scale-100 opacity-100"
            : "translate-y-2 scale-[0.98] opacity-0 motion-reduce:translate-y-0"
        }`}
      >
        {/* Üst vurgu şeridi — yalnızca legacy modda (blok modunda tasarım bloklarda) */}
        {!blocks && (
          <div className="h-1.5 w-full shrink-0" style={{ backgroundColor: accent }} />
        )}

        {canClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="absolute right-3 top-4 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/80 text-slate-500 ring-1 ring-slate-200 backdrop-blur transition-colors hover:bg-white hover:text-slate-700"
          >
            <X size={16} />
          </button>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {blocks ? (
            // BLOK modu
            <div className="flex flex-col gap-3 p-5 sm:p-6">
              {/* Erişilebilirlik için gizli başlık/özet (blok metni görünür içerik) */}
              <span id={titleId} className="sr-only">
                {popup.title ?? "Duyuru"}
              </span>
              <span id={bodyId} className="sr-only">
                {popup.body ?? ""}
              </span>
              <PopupBlocks
                blocks={blocks}
                accent={accent}
                onButtonClick={(e, href, newTab) =>
                  handleInteractiveClick(e, href, newTab)
                }
              />
            </div>
          ) : (
            // LEGACY modu
            <>
              {popup.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={popup.imageUrl}
                  alt=""
                  className="max-h-48 w-full object-cover"
                  loading="eager"
                />
              )}

              <div className="flex flex-col gap-3 p-5 sm:p-6">
                {popup.title && (
                  <h2
                    id={titleId}
                    className="pr-8 text-lg font-semibold leading-snug text-slate-900"
                  >
                    {popup.title}
                  </h2>
                )}

                {popup.body && (
                  <p
                    id={bodyId}
                    className="whitespace-pre-line text-sm leading-relaxed text-slate-600"
                  >
                    {popup.body}
                  </p>
                )}

                {hasLegacyCta && ctaHref && (
                  <a
                    href={ctaHref}
                    target={ctaTarget}
                    rel={popup.ctaNewTab ? "noopener noreferrer" : undefined}
                    onClick={(e) =>
                      handleInteractiveClick(e, ctaHref, popup.ctaNewTab)
                    }
                    className="mt-1 inline-flex items-center justify-center rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-4"
                    style={{ backgroundColor: accent }}
                  >
                    {popup.ctaLabel}
                  </a>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
