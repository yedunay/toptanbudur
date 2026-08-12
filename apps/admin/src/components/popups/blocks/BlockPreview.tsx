import type { CSSProperties, ReactNode } from "react";
import type {
  PopupAlign,
  PopupBlock,
  PopupCalloutVariant,
  PopupImageBlock,
  PopupVideoBlock,
} from "../../../lib/popups";

/**
 * Admin canlı önizleme renderer'ı — apps/frontend/components/PopupBlocks.tsx ile
 * AYNI dili konuşur (müşteri ekranıyla birebir). Ham HTML yok; mini-markdown
 * (link + kalın + satır sonu) güvenli parse edilir. Yüklenmemiş medya için
 * yerel object URL (_localUrl) gösterilir.
 */

const SAFE_HREF = (url: string): boolean =>
  /^https?:\/\//i.test(url) || (url.startsWith("/") && !url.startsWith("//"));
const isExternal = (url: string): boolean => /^https?:\/\//i.test(url);
const LINK_RE = /\[([^\]]+)\]\(([^)\s]+)\)/g;

function withBreaks(text: string, k: string): ReactNode[] {
  const out: ReactNode[] = [];
  text.split("\n").forEach((line, i) => {
    if (i > 0) out.push(<br key={`${k}-br${i}`} />);
    if (line) out.push(line);
  });
  return out;
}
function withBold(text: string, k: string): ReactNode[] {
  const out: ReactNode[] = [];
  text.split(/(\*\*[^*]+\*\*)/g).forEach((part, i) => {
    if (!part) return;
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      out.push(<strong key={`${k}-b${i}`}>{withBreaks(part.slice(2, -2), `${k}-b${i}`)}</strong>);
    } else {
      out.push(...withBreaks(part, `${k}-t${i}`));
    }
  });
  return out;
}
function renderRich(text: string, linkColor?: string | null): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let idx = 0;
  let m: RegExpExecArray | null;
  LINK_RE.lastIndex = 0;
  while ((m = LINK_RE.exec(text)) !== null) {
    if (m.index > last) nodes.push(...withBold(text.slice(last, m.index), `s${idx}`));
    const label = m[1];
    const url = m[2];
    if (SAFE_HREF(url)) {
      nodes.push(
        <a
          key={`l${idx}`}
          href={url}
          target={isExternal(url) ? "_blank" : undefined}
          rel={isExternal(url) ? "noopener noreferrer" : undefined}
          className="font-semibold underline underline-offset-2 hover:opacity-80"
          style={linkColor ? { color: linkColor } : undefined}
          onClick={(e) => e.preventDefault()}
        >
          {withBold(label, `ll${idx}`)}
        </a>,
      );
    } else {
      nodes.push(...withBold(label, `sl${idx}`));
    }
    last = m.index + m[0].length;
    idx += 1;
  }
  if (last < text.length) nodes.push(...withBold(text.slice(last), `s${idx}`));
  return nodes;
}

function alignText(align?: PopupAlign): string {
  return align === "center" ? "text-center" : align === "right" ? "text-right" : "text-left";
}
function alignWrap(align?: PopupAlign): string {
  return align === "center" ? "flex justify-center" : align === "right" ? "flex justify-end" : "flex justify-start";
}

const CALLOUT_STYLES: Record<PopupCalloutVariant, { bg: string; border: string; text: string }> = {
  success: { bg: "#ecfdf5", border: "#a7f3d0", text: "#065f46" },
  warning: { bg: "#fffbeb", border: "#fde68a", text: "#92400e" },
  info: { bg: "#eff6ff", border: "#bfdbfe", text: "#1e40af" },
  danger: { bg: "#fef2f2", border: "#fecaca", text: "#991b1b" },
  custom: { bg: "#f8fafc", border: "#e2e8f0", text: "#0f172a" },
};

function mediaWidthStyle(width?: "full" | number): CSSProperties {
  if (width == null || width === "full") return { width: "100%" };
  return { width: `${width}px`, maxWidth: "100%" };
}

function mediaSrc(b: PopupImageBlock | PopupVideoBlock): string {
  return b._localUrl ?? b.url;
}

export function BlockPreview({ blocks, accent }: { blocks: PopupBlock[]; accent: string }) {
  return (
    <div className="flex flex-col gap-3">
      {blocks.map((block, i) => (
        <BlockView key={block.id ?? `b${i}`} block={block} accent={accent} />
      ))}
    </div>
  );
}

