import { useEffect, useState } from "react";

/**
 * Yükleme türünden bağımsız (destek talebi, iade talebi, vb.) görsel
 * galerisi. Backend her bir ek için imzalı `url` döner; bu component
 * ön-uçta thumbnail ızgarası + lightbox sağlar. Kaynak sayfanın yapması
 * gereken tek şey kendi `Attachment[]` listesini bu shape'e map etmek.
 */
export interface AttachmentItem {
  id: string;
  filename: string;
  mimetype: string;
  size: number;
  /** Backend'in imzalı `/api/storage/...?exp&sig` URL'i. Null'sa thumbnail
   *  yerine "yüklenemedi" placeholder'ı gösterilir. */
  url: string | null;
}

const API_BASE_RAW =
  (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

function apiOrigin(): string {
  try {
    if (API_BASE_RAW.startsWith("http")) {
      return new URL(API_BASE_RAW).origin;
    }
    if (typeof window !== "undefined") return window.location.origin;
    return "";
  } catch {
    return "";
  }
}

/**
 * Backend göreli URL döndürürse (`/api/storage/...`) admin SPA'nın
 * çalıştığı origin'i değil API origin'ini kullanmamız lazım — aksi halde
 * dev'de :3002'den :4000'e gitmesi gereken istek :3002'ye düşer ve 404
 * alır. STORAGE_PUBLIC_BASE_URL ayarlandığında URL zaten absolute olur,
 * bu yardımcı no-op gibi davranır.
 */
function buildAttachmentSrc(url: string | null): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (!url.startsWith("/")) return url;
  const origin = apiOrigin();
  return origin ? `${origin}${url}` : url;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Ek video mu? (Foto+video kabulü 2026-08-02 — thumbnail/lightbox ayrımı.) */
function isVideo(att: AttachmentItem): boolean {
  if (att.mimetype?.startsWith("video/")) return true;
  return /\.(mp4|mov|m4v|webm|mkv|avi|3gp)$/i.test(att.filename ?? "");
}

interface AttachmentGalleryProps {
  attachments: AttachmentItem[] | undefined | null;
  /** Boş listede placeholder göstersin mi? Default: false (hiçbir şey çizmez). */
  emptyHint?: boolean;
  /** Galeri başlığı; varsayılan "Ekler". */
  label?: string;
}

export default function AttachmentGallery({
  attachments,
  emptyHint = false,
  label = "Ekler",
}: AttachmentGalleryProps): React.ReactElement | null {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const list: AttachmentItem[] = attachments ?? [];

  useEffect(() => {
    if (lightboxIndex === null) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") setLightboxIndex(null);
      if (e.key === "ArrowRight") {
        setLightboxIndex((idx) =>
          idx === null ? null : Math.min(list.length - 1, idx + 1),
        );
      }
      if (e.key === "ArrowLeft") {
        setLightboxIndex((idx) =>
          idx === null ? null : Math.max(0, idx - 1),
        );
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxIndex, list.length]);

  if (list.length === 0) {
    if (!emptyHint) return null;
    return (
      <div className="mt-4 rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3 text-xs text-[var(--color-text-muted)]">
        Bu kayda eklenmiş görsel yok.
      </div>
    );
  }

  const active =
    lightboxIndex !== null ? list[lightboxIndex] ?? null : null;
  const activeSrc = active ? buildAttachmentSrc(active.url) : null;

  return (
    <div className="mt-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
        <span>{label}</span>
        <span className="rounded-full bg-[var(--color-surface-muted)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-text)]">
          {list.length}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
        {list.map((att, idx) => {
          const src = buildAttachmentSrc(att.url);
          return (
            <button
              key={att.id}
              type="button"
              onClick={() => setLightboxIndex(idx)}
              className="group relative overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface-muted)] aspect-square focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-blue)]"
              title={`${att.filename} · ${formatBytes(att.size)}`}
            >
              {src && isVideo(att) ? (
                <div className="flex h-full w-full items-center justify-center bg-slate-800 text-2xl text-white">
                  ▶
                </div>
              ) : src ? (
                <img
                  src={src}
                  alt={att.filename}
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform group-hover:scale-105"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-[var(--color-text-muted)]">
                  Görsel yüklenemedi
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1.5 py-0.5 text-[10px] text-white">
                {att.filename}
              </div>
            </button>
          );
        })}
      </div>

      {active && activeSrc ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-6"
          onClick={() => setLightboxIndex(null)}
          role="dialog"
          aria-modal="true"
          aria-label={active.filename}
        >
          <button
            type="button"
            className="absolute right-4 top-4 rounded-full bg-white/10 px-3 py-1 text-sm text-white hover:bg-white/20"
            onClick={(e) => {
              e.stopPropagation();
              setLightboxIndex(null);
            }}
            aria-label="Kapat"
          >
            ✕
          </button>
          {lightboxIndex !== null && lightboxIndex > 0 ? (
            <button
              type="button"
              className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white hover:bg-white/20"
              onClick={(e) => {
                e.stopPropagation();
                setLightboxIndex((idx) =>
                  idx === null ? null : Math.max(0, idx - 1),
                );
              }}
              aria-label="Önceki"
            >
              ‹
            </button>
          ) : null}
          {lightboxIndex !== null && lightboxIndex < list.length - 1 ? (
            <button
              type="button"
              className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white hover:bg-white/20"
              onClick={(e) => {
                e.stopPropagation();
                setLightboxIndex((idx) =>
                  idx === null ? null : Math.min(list.length - 1, idx + 1),
                );
              }}
              aria-label="Sonraki"
            >
              ›
            </button>
          ) : null}
          <figure
            className="flex max-h-full max-w-full flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            {isVideo(active) ? (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <video
                src={activeSrc}
                controls
                autoPlay
                className="max-h-[80vh] max-w-[90vw] rounded-md bg-black shadow-2xl"
              />
            ) : (
              <img
                src={activeSrc}
                alt={active.filename}
                className="max-h-[80vh] max-w-[90vw] rounded-md object-contain shadow-2xl"
              />
            )}
            <figcaption className="mt-3 flex items-center gap-3 text-xs text-white/80">
              <span className="font-medium text-white">{active.filename}</span>
              <span>{formatBytes(active.size)}</span>
              <a
                href={activeSrc}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md bg-white/15 px-2 py-1 text-white hover:bg-white/25"
              >
                Yeni sekmede aç ↗
              </a>
            </figcaption>
          </figure>
        </div>
      ) : null}
    </div>
  );
}
