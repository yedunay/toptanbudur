import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Save, X } from "lucide-react";
import { useToast } from "../Toast";
import { PopupPreview } from "./PopupPreview";
import { CustomerPicker } from "./CustomerPicker";
import { BlockEditor } from "./blocks/BlockEditor";
import {
  blocksFromPopup,
  serializeBlocks,
  type EditorBlock,
} from "./blocks/block-helpers";
import {
  createPopup,
  updatePopup,
  uploadPopupMedia,
  POPUP_AUDIENCE_LABELS,
  POPUP_FREQUENCY_LABELS,
  POPUP_POSITION_LABELS,
  POPUP_SIZE_LABELS,
  type CreatePopupInput,
  type Popup,
  type PopupAudience,
  type PopupFrequency,
  type PopupPosition,
  type PopupSize,
} from "../../lib/popups";

interface PopupFormDialogProps {
  /** null/undefined → yeni oluştur; aksi halde düzenle. */
  popup: Popup | null;
  onClose: () => void;
}

interface FormState {
  title: string;
  blocks: EditorBlock[];
  position: PopupPosition;
  size: PopupSize;
  useCustomWidth: boolean;
  widthPx: number;
  useBg: boolean;
  backgroundColor: string;
  frequency: PopupFrequency;
  showLimit: number;
  dismissible: boolean;
  audience: PopupAudience;
  segment: string;
  customerIds: string[];
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  priority: number;
  useThemeColor: boolean;
  themeColor: string;
}

const DEFAULT_THEME = "#2563eb";
const DEFAULT_BG = "#ffffff";
const DEFAULT_WIDTH = 480;

const inputCls =
  "w-full rounded-md border border-[var(--color-border,#e2e8f0)] bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function initialForm(popup: Popup | null): FormState {
  if (!popup) {
    return {
      title: "",
      blocks: [],
      position: "CENTER",
      size: "MEDIUM",
      useCustomWidth: false,
      widthPx: DEFAULT_WIDTH,
      useBg: false,
      backgroundColor: DEFAULT_BG,
      frequency: "ONCE",
      showLimit: 3,
      dismissible: true,
      audience: "ALL",
      segment: "",
      customerIds: [],
      startsAt: "",
      endsAt: "",
      isActive: true,
      priority: 0,
      useThemeColor: false,
      themeColor: DEFAULT_THEME,
    };
  }
  return {
    title: popup.title ?? "",
    blocks: blocksFromPopup(popup),
    position: popup.position,
    size: popup.size,
    useCustomWidth: popup.widthPx != null,
    widthPx: popup.widthPx ?? DEFAULT_WIDTH,
    useBg: Boolean(popup.backgroundColor),
    backgroundColor: popup.backgroundColor ?? DEFAULT_BG,
    frequency: popup.frequency,
    showLimit: popup.showLimit || 3,
    dismissible: popup.dismissible,
    audience: popup.audience,
    segment: popup.segment ?? "",
    customerIds: popup.customerIds ?? [],
    startsAt: toLocalInput(popup.startsAt),
    endsAt: toLocalInput(popup.endsAt),
    isActive: popup.isActive,
    priority: popup.priority,
    useThemeColor: Boolean(popup.themeColor),
    themeColor: popup.themeColor ?? DEFAULT_THEME,
  };
}

// http(s):// ya da tek "/" (dahili) — backend buttonHref ile aynı kural.
const URL_RE = /^(https?:\/\/|\/(?!\/))/;

