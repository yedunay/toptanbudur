import { useEffect, useRef } from "react";
import {
  ArrowDown,
  ArrowUp,
  ImagePlus,
  Sparkles,
  Trash2,
  Video as VideoIcon,
} from "lucide-react";
import { useToast } from "../../Toast";
import {
  MAX_POPUP_BLOCK_IMAGE_BYTES,
  MAX_POPUP_VIDEO_BYTES,
  type PopupAlign,
  type PopupBlockType,
  type PopupCalloutVariant,
} from "../../../lib/popups";
import {
  ADD_BLOCK_ORDER,
  BLOCK_LABELS,
  newBlock,
  screenshotTemplate,
  type EditorBlock,
} from "./block-helpers";

const inputCls =
  "w-full rounded-md border border-[var(--color-border,#e2e8f0)] bg-white px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

interface BlockEditorProps {
  blocks: EditorBlock[];
  onChange: (blocks: EditorBlock[]) => void;
}

export function BlockEditor({ blocks, onChange }: BlockEditorProps) {
  const toast = useToast();
  // Object URL temizliği — bileşen sökülürken revoke.
  const urlsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const urls = urlsRef.current;
    return () => {
      for (const u of urls) URL.revokeObjectURL(u);
    };
  }, []);

  function update(id: string, patch: Partial<EditorBlock>) {
    onChange(
      blocks.map((b) => (b.id === id ? ({ ...b, ...patch } as EditorBlock) : b)),
    );
  }
  function remove(id: string) {
    onChange(blocks.filter((b) => b.id !== id));
  }
  function move(id: string, dir: -1 | 1) {
    const i = blocks.findIndex((b) => b.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }
  function add(type: PopupBlockType) {
    onChange([...blocks, newBlock(type)]);
  }
  function loadTemplate() {
    if (blocks.length > 0 && !window.confirm("Mevcut bloklar örnek şablonla değiştirilsin mi?")) {
      return;
    }
    onChange(screenshotTemplate());
  }

  function pickMedia(id: string, kind: "image" | "video", file: File) {
    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");
    if (kind === "image" && !isImage) {
      toast.push("error", "Lütfen bir görsel dosyası seçin.");
      return;
    }
    if (kind === "video" && !isVideo) {
      toast.push("error", "Lütfen bir video dosyası seçin.");
      return;
    }
    const max = kind === "image" ? MAX_POPUP_BLOCK_IMAGE_BYTES : MAX_POPUP_VIDEO_BYTES;
    if (file.size > max) {
      toast.push(
        "error",
        `${kind === "image" ? "Görsel" : "Video"} en fazla ${Math.floor(max / 1024 / 1024)} MB olabilir.`,
      );
      return;
    }
    const localUrl = URL.createObjectURL(file);
    urlsRef.current.add(localUrl);
    update(id, { _file: file, _localUrl: localUrl, url: "", key: null } as Partial<EditorBlock>);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          İçerik blokları
        </span>
        <button
          type="button"
          onClick={loadTemplate}
          className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
        >
          <Sparkles size={13} />
          Örnek tasarım
        </button>
      </div>

      {blocks.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-3 py-6 text-center text-sm text-slate-500">
          Henüz blok yok. Aşağıdan blok ekleyin veya “Örnek tasarım”ı yükleyin.
          <br />
          Başlık/metin olmadan yalnız görsel veya video da ekleyebilirsiniz.
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {blocks.map((block, i) => (
          <li
            key={block.id}
            className="rounded-lg border border-[var(--color-border,#e2e8f0)] bg-white"
          >
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-1.5">
              <span className="text-xs font-semibold text-slate-600">
                {BLOCK_LABELS[block.type]}
              </span>
              <div className="flex items-center gap-0.5">
                <IconBtn label="Yukarı" disabled={i === 0} onClick={() => move(block.id, -1)}>
                  <ArrowUp size={14} />
                </IconBtn>
                <IconBtn
                  label="Aşağı"
                  disabled={i === blocks.length - 1}
                  onClick={() => move(block.id, 1)}
                >
                  <ArrowDown size={14} />
                </IconBtn>
                <IconBtn label="Sil" danger onClick={() => remove(block.id)}>
                  <Trash2 size={14} />
                </IconBtn>
              </div>
            </div>
            <div className="flex flex-col gap-2 p-3">
              <BlockFields block={block} update={update} pickMedia={pickMedia} />
            </div>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-1.5 rounded-lg border border-[var(--color-border,#e2e8f0)] bg-slate-50/60 p-2">
        {ADD_BLOCK_ORDER.map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => add(type)}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
          >
            + {BLOCK_LABELS[type]}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---- Per-block alan editörleri --------------------------------------------

interface FieldsProps {
  block: EditorBlock;
  update: (id: string, patch: Partial<EditorBlock>) => void;
  pickMedia: (id: string, kind: "image" | "video", file: File) => void;
}

function BlockFields({ block, update, pickMedia }: FieldsProps) {
  const u = (patch: Partial<EditorBlock>) => update(block.id, patch);

  switch (block.type) {
    case "badge":
      return (
        <>
          <input className={inputCls} value={block.text} placeholder="Rozet metni" onChange={(e) => u({ text: e.target.value } as Partial<EditorBlock>)} />
          <Row>
            <AlignField value={block.align} onChange={(align) => u({ align } as Partial<EditorBlock>)} />
            <ColorField label="Arka plan" value={block.bg ?? null} fallback="#16a34a" onChange={(bg) => u({ bg } as Partial<EditorBlock>)} />
            <ColorField label="Yazı" value={block.color ?? null} fallback="#ffffff" onChange={(color) => u({ color } as Partial<EditorBlock>)} />
          </Row>
        </>
      );

    case "heading":
      return (
        <>
          <input className={inputCls} value={block.text} placeholder="Başlık" onChange={(e) => u({ text: e.target.value } as Partial<EditorBlock>)} />
          <Row>
            <Select
              value={String(block.level ?? 2)}
              onChange={(v) => u({ level: Number(v) as 1 | 2 | 3 } as Partial<EditorBlock>)}
              options={[
                ["1", "Büyük (H1)"],
                ["2", "Orta (H2)"],
                ["3", "Küçük (H3)"],
              ]}
            />
            <AlignField value={block.align} onChange={(align) => u({ align } as Partial<EditorBlock>)} />
            <ColorField label="Renk" value={block.color ?? null} fallback="#0f172a" onChange={(color) => u({ color } as Partial<EditorBlock>)} />
          </Row>
        </>
      );

    case "text":
      return (
        <>
          <textarea className={`${inputCls} min-h-[72px] resize-y`} value={block.text} placeholder="Metin… [bağlantı](https://…) ve **kalın** kullanabilirsiniz" onChange={(e) => u({ text: e.target.value } as Partial<EditorBlock>)} />
          <p className="text-[11px] text-slate-400">
            Bağlantı: <code>[buraya tıklayın](https://…)</code> · Kalın: <code>**metin**</code>
          </p>
          <Row>
            <Select
              value={block.size ?? "md"}
              onChange={(v) => u({ size: v as "sm" | "md" | "lg" } as Partial<EditorBlock>)}
              options={[
                ["sm", "Küçük"],
                ["md", "Orta"],
                ["lg", "Büyük"],
              ]}
            />
            <AlignField value={block.align} onChange={(align) => u({ align } as Partial<EditorBlock>)} />
            <ColorField label="Renk" value={block.color ?? null} fallback="#475569" onChange={(color) => u({ color } as Partial<EditorBlock>)} />
          </Row>
        </>
      );

    case "hero":
      return (
        <>
          <input className={inputCls} value={block.title} placeholder="Büyük yazı (örn. 15:00)" onChange={(e) => u({ title: e.target.value } as Partial<EditorBlock>)} />
          <input className={inputCls} value={block.subtitle ?? ""} placeholder="Üst küçük yazı (örn. 27 Haziran 2026)" onChange={(e) => u({ subtitle: e.target.value || null } as Partial<EditorBlock>)} />
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={!!block.gradient} onChange={(e) => u({ gradient: e.target.checked ? ["#fb923c", "#ea580c"] : null } as Partial<EditorBlock>)} />
            Degrade arka plan
          </label>
          <Row>
            {block.gradient ? (
              <>
                <ColorField label="Degrade 1" value={block.gradient[0]} fallback="#fb923c" onChange={(c) => u({ gradient: [c ?? "#fb923c", block.gradient?.[1] ?? "#ea580c"] } as Partial<EditorBlock>)} forceOn />
                <ColorField label="Degrade 2" value={block.gradient[1]} fallback="#ea580c" onChange={(c) => u({ gradient: [block.gradient?.[0] ?? "#fb923c", c ?? "#ea580c"] } as Partial<EditorBlock>)} forceOn />
              </>
            ) : (
              <ColorField label="Arka plan" value={block.bg ?? null} fallback="#2563eb" onChange={(bg) => u({ bg } as Partial<EditorBlock>)} />
            )}
            <ColorField label="Yazı" value={block.color ?? null} fallback="#ffffff" onChange={(color) => u({ color } as Partial<EditorBlock>)} />
            <AlignField value={block.align} onChange={(align) => u({ align } as Partial<EditorBlock>)} />
          </Row>
        </>
      );

    case "callout":
      return (
        <>
          <Select
            value={block.variant ?? "info"}
            onChange={(v) => u({ variant: v as PopupCalloutVariant } as Partial<EditorBlock>)}
            options={[
              ["success", "Yeşil (başarı)"],
              ["info", "Mavi (bilgi)"],
              ["warning", "Sarı (uyarı)"],
              ["danger", "Kırmızı (dikkat)"],
              ["custom", "Özel renk"],
            ]}
          />
          <input className={inputCls} value={block.title ?? ""} placeholder="Kutu başlığı (opsiyonel)" onChange={(e) => u({ title: e.target.value || null } as Partial<EditorBlock>)} />
          <textarea className={`${inputCls} min-h-[64px] resize-y`} value={block.text} placeholder="Kutu metni… [bağlantı](https://…)" onChange={(e) => u({ text: e.target.value } as Partial<EditorBlock>)} />
          {block.variant === "custom" && (
            <Row>
              <ColorField label="Arka plan" value={block.bg ?? null} fallback="#f8fafc" onChange={(bg) => u({ bg } as Partial<EditorBlock>)} />
              <ColorField label="Kenarlık" value={block.borderColor ?? null} fallback="#e2e8f0" onChange={(borderColor) => u({ borderColor } as Partial<EditorBlock>)} />
              <ColorField label="Yazı" value={block.color ?? null} fallback="#0f172a" onChange={(color) => u({ color } as Partial<EditorBlock>)} />
            </Row>
          )}
          <AlignField value={block.align} onChange={(align) => u({ align } as Partial<EditorBlock>)} />
        </>
      );

    case "image":
      return (
        <>
          <MediaPick kind="image" hasMedia={!!(block._localUrl || block.url)} onPick={(f) => pickMedia(block.id, "image", f)} />
          <input className={inputCls} value={block.alt ?? ""} placeholder="Alternatif metin (erişilebilirlik)" onChange={(e) => u({ alt: e.target.value || null } as Partial<EditorBlock>)} />
          <Row>
            <WidthField value={block.width} onChange={(width) => u({ width } as Partial<EditorBlock>)} />
            <NumberField label="Köşe (px)" value={block.radius} min={0} max={48} onChange={(radius) => u({ radius } as Partial<EditorBlock>)} />
            <AlignField value={block.align} onChange={(align) => u({ align } as Partial<EditorBlock>)} />
          </Row>
        </>
      );

    case "video":
      return (
        <>
          <MediaPick kind="video" hasMedia={!!(block._localUrl || block.url)} onPick={(f) => pickMedia(block.id, "video", f)} />
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <Check label="Kontroller" checked={block.controls ?? true} onChange={(controls) => u({ controls } as Partial<EditorBlock>)} />
            <Check label="Otomatik oynat" checked={block.autoplay ?? false} onChange={(autoplay) => u({ autoplay, muted: autoplay ? true : block.muted } as Partial<EditorBlock>)} />
            <Check label="Sessiz" checked={block.muted ?? false} onChange={(muted) => u({ muted } as Partial<EditorBlock>)} />
            <Check label="Döngü" checked={block.loop ?? false} onChange={(loop) => u({ loop } as Partial<EditorBlock>)} />
          </div>
          <Row>
            <WidthField value={block.width} onChange={(width) => u({ width } as Partial<EditorBlock>)} />
            <AlignField value={block.align} onChange={(align) => u({ align } as Partial<EditorBlock>)} />
          </Row>
        </>
      );

    case "button":
      return (
        <>
          <input className={inputCls} value={block.label} placeholder="Buton metni" onChange={(e) => u({ label: e.target.value } as Partial<EditorBlock>)} />
          <input className={inputCls} value={block.href} placeholder="https://… veya /sayfa" onChange={(e) => u({ href: e.target.value } as Partial<EditorBlock>)} />
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <Check label="Yeni sekmede aç" checked={block.newTab ?? true} onChange={(newTab) => u({ newTab } as Partial<EditorBlock>)} />
            <Check label="Tam genişlik" checked={block.fullWidth ?? false} onChange={(fullWidth) => u({ fullWidth } as Partial<EditorBlock>)} />
          </div>
          <Row>
            <ColorField label="Arka plan" value={block.bg ?? null} fallback="#2563eb" onChange={(bg) => u({ bg } as Partial<EditorBlock>)} />
            <ColorField label="Yazı" value={block.color ?? null} fallback="#ffffff" onChange={(color) => u({ color } as Partial<EditorBlock>)} />
            <AlignField value={block.align} onChange={(align) => u({ align } as Partial<EditorBlock>)} />
          </Row>
        </>
      );

    case "divider":
      return <ColorField label="Çizgi rengi" value={block.color ?? null} fallback="#e2e8f0" onChange={(color) => u({ color } as Partial<EditorBlock>)} />;

    case "spacer":
      return (
        <Select
          value={block.size ?? "md"}
          onChange={(v) => u({ size: v as "sm" | "md" | "lg" } as Partial<EditorBlock>)}
          options={[
            ["sm", "Küçük boşluk"],
            ["md", "Orta boşluk"],
            ["lg", "Büyük boşluk"],
          ]}
        />
      );

    default:
      return null;
  }
}

// ---- Küçük UI yardımcıları -------------------------------------------------

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-end gap-2">{children}</div>;
}

function IconBtn({
  children,
  onClick,
  label,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:opacity-30 ${
        danger ? "text-red-500 hover:bg-red-50" : "text-slate-500 hover:bg-slate-100"
      }`}
    >
      {children}
    </button>
  );
}

function AlignField({
  value,
  onChange,
}: {
  value?: PopupAlign;
  onChange: (a: PopupAlign) => void;
}) {
  const opts: [PopupAlign, string][] = [
    ["left", "Sol"],
    ["center", "Orta"],
    ["right", "Sağ"],
  ];
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-slate-500">Hizalama</span>
      <div className="inline-flex overflow-hidden rounded-md border border-slate-200">
        {opts.map(([v, label]) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={`px-2 py-1 text-xs ${
              (value ?? "left") === v ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ColorField({
  label,
  value,
  fallback,
  onChange,
  forceOn,
}: {
  label: string;
  value: string | null;
  fallback: string;
  onChange: (c: string | null) => void;
  forceOn?: boolean;
}) {
  const on = forceOn || value != null;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-slate-500">{label}</span>
      <div className="flex items-center gap-1.5">
        {!forceOn && (
          <input
            type="checkbox"
            checked={on}
            onChange={(e) => onChange(e.target.checked ? fallback : null)}
            aria-label={`${label} özel renk`}
          />
        )}
        <input
          type="color"
          value={value ?? fallback}
          disabled={!on}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 w-9 cursor-pointer rounded border border-slate-200 bg-white disabled:opacity-40"
        />
      </div>
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <select className={`${inputCls} w-auto`} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (b: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-700">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number | undefined;
  min: number;
  max: number;
  onChange: (n: number | undefined) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-slate-500">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value ?? ""}
        placeholder="—"
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") return onChange(undefined);
          onChange(Math.max(min, Math.min(max, Number(raw) || 0)));
        }}
        className={`${inputCls} w-20`}
      />
    </div>
  );
}

function WidthField({
  value,
  onChange,
}: {
  value: "full" | number | undefined;
  onChange: (w: "full" | number) => void;
}) {
  const isCustom = typeof value === "number";
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-slate-500">Genişlik</span>
      <div className="flex items-center gap-1.5">
        <select
          className={`${inputCls} w-auto`}
          value={isCustom ? "custom" : "full"}
          onChange={(e) => onChange(e.target.value === "custom" ? 320 : "full")}
        >
          <option value="full">Tam</option>
          <option value="custom">Özel (px)</option>
        </select>
        {isCustom && (
          <input
            type="number"
            min={40}
            max={1200}
            value={value}
            onChange={(e) => onChange(Math.max(40, Math.min(1200, Number(e.target.value) || 40)))}
            className={`${inputCls} w-20`}
          />
        )}
      </div>
    </div>
  );
}

function MediaPick({
  kind,
  hasMedia,
  onPick,
}: {
  kind: "image" | "video";
  hasMedia: boolean;
  onPick: (f: File) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div>
      <input
        ref={ref}
        type="file"
        accept={kind === "image" ? "image/png,image/jpeg,image/webp" : "video/mp4,video/webm"}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onPick(f);
        }}
      />
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        {kind === "image" ? <ImagePlus size={15} /> : <VideoIcon size={15} />}
        {hasMedia
          ? kind === "image"
            ? "Görseli değiştir"
            : "Videoyu değiştir"
          : kind === "image"
            ? "Görsel yükle"
            : "Video yükle"}
      </button>
      <p className="mt-1 text-[11px] text-slate-400">
        {kind === "image" ? "PNG / JPEG / WEBP · en fazla 8 MB" : "MP4 / WEBM · en fazla 30 MB"}
      </p>
    </div>
  );
}
