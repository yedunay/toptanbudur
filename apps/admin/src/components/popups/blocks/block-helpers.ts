import type {
  Popup,
  PopupBlock,
  PopupBlockType,
  PopupImageBlock,
  PopupVideoBlock,
} from "../../../lib/popups";

/** Düzenleyicide kullanılan blok (geçici medya alanları dahil). */
export type EditorBlock = PopupBlock & { id: string };

let counter = 0;
export function genId(): string {
  counter += 1;
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
  } catch {
    /* yoksay */
  }
  return `b${Date.now().toString(36)}${counter}`;
}

export const BLOCK_LABELS: Record<PopupBlockType, string> = {
  badge: "Rozet",
  heading: "Başlık",
  text: "Metin",
  hero: "Hero kutu",
  callout: "Bilgi kutusu",
  image: "Görsel",
  video: "Video",
  button: "Buton",
  divider: "Ayraç",
  spacer: "Boşluk",
};

/** "Blok ekle" araç çubuğundaki sıralama. */
export const ADD_BLOCK_ORDER: PopupBlockType[] = [
  "text",
  "heading",
  "badge",
  "hero",
  "callout",
  "image",
  "video",
  "button",
  "divider",
  "spacer",
];

/** Belirtilen türde, makul varsayılanlarla yeni bir blok üretir. */
export function newBlock(type: PopupBlockType): EditorBlock {
  const id = genId();
  switch (type) {
    case "badge":
      return { id, type: "badge", text: "Önemli Duyuru", bg: "#16a34a", color: "#ffffff", align: "center" };
    case "heading":
      return { id, type: "heading", text: "Başlık", level: 2, align: "center" };
    case "text":
      return {
        id,
        type: "text",
        text: "Metni buraya yazın. **kalın** ve [bağlantı](https://toptanbudur.com) ekleyebilirsiniz.",
        align: "center",
      };
    case "hero":
      return {
        id,
        type: "hero",
        title: "15:00",
        subtitle: "27 Haziran 2026 Cumartesi",
        gradient: ["#fb923c", "#ea580c"],
        color: "#ffffff",
        align: "center",
      };
    case "callout":
      return { id, type: "callout", variant: "success", text: "Bilgilendirme metni…", align: "center" };
    case "image":
      return { id, type: "image", url: "", width: "full", align: "center" };
    case "video":
      return { id, type: "video", url: "", controls: true, width: "full", align: "center" };
    case "button":
      return { id, type: "button", label: "Anladım", href: "/", newTab: false, fullWidth: true, bg: "#0f172a", color: "#ffffff", align: "center" };
    case "divider":
      return { id, type: "divider" };
    case "spacer":
      return { id, type: "spacer", size: "md" };
    default:
      return { id, type: "text", text: "" };
  }
}

/** Ekran görüntüsündeki tarz hazır şablon (rozet + hero + renkli kutular + buton). */
export function screenshotTemplate(): EditorBlock[] {
  return [
    { id: genId(), type: "badge", text: "Önemli Duyuru", bg: "#16a34a", color: "#ffffff", align: "center" },
    { id: genId(), type: "heading", text: "Stoklar Yeniden Aktif Edildi", level: 2, align: "center" },
    {
      id: genId(),
      type: "hero",
      title: "15:00",
      subtitle: "27 Haziran 2026 Cumartesi",
      gradient: ["#fb923c", "#ea580c"],
      color: "#ffffff",
      align: "center",
    },
    {
      id: genId(),
      type: "text",
      text: "Ankara depo etiketli ilgili ürünlerin stokları belirtilen tarih ve saat itibarıyla yeniden aktif edilecektir.",
      align: "center",
    },
    {
      id: genId(),
      type: "callout",
      variant: "success",
      text: "Tüm bayilerimizin bu tarih itibarıyla stoklarını güncellemesi ve ilgili ürünleri satışa açması gerekmektedir.",
      align: "center",
    },
    {
      id: genId(),
      type: "callout",
      variant: "danger",
      text: "Güncellemeler için panelinizi ve WhatsApp Duyuru Kanalımızı takip etmeyi unutmayınız. Duyuru kanalını takip etmek için [buraya tıklayınız](https://toptanbudur.com).",
      align: "center",
    },
    { id: genId(), type: "button", label: "Anladım", href: "/", newTab: false, fullWidth: true, bg: "#0f172a", color: "#ffffff", align: "center" },
  ];
}

/** Mevcut bir pop-up'ı düzenleyici bloklarına çevirir (legacy → blok migrasyonu). */
export function blocksFromPopup(popup: Popup): EditorBlock[] {
  // Yeni blok içeriği varsa onu kullan (id'leri garanti et).
  if (Array.isArray(popup.content) && popup.content.length > 0) {
    return popup.content.map((b) => ({ ...b, id: b.id || genId() }) as EditorBlock);
  }
  // Legacy alanları bloklara migrate et.
  const out: EditorBlock[] = [];
  if (popup.title && popup.title.trim()) {
    out.push({ id: genId(), type: "heading", text: popup.title, level: 2, align: "center" });
  }
  if (popup.body && popup.body.trim()) {
    out.push({ id: genId(), type: "text", text: popup.body, align: "center" });
  }
  if (popup.imageUrl) {
    out.push({
      id: genId(),
      type: "image",
      key: popup.imageKey ?? null,
      url: popup.imageUrl,
      width: "full",
      align: "center",
    });
  }
  if (popup.ctaLabel && popup.ctaUrl) {
    out.push({
      id: genId(),
      type: "button",
      label: popup.ctaLabel,
      href: popup.ctaUrl,
      newTab: popup.ctaNewTab,
      fullWidth: true,
      align: "center",
    });
  }
  return out;
}

export function isMediaBlock(
  b: PopupBlock,
): b is PopupImageBlock | PopupVideoBlock {
  return b.type === "image" || b.type === "video";
}

/** Bloğun henüz yüklenmemiş (yerel dosyalı / boş url) bir medya bloğu olup olmadığı. */
export function isPendingMedia(b: PopupBlock): boolean {
  if (!isMediaBlock(b)) return false;
  return !!b._file || !b.url || b.url.startsWith("blob:");
}

/** Backend'e gönderilecek temiz blok (geçici alanlar strip edilir; id korunur). */
export function cleanBlock(b: EditorBlock): PopupBlock {
  if (b.type === "image" || b.type === "video") {
    const { _file, _localUrl, ...rest } = b;
    void _file;
    void _localUrl;
    return rest;
  }
  return b;
}

/**
 * Tüm bloklar (medya yüklemeden sonra) → temiz dizi. Hâlâ boş url'li medya
 * blokları savunma amaçlı atılır (geçersiz url backend'i 400'lemesin).
 */
export function serializeBlocks(blocks: EditorBlock[]): PopupBlock[] {
  return blocks
    .filter((b) => !isPendingMedia(b))
    .map(cleanBlock);
}