function validate(form: FormState): string | null {
  if (form.blocks.length === 0) {
    return "En az bir içerik bloğu ekleyin (metin, görsel, video…).";
  }
  for (const b of form.blocks) {
    if ((b.type === "image" || b.type === "video") && !b._file && !b.url) {
      return `${b.type === "image" ? "Görsel" : "Video"} bloğu için bir dosya yükleyin ya da bloğu silin.`;
    }
    if (b.type === "badge" && !b.text.trim()) return "Rozet metni boş olamaz.";
    if (b.type === "heading" && !b.text.trim()) return "Başlık bloğu boş olamaz.";
    if (b.type === "text" && !b.text.trim()) return "Metin bloğu boş olamaz.";
    if (b.type === "hero" && !b.title.trim()) return "Hero kutusunun büyük yazısı boş olamaz.";
    if (b.type === "callout" && !b.text.trim()) return "Bilgi kutusu metni boş olamaz.";
    if (b.type === "button") {
      if (!b.label.trim()) return "Buton metni boş olamaz.";
      if (!URL_RE.test(b.href.trim())) {
        return "Buton linki http(s):// ile başlamalı veya / ile başlayan dahili yol olmalı.";
      }
    }
  }
  if (form.audience === "SEGMENT" && !form.segment.trim()) {
    return "Segment / sektör numarası hedeflemesi için bir değer girin.";
  }
  if (form.audience === "SPECIFIC" && form.customerIds.length === 0) {
    return "En az bir müşteri seçmelisiniz.";
  }
  if (form.frequency === "LIMITED" && (form.showLimit < 1 || form.showLimit > 100)) {
    return "Gösterim sayısı 1 ile 100 arasında olmalı.";
  }
  if (form.useCustomWidth && (form.widthPx < 280 || form.widthPx > 1200)) {
    return "Özel genişlik 280 ile 1200 piksel arasında olmalı.";
  }
  if (form.startsAt && form.endsAt) {
    const start = new Date(form.startsAt).getTime();
    const end = new Date(form.endsAt).getTime();
    if (Number.isFinite(start) && Number.isFinite(end) && end <= start) {
      return "Bitiş tarihi başlangıç tarihinden sonra olmalı.";
    }
  }
  return null;
}

/** content dışındaki tüm ayarlar (title dahil). */
function baseSettings(form: FormState): Omit<CreatePopupInput, "content"> {
  return {
    title: form.title.trim() || null,
    body: null,
    ctaLabel: null,
    ctaUrl: null,
    position: form.position,
    size: form.size,
    widthPx: form.useCustomWidth ? form.widthPx : null,
    backgroundColor: form.useBg ? form.backgroundColor : null,
    frequency: form.frequency,
    showLimit: form.frequency === "LIMITED" ? form.showLimit : 1,
    dismissible: form.dismissible,
    audience: form.audience,
    segment: form.audience === "SEGMENT" ? form.segment.trim() : null,
    customerIds: form.audience === "SPECIFIC" ? form.customerIds : [],
    startsAt: fromLocalInput(form.startsAt),
    endsAt: fromLocalInput(form.endsAt),
    isActive: form.isActive,
    priority: form.priority,
    themeColor: form.useThemeColor ? form.themeColor : null,
  };
}

