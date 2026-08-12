import { BadRequestException } from '@nestjs/common';

/**
 * Pop-up "blok" içerik modeli — görsel blok düzenleyicinin tek doğruluk kaynağı.
 *
 * NEDEN BLOK MODELİ (ham HTML DEĞİL): içerik TÜM müşterilere render edilir.
 * Ham HTML + dangerouslySetInnerHTML XSS kapısıdır. Bunun yerine her blok
 * bilinen alanlara sahip yapısal bir nesnedir; müşteri/preview renderer'ı bu
 * alanları güvenli React'e map'ler. Satır içi link/kalın yazı, blok metninde
 * güvenli bir "mini-markdown" alt kümesiyle (`[etiket](url)`, `**kalın**`, satır
 * sonu) ifade edilir ve renderer tarafında parse edilir — asla ham HTML olarak.
 *
 * Bu dosya hem doğrulama (create/update gövdesi) hem medya-anahtarı toplama
 * (otomatik temizlik) için kullanılır. Renderer'lar (apps/frontend +
 * apps/admin) AYNI sözleşmeyi mirror'lar; sürüklenme olmaması için blok şekli
 * burada kanonik tutulur.
 */

export type PopupAlign = 'left' | 'center' | 'right';
export type PopupTextSize = 'sm' | 'md' | 'lg';
export type PopupSpacerSize = 'sm' | 'md' | 'lg';
export type PopupCalloutVariant =
  | 'success'
  | 'warning'
  | 'info'
  | 'danger'
  | 'custom';

export interface PopupBadgeBlock {
  type: 'badge';
  id?: string;
  text: string;
  bg?: string | null;
  color?: string | null;
  align?: PopupAlign;
}

export interface PopupHeadingBlock {
  type: 'heading';
  id?: string;
  text: string;
  level?: 1 | 2 | 3;
  align?: PopupAlign;
  color?: string | null;
}

/** Mini-markdown destekli paragraf: `[etiket](url)`, `**kalın**`, satır sonu. */
export interface PopupTextBlock {
  type: 'text';
  id?: string;
  text: string;
  align?: PopupAlign;
  color?: string | null;
  size?: PopupTextSize;
}

export interface PopupHeroBlock {
  type: 'hero';
  id?: string;
  title: string;
  subtitle?: string | null;
  bg?: string | null;
  gradient?: [string, string] | null;
  color?: string | null;
  align?: PopupAlign;
}

/** Renkli bilgi kutusu — mini-markdown destekli. */
export interface PopupCalloutBlock {
  type: 'callout';
  id?: string;
  variant?: PopupCalloutVariant;
  title?: string | null;
  text: string;
  bg?: string | null;
  color?: string | null;
  borderColor?: string | null;
  align?: PopupAlign;
}

export interface PopupImageBlock {
  type: 'image';
  id?: string;
  /** Storage anahtarı (`popups/<uuid>.<ext>`) — otomatik temizlik için. */
  key?: string | null;
  url: string;
  alt?: string | null;
  width?: 'full' | number;
  radius?: number;
  align?: PopupAlign;
}

export interface PopupVideoBlock {
  type: 'video';
  id?: string;
  key?: string | null;
  url: string;
  autoplay?: boolean;
  muted?: boolean;
  loop?: boolean;
  controls?: boolean;
  width?: 'full' | number;
  align?: PopupAlign;
}

export interface PopupButtonBlock {
  type: 'button';
  id?: string;
  label: string;
  href: string;
  bg?: string | null;
  color?: string | null;
  newTab?: boolean;
  align?: PopupAlign;
  fullWidth?: boolean;
}

export interface PopupDividerBlock {
  type: 'divider';
  id?: string;
  color?: string | null;
}

export interface PopupSpacerBlock {
  type: 'spacer';
  id?: string;
  size?: PopupSpacerSize;
}

export type PopupBlock =
  | PopupBadgeBlock
  | PopupHeadingBlock
  | PopupTextBlock
  | PopupHeroBlock
  | PopupCalloutBlock
  | PopupImageBlock
  | PopupVideoBlock
  | PopupButtonBlock
  | PopupDividerBlock
  | PopupSpacerBlock;

// ---- Sınırlar -------------------------------------------------------------

export const MAX_POPUP_BLOCKS = 40;

const LIMITS = {
  badge: 80,
  heading: 300,
  text: 4000,
  heroTitle: 200,
  heroSubtitle: 400,
  calloutTitle: 200,
  callout: 2000,
  buttonLabel: 120,
  href: 2000,
  imageAlt: 200,
  url: 2000,
  id: 64,
  key: 256,
} as const;