function BlockView({ block, accent }: { block: PopupBlock; accent: string }) {
  switch (block.type) {
    case "badge":
      return (
        <div className={alignWrap(block.align ?? "center")}>
          <span className="inline-block rounded-full px-3 py-1 text-xs font-semibold" style={{ backgroundColor: block.bg ?? accent, color: block.color ?? "#ffffff" }}>
            {block.text || "Rozet"}
          </span>
        </div>
      );
    case "heading": {
      const level = block.level ?? 2;
      const Tag = (level === 1 ? "h1" : level === 3 ? "h3" : "h2") as "h1";
      const sizeCls = level === 1 ? "text-2xl" : level === 3 ? "text-base" : "text-xl";
      return (
        <Tag className={`font-bold leading-snug ${sizeCls} ${alignText(block.align)}`} style={{ color: block.color ?? "#0f172a" }}>
          {block.text || "Başlık"}
        </Tag>
      );
    }
    case "text": {
      const sizeCls = block.size === "lg" ? "text-base" : block.size === "sm" ? "text-xs" : "text-sm";
      return (
        <p className={`${sizeCls} leading-relaxed ${alignText(block.align)}`} style={{ color: block.color ?? "#475569" }}>
          {renderRich(block.text || "Metin", accent)}
        </p>
      );
    }
    case "hero": {
      const bgStyle: CSSProperties = block.gradient
        ? { backgroundImage: `linear-gradient(135deg, ${block.gradient[0]}, ${block.gradient[1]})` }
        : { backgroundColor: block.bg ?? accent };
      return (
        <div className={`rounded-2xl px-5 py-6 ${alignText(block.align ?? "center")}`} style={{ ...bgStyle, color: block.color ?? "#ffffff" }}>
          {block.subtitle && <div className="text-sm font-semibold opacity-90">{block.subtitle}</div>}
          <div className="text-4xl font-extrabold leading-tight tracking-tight">{block.title || "Hero"}</div>
        </div>
      );
    }
    case "callout": {
      const v = CALLOUT_STYLES[block.variant ?? "info"];
      const textColor = block.color ?? v.text;
      return (
        <div className={`rounded-xl border px-4 py-3 text-sm ${alignText(block.align ?? "center")}`} style={{ backgroundColor: block.bg ?? v.bg, borderColor: block.borderColor ?? v.border, color: textColor }}>
          {block.title && <div className="mb-1 font-semibold">{block.title}</div>}
          <div className="leading-relaxed">{renderRich(block.text || "Bilgi kutusu", textColor)}</div>
        </div>
      );
    }
    case "image": {
      const src = mediaSrc(block);
      if (!src) {
        return <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-400">Görsel seçilmedi</div>;
      }
      return (
        <div className={alignWrap(block.align ?? "center")}>
          <img src={src} alt={block.alt ?? ""} className="h-auto" style={{ ...mediaWidthStyle(block.width), borderRadius: block.radius != null ? `${block.radius}px` : undefined }} />
        </div>
      );
    }
    case "video": {
      const src = mediaSrc(block);
      if (!src) {
        return <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-400">Video seçilmedi</div>;
      }
      const autoplay = block.autoplay ?? false;
      return (
        <div className={alignWrap(block.align ?? "center")}>
          <video src={src} className="h-auto rounded-lg bg-black" style={mediaWidthStyle(block.width)} controls={block.controls ?? true} autoPlay={autoplay} muted={(block.muted ?? false) || autoplay} loop={block.loop ?? false} playsInline preload="metadata" />
        </div>
      );
    }
    case "button": {
      const ext = isExternal(block.href);
      const newTab = block.newTab ?? true;
      return (
        <div className={block.fullWidth ? "flex" : alignWrap(block.align ?? "center")}>
          {/* Önizleme: gerçek <a> (müşteri ekranıyla birebir stil) ama gezinmez. */}
          <a
            href={block.href || "#"}
            target={newTab && ext ? "_blank" : undefined}
            rel={newTab && ext ? "noopener noreferrer" : undefined}
            onClick={(e) => e.preventDefault()}
            className={`inline-flex items-center justify-center rounded-xl px-5 py-2.5 text-sm font-semibold shadow-sm transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-4 ${block.fullWidth ? "w-full" : ""}`}
            style={{ backgroundColor: block.bg ?? accent, color: block.color ?? "#ffffff" }}
          >
            {block.label || "Buton"}
          </a>
        </div>
      );
    }
    case "divider":
      return <hr className="border-t" style={{ borderColor: block.color ?? "#e2e8f0" }} />;
    case "spacer":
      return <div aria-hidden="true" style={{ height: block.size === "sm" ? 8 : block.size === "lg" ? 32 : 16 }} />;
    default:
      return null;
  }
}