export function PopupFormDialog({ popup, onClose }: PopupFormDialogProps) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(() => initialForm(popup));
  const [formError, setFormError] = useState<string | null>(null);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  /** Bir popup'a bekleyen medya bloklarını yükler; url/key set edilmiş blokları döner. */
  async function uploadPendingMedia(
    popupId: string,
    blocks: EditorBlock[],
  ): Promise<EditorBlock[]> {
    let out = blocks;
    for (const b of blocks) {
      if ((b.type === "image" || b.type === "video") && b._file) {
        const up = await uploadPopupMedia(popupId, b._file);
        out = out.map((x) =>
          x.id === b.id
            ? ({
                ...x,
                url: up.url,
                key: up.key,
                _file: undefined,
                _localUrl: undefined,
              } as EditorBlock)
            : x,
        );
      }
    }
    return out;
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const base = baseSettings(form);
      const hasPending = form.blocks.some(
        (b) => (b.type === "image" || b.type === "video") && b._file,
      );

      if (popup) {
        // DÜZENLE: önce bekleyen medyayı yükle, sonra tam içeriği kaydet.
        const uploaded = await uploadPendingMedia(popup.id, form.blocks);
        await updatePopup(popup.id, { ...base, content: serializeBlocks(uploaded) });
        return;
      }

      // YENİ: bekleyen medya yoksa tek çağrı.
      if (!hasPending) {
        await createPopup({ ...base, content: serializeBlocks(form.blocks) });
        return;
      }

      // YENİ + bekleyen medya: pasif iskelet oluştur → medya yükle → tam kaydet.
      const phase1 = serializeBlocks(form.blocks); // bekleyen medya bloklarını atar
      const phase1Title =
        base.title && base.title.trim()
          ? base.title
          : phase1.length === 0
            ? "—"
            : base.title;
      const created = await createPopup({
        ...base,
        title: phase1Title ?? "—",
        content: phase1,
        isActive: false,
      });
      const uploaded = await uploadPendingMedia(created.id, form.blocks);
      await updatePopup(created.id, { ...base, content: serializeBlocks(uploaded) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["popups"] });
      toast.push("success", popup ? "Pop-up güncellendi." : "Pop-up oluşturuldu.");
      onClose();
    },
    onError: (err) => {
      toast.push("error", err instanceof Error ? err.message : "İşlem başarısız oldu.");
    },
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const error = validate(form);
    if (error) {
      setFormError(error);
      return;
    }
    setFormError(null);
    mutation.mutate();
  }

  const positionOptions = useMemo(
    () => Object.entries(POPUP_POSITION_LABELS) as [PopupPosition, string][],
    [],
  );
  const sizeOptions = useMemo(
    () => Object.entries(POPUP_SIZE_LABELS) as [PopupSize, string][],
    [],
  );
  const frequencyOptions = useMemo(
    () => Object.entries(POPUP_FREQUENCY_LABELS) as [PopupFrequency, string][],
    [],
  );
  const audienceOptions = useMemo(
    () => Object.entries(POPUP_AUDIENCE_LABELS) as [PopupAudience, string][],
    [],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--color-border,#e2e8f0)] px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">
            {popup ? "Pop-up'ı Düzenle" : "Yeni Pop-up"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Kapat"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="grid min-h-0 flex-1 gap-6 overflow-y-auto p-6 md:grid-cols-2">
            {/* SOL: editör */}
            <div className="flex flex-col gap-5">
              <Section title="Tasarım (bloklar)">
                <BlockEditor blocks={form.blocks} onChange={(blocks) => update("blocks", blocks)} />
              </Section>

              <Section title="Boyut, genişlik & arka plan">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Ekrandaki konum">
                    <select className={inputCls} value={form.position} onChange={(e) => update("position", e.target.value as PopupPosition)}>
                      {positionOptions.map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Boyut ön ayarı" hint={form.useCustomWidth ? "Özel genişlik aktif" : undefined}>
                    <select className={inputCls} value={form.size} disabled={form.useCustomWidth} onChange={(e) => update("size", e.target.value as PopupSize)}>
                      {sizeOptions.map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </Field>
                </div>

                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={form.useCustomWidth} onChange={(e) => update("useCustomWidth", e.target.checked)} />
                  Özel genişlik (px) — ölçü standarda bağlı kalmaz
                </label>
                {form.useCustomWidth && (
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={280}
                      max={1200}
                      step={10}
                      value={form.widthPx}
                      onChange={(e) => update("widthPx", Number(e.target.value))}
                      className="flex-1"
                    />
                    <input
                      type="number"
                      min={280}
                      max={1200}
                      value={form.widthPx}
                      onChange={(e) => update("widthPx", Math.max(280, Math.min(1200, Number(e.target.value) || 280)))}
                      className={`${inputCls} w-24`}
                    />
                    <span className="text-xs text-slate-400">px</span>
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={form.useBg} onChange={(e) => update("useBg", e.target.checked)} />
                    Kart arka plan rengi
                  </label>
                  {form.useBg && (
                    <input type="color" value={form.backgroundColor} onChange={(e) => update("backgroundColor", e.target.value)} className="h-8 w-12 cursor-pointer rounded border border-[var(--color-border,#e2e8f0)] bg-white" aria-label="Arka plan rengi" />
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={form.useThemeColor} onChange={(e) => update("useThemeColor", e.target.checked)} />
                    Tema aksan rengi (buton/rozet/link varsayılanı)
                  </label>
                  {form.useThemeColor && (
                    <input type="color" value={form.themeColor} onChange={(e) => update("themeColor", e.target.value)} className="h-8 w-12 cursor-pointer rounded border border-[var(--color-border,#e2e8f0)] bg-white" aria-label="Aksan rengi" />
                  )}
                </div>

                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={form.dismissible} onChange={(e) => update("dismissible", e.target.checked)} />
                  Müşteri kapatabilsin (X butonu)
                </label>
              </Section>

              <Section title="Yönetim etiketi (opsiyonel)">
                <Field label="Başlık" hint="Yalnız admin listesinde görünür; müşteri ekranını blok tasarımı belirler.">
                  <input className={inputCls} value={form.title} maxLength={200} onChange={(e) => update("title", e.target.value)} placeholder="Örn. Stok aktivasyon duyurusu" />
                </Field>
              </Section>

              <Section title="Gösterim sıklığı">
                <Field label="Sıklık">
                  <select className={inputCls} value={form.frequency} onChange={(e) => update("frequency", e.target.value as PopupFrequency)}>
                    {frequencyOptions.map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </Field>
                {form.frequency === "LIMITED" && (
                  <Field label="Kaç kez gösterilsin?" hint="Müşteri başına 1–100">
                    <input type="number" min={1} max={100} className={inputCls} value={form.showLimit} onChange={(e) => update("showLimit", Math.max(1, Math.min(100, Number(e.target.value) || 1)))} />
                  </Field>
                )}
              </Section>

              <Section title="Zamanlama (opsiyonel)">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Başlangıç" hint="Boş = hemen">
                    <input type="datetime-local" className={inputCls} value={form.startsAt} onChange={(e) => update("startsAt", e.target.value)} />
                  </Field>
                  <Field label="Bitiş" hint="Boş = süresiz">
                    <input type="datetime-local" className={inputCls} value={form.endsAt} onChange={(e) => update("endsAt", e.target.value)} />
                  </Field>
                </div>
              </Section>

              <Section title="Hedef kitle">
                <Field label="Kimlere gösterilsin?">
                  <select className={inputCls} value={form.audience} onChange={(e) => update("audience", e.target.value as PopupAudience)}>
                    {audienceOptions.map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </Field>
                {form.audience === "SEGMENT" && (
                  <Field label="Segment / sektör numarası">
                    <input className={inputCls} value={form.segment} maxLength={120} onChange={(e) => update("segment", e.target.value)} placeholder="Örn. 12 veya elektronik" />
                  </Field>
                )}
                {form.audience === "SPECIFIC" && (
                  <CustomerPicker selectedIds={form.customerIds} onChange={(ids) => update("customerIds", ids)} />
                )}
              </Section>

              <Section title="Durum">
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={form.isActive} onChange={(e) => update("isActive", e.target.checked)} />
                    Aktif
                  </label>
                  <Field label="Öncelik" hint="Yüksek = önce gösterilir">
                    <input type="number" min={0} max={1000} className={inputCls} value={form.priority} onChange={(e) => update("priority", Math.max(0, Math.min(1000, Number(e.target.value) || 0)))} />
                  </Field>
                </div>
              </Section>
            </div>

            {/* SAĞ: önizleme (sticky) */}
            <div className="md:sticky md:top-0 md:self-start">
              <PopupPreview
                blocks={form.blocks}
                title={form.title}
                position={form.position}
                size={form.size}
                widthPx={form.useCustomWidth ? form.widthPx : null}
                backgroundColor={form.useBg ? form.backgroundColor : null}
                dismissible={form.dismissible}
                themeColor={form.useThemeColor ? form.themeColor : null}
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-[var(--color-border,#e2e8f0)] px-6 py-4">
            <span className="text-sm text-red-600">{formError ?? ""}</span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={onClose} className="rounded-md border border-[var(--color-border,#e2e8f0)] bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                İptal
              </button>
              <button type="submit" disabled={mutation.isPending} className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-60">
                {mutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                {popup ? "Kaydet" : "Oluştur"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

interface SectionProps {
  title: string;
  children: React.ReactNode;
}
function Section({ title, children }: SectionProps) {
  return (
    <fieldset className="flex flex-col gap-3 rounded-xl border border-[var(--color-border,#e2e8f0)] p-4">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</legend>
      {children}
    </fieldset>
  );
}

interface FieldProps {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}
function Field({ label, hint, required, children }: FieldProps) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}