const ALIGNS: PopupAlign[] = ['left', 'center', 'right'];
const TEXT_SIZES: PopupTextSize[] = ['sm', 'md', 'lg'];
const SPACER_SIZES: PopupSpacerSize[] = ['sm', 'md', 'lg'];
const CALLOUT_VARIANTS: PopupCalloutVariant[] = [
  'success',
  'warning',
  'info',
  'danger',
  'custom',
];

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// ---- Küçük temizleyiciler -------------------------------------------------

function bad(msg: string): never {
  throw new BadRequestException(msg);
}

function asString(v: unknown, max: number, field: string): string {
  if (typeof v !== 'string') bad(`${field} metin olmalı`);
  const s = (v as string).trim();
  if (s.length > max) bad(`${field} en fazla ${max} karakter olabilir`);
  return s;
}

/** Zorunlu metin alanı — boş olamaz (admin preview placeholder'ı kaydedilmesin). */
function reqString(v: unknown, max: number, field: string): string {
  const s = asString(v, max, field);
  if (s.length === 0) bad(`${field} boş olamaz`);
  return s;
}

function optString(
  v: unknown,
  max: number,
  field: string,
): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  return asString(v, max, field);
}

function color(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim().toLowerCase();
  return HEX_RE.test(s) ? s : undefined;
}

function align(v: unknown): PopupAlign | undefined {
  return typeof v === 'string' && (ALIGNS as string[]).includes(v)
    ? (v as PopupAlign)
    : undefined;
}

function bool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

function widthOf(v: unknown): 'full' | number | undefined {
  if (v === 'full') return 'full';
  if (typeof v === 'number' && Number.isFinite(v)) {
    return Math.max(40, Math.min(1200, Math.round(v)));
  }
  return undefined;
}

/**
 * Buton hedefi: yalnızca http(s):// ya da tek "/" ile başlayan dahili yol.
 * "//host" (protokol-göreli cross-origin) ve `javascript:` reddedilir.
 * (assertCta ile birebir aynı kural.)
 */
function buttonHref(v: unknown): string {
  const s = asString(v, LIMITS.href, 'Buton bağlantısı');
  const ok =
    s.startsWith('http://') ||
    s.startsWith('https://') ||
    (s.startsWith('/') && !s.startsWith('//'));
  if (!ok) bad('Buton bağlantısı http(s):// ile veya / ile başlamalı');
  return s;
}

/**
 * Medya URL'i: yalnızca dahili durable storage yolu ya da https. Admin
 * yükleme akışı getPublicUrl() döndürür (`/api/storage-public/popups/...`
 * veya R2 CDN `https://...`). Başka bir şey reddedilir (SSRF/karışık-içerik
 * yüzeyi açmamak için).
 */
function mediaUrl(v: unknown): string {
  const s = asString(v, LIMITS.url, 'Medya bağlantısı');
  const ok = s.startsWith('/api/storage-public/') || s.startsWith('https://');
  if (!ok) bad('Geçersiz medya bağlantısı');
  return s;
}

function mediaKey(v: unknown): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const s = asString(v, LIMITS.key, 'Medya anahtarı');
  // Tüm pop-up medyası `popups/` ön ekinde tutulur (path-traversal engellenir).
  if (!s.startsWith('popups/') || s.includes('..')) {
    bad('Geçersiz medya anahtarı');
  }
  return s;
}

function idOf(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  if (!s || s.length > LIMITS.id) return undefined;
  return s;
}

/** undefined alanları çıkararak temiz bir blok döndürür (Json'da gürültü olmasın). */
function prune<T extends Record<string, unknown>>(obj: T): T {
  for (const k of Object.keys(obj)) {
    if (obj[k] === undefined) delete obj[k];
  }
  return obj;
}

// ---- Blok doğrulayıcılar --------------------------------------------------

function validateBlock(raw: unknown, i: number): PopupBlock {
  if (!raw || typeof raw !== 'object') bad(`Blok #${i + 1} geçersiz`);
  const b = raw as Record<string, unknown>;
  const id = idOf(b.id);
  const a = align(b.align);

  switch (b.type) {
    case 'badge':
      return prune({
        type: 'badge',
        id,
        text: reqString(b.text, LIMITS.badge, 'Rozet metni'),
        bg: color(b.bg) ?? null,
        color: color(b.color) ?? null,
        align: a,
      }) as PopupBadgeBlock;

    case 'heading': {
      const level = b.level === 1 || b.level === 2 || b.level === 3 ? b.level : 2;
      return prune({
        type: 'heading',
        id,
        text: reqString(b.text, LIMITS.heading, 'Başlık'),
        level,
        align: a,
        color: color(b.color) ?? null,
      }) as PopupHeadingBlock;
    }

    case 'text':
      return prune({
        type: 'text',
        id,
        text: reqString(b.text, LIMITS.text, 'Metin'),
        align: a,
        color: color(b.color) ?? null,
        size: TEXT_SIZES.includes(b.size as PopupTextSize)
          ? (b.size as PopupTextSize)
          : undefined,
      }) as PopupTextBlock;

    case 'hero': {
      let gradient: [string, string] | null = null;
      if (Array.isArray(b.gradient) && b.gradient.length === 2) {
        const g0 = color(b.gradient[0]);
        const g1 = color(b.gradient[1]);
        if (g0 && g1) gradient = [g0, g1];
      }
      return prune({
        type: 'hero',
        id,
        title: reqString(b.title, LIMITS.heroTitle, 'Hero başlığı'),
        subtitle: optString(b.subtitle, LIMITS.heroSubtitle, 'Hero alt metni') ?? null,
        bg: color(b.bg) ?? null,
        gradient,
        color: color(b.color) ?? null,
        align: a,
      }) as PopupHeroBlock;
    }

    case 'callout':
      return prune({
        type: 'callout',
        id,
        variant: CALLOUT_VARIANTS.includes(b.variant as PopupCalloutVariant)
          ? (b.variant as PopupCalloutVariant)
          : 'info',
        title: optString(b.title, LIMITS.calloutTitle, 'Kutu başlığı') ?? null,
        text: reqString(b.text, LIMITS.callout, 'Kutu metni'),
        bg: color(b.bg) ?? null,
        color: color(b.color) ?? null,
        borderColor: color(b.borderColor) ?? null,
        align: a,
      }) as PopupCalloutBlock;

    case 'image':
      return prune({
        type: 'image',
        id,
        key: mediaKey(b.key) ?? null,
        url: mediaUrl(b.url),
        alt: optString(b.alt, LIMITS.imageAlt, 'Görsel alt metni') ?? null,
        width: widthOf(b.width) ?? 'full',
        radius:
          typeof b.radius === 'number' && Number.isFinite(b.radius)
            ? Math.max(0, Math.min(48, Math.round(b.radius)))
            : undefined,
        align: a,
      }) as PopupImageBlock;

    case 'video':
      return prune({
        type: 'video',
        id,
        key: mediaKey(b.key) ?? null,
        url: mediaUrl(b.url),
        autoplay: bool(b.autoplay),
        muted: bool(b.muted),
        loop: bool(b.loop),
        controls: bool(b.controls),
        width: widthOf(b.width) ?? 'full',
        align: a,
      }) as PopupVideoBlock;

    case 'button':
      return prune({
        type: 'button',
        id,
        label: reqString(b.label, LIMITS.buttonLabel, 'Buton metni'),
        href: buttonHref(b.href),
        bg: color(b.bg) ?? null,
        color: color(b.color) ?? null,
        newTab: bool(b.newTab),
        align: a,
        fullWidth: bool(b.fullWidth),
      }) as PopupButtonBlock;

    case 'divider':
      return prune({
        type: 'divider',
        id,
        color: color(b.color) ?? null,
      }) as PopupDividerBlock;

    case 'spacer':
      return prune({
        type: 'spacer',
        id,
        size: SPACER_SIZES.includes(b.size as PopupSpacerSize)
          ? (b.size as PopupSpacerSize)
          : 'md',
      }) as PopupSpacerBlock;

    default:
      bad(`Bilinmeyen blok türü: ${String(b.type)}`);
  }
}

/**
 * Ham `content` girdisini doğrular + normalize eder. `null`/`undefined`/`[]`
 * → `null` (blok modu kapalı, legacy alanlar render edilir). Aksi halde
 * temizlenmiş blok dizisi döner. Geçersiz girdi 400 fırlatır.
 */
export function validatePopupContent(input: unknown): PopupBlock[] | null {
  if (input === undefined || input === null) return null;
  if (!Array.isArray(input)) bad('İçerik blokları bir dizi olmalı');
  if (input.length === 0) return null;
  if (input.length > MAX_POPUP_BLOCKS) {
    bad(`En fazla ${MAX_POPUP_BLOCKS} blok eklenebilir`);
  }
  return input.map((raw, i) => validateBlock(raw, i));
}

/** Blok içeriğindeki tüm storage medya anahtarlarını toplar (tekilleştirilmiş). */
export function collectContentMediaKeys(
  blocks: PopupBlock[] | null | undefined,
): string[] {
  if (!blocks) return [];
  const set = new Set<string>();
  for (const b of blocks) {
    if ((b.type === 'image' || b.type === 'video') && b.key) {
      set.add(b.key);
    }
  }
  return [...set];
}

/** Bir pop-up'ın gösterilebilir bir içeriği var mı (tamamen boş kayıt engeli). */
export function hasRenderableContent(args: {
  blocks: PopupBlock[] | null;
  title?: string | null;
  body?: string | null;
  imageKey?: string | null;
}): boolean {
  if (args.blocks && args.blocks.length > 0) return true;
  if (args.title && args.title.trim()) return true;
  if (args.body && args.body.trim()) return true;
  if (args.imageKey) return true;
  return false;
}
