import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Sipariş Talebi "Hızlı Yanıtlar" (hazır cevaplar) deposu.
 *
 * Admin, sipariş destek taleplerini yanıtlarken tek tıkla gönderebileceği
 * profesyonel, sektöre uygun hazır metinleri buradan yönetir. Liste küçük ve
 * admin-yönetimli olduğundan AYRI BİR TABLO/MIGRATION yerine mevcut `AppSetting`
 * tablosunda tek bir JSON satırında ('support.quickReplies') saklanır — sıfır
 * şema değişikliği. Okuma/yazma doğrudan prisma ile yapılır (AppSettingsService
 * guard'ları/önbelleği bu özel-amaçlı anahtar için devrede değildir).
 *
 * Şablon metinlerinde yer tutucular: `{siparisNo}` ve `{ad}` — admin panel
 * gönderim anında siparişin numarası/müşteri adı ile DEĞİŞTİRİR.
 */
export type QuickReplyIntent =
  | 'cancel_approve'
  | 'cancel_reject'
  | 'refund_approve'
  | 'refund_reject'
  | 'received'
  | 'general';

export interface QuickReply {
  id: string;
  title: string;
  body: string;
  intent: QuickReplyIntent | null;
  sortOrder: number;
  isActive: boolean;
}

const SETTING_KEY = 'support.quickReplies';
const SEED_ACTOR = 'system-quick-reply-seed';

/**
 * İlk açılışta tohumlanan profesyonel, sektör-normuna uygun B2B hazır yanıtlar.
 * Sabit (deterministik) id'ler — eşzamanlı ilk-okuma tohumlamasında bile id
 * kayması olmaz; admin bunları düzenleyebilir/silebilir/yenilerini ekleyebilir.
 */
const DEFAULT_QUICK_REPLIES: QuickReply[] = [
  {
    id: 'qr-received',
    title: 'Talep Alındı',
    intent: 'received',
    sortOrder: 1,
    isActive: true,
    body:
      'Sayın {ad},\n\n' +
      '{siparisNo} numaralı siparişinize ilişkin talebiniz tarafımıza ulaşmıştır. ' +
      'Ekibimiz talebinizi en kısa sürede inceleyip size dönüş sağlayacaktır.\n\n' +
      'İlginiz için teşekkür eder, iyi günler ve bol kazançlı satışlar dileriz.',
  },
  {
    id: 'qr-cancel-approve',
    title: 'İptal Onaylandı',
    intent: 'cancel_approve',
    sortOrder: 2,
    isActive: true,
    body:
      'Sayın {ad},\n\n' +
      '{siparisNo} numaralı siparişinize ait iptal talebiniz onaylanmıştır. ' +
      'Siparişiniz iptal edilmiş olup, ödediğiniz tutar cari (cüzdan) ' +
      'bakiyenize iade edilmiştir. Bakiyenizi yeni siparişlerinizde kullanabilirsiniz.\n\n' +
      'İlginiz için teşekkür eder, iyi günler ve bol kazançlı satışlar dileriz.',
  },
  {
    id: 'qr-cancel-reject',
    title: 'İptal Reddedildi (Kargoda)',
    intent: 'cancel_reject',
    sortOrder: 3,
    isActive: true,
    body:
      'Sayın {ad},\n\n' +
      '{siparisNo} numaralı siparişiniz tedarik sürecine alınarak kargoya teslim ' +
      'edildiğinden, iptal talebiniz ne yazık ki karşılanamamıştır. Ürün elinize ' +
      'ulaştıktan sonra dilerseniz iade talebi oluşturabilirsiniz; iade koşulları ' +
      'konusunda ekibimiz size yardımcı olmaktan memnuniyet duyar.\n\n' +
      'Anlayışınız için teşekkür eder, iyi günler dileriz.',
  },
  {
    id: 'qr-refund-approve',
    title: 'İade Onaylandı',
    intent: 'refund_approve',
    sortOrder: 4,
    isActive: true,
    body:
      'Sayın {ad},\n\n' +
      '{siparisNo} numaralı siparişinize ait iade talebiniz onaylanmıştır. ' +
      'Ürününüz iade stoğumuza alınmıştır; incelenerek sergilemeye uygun ' +
      'bulunduğunda iade stoğunda listelenecektir.\n\n' +
      'İlginiz için teşekkür eder, iyi günler ve bol kazançlı satışlar dileriz.',
  },
  {
    id: 'qr-refund-reject',
    title: 'İade Reddedildi',
    intent: 'refund_reject',
    sortOrder: 5,
    isActive: true,
    body:
      'Sayın {ad},\n\n' +
      '{siparisNo} numaralı siparişinize ait iade talebiniz, ilgili ürün ve iade ' +
      'koşulları değerlendirilerek ne yazık ki karşılanamamıştır. Detaylı bilgi ve ' +
      'alternatif çözümler için ekibimizle iletişime geçebilirsiniz.\n\n' +
      'Anlayışınız için teşekkür eder, iyi günler dileriz.',
  },
  {
    id: 'qr-reviewing',
    title: 'İnceleniyor',
    intent: 'general',
    sortOrder: 6,
    isActive: true,
    body:
      'Sayın {ad},\n\n' +
      '{siparisNo} numaralı siparişinizle ilgili talebiniz ekibimizce titizlikle ' +
      'incelenmektedir. Sonuçlandığında size ivedilikle dönüş sağlanacaktır.\n\n' +
      'İlginiz için teşekkür eder, iyi günler dileriz.',
  },
  {
    id: 'qr-thanks',
    title: 'Teşekkür / İyi Günler',
    intent: 'general',
    sortOrder: 7,
    isActive: true,
    body:
      'Sayın {ad},\n\n' +
      'İlginiz için teşekkür ederiz. Başka bir konuda yardımcı olabilmemiz için ' +
      'dilediğiniz zaman bizimle iletişimde kalabilirsiniz.\n\n' +
      'İyi günler ve bol kazançlı satışlar dileriz.',
  },
];

const VALID_INTENTS: ReadonlySet<string> = new Set<QuickReplyIntent>([
  'cancel_approve',
  'cancel_reject',
  'refund_approve',
  'refund_reject',
  'received',
  'general',
]);

@Injectable()
export class SupportQuickRepliesService {
  constructor(private readonly prisma: PrismaService) {}

  /** sortOrder'a göre sıralı tam liste (admin yönetimi + panel için). */
  async list(): Promise<QuickReply[]> {
    const arr = await this.read();
    return [...arr].sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async create(
    input: {
      title: string;
      body: string;
      intent?: QuickReplyIntent | null;
      isActive?: boolean;
    },
    actor: { id: string },
  ): Promise<QuickReply> {
    const arr = await this.read();
    const maxSort = arr.reduce((m, r) => Math.max(m, r.sortOrder), 0);
    const item: QuickReply = {
      id: randomUUID(),
      title: (input.title ?? '').trim().slice(0, 120) || 'Yeni Yanıt',
      body: (input.body ?? '').slice(0, 4000),
      intent: normalizeIntent(input.intent),
      sortOrder: maxSort + 1,
      isActive: input.isActive ?? true,
    };
    arr.push(item);
    await this.write(arr, actor.id);
    return item;
  }

  async update(
    id: string,
    patch: {
      title?: string;
      body?: string;
      intent?: QuickReplyIntent | null;
      isActive?: boolean;
      sortOrder?: number;
    },
    actor: { id: string },
  ): Promise<QuickReply> {
    const arr = await this.read();
    const idx = arr.findIndex((r) => r.id === id);
    if (idx === -1) throw new NotFoundException('hızlı yanıt bulunamadı');
    const cur = arr[idx];
    arr[idx] = {
      ...cur,
      title:
        patch.title !== undefined
          ? patch.title.trim().slice(0, 120) || cur.title
          : cur.title,
      body: patch.body !== undefined ? patch.body.slice(0, 4000) : cur.body,
      intent: patch.intent !== undefined ? normalizeIntent(patch.intent) : cur.intent,
      isActive: patch.isActive !== undefined ? patch.isActive : cur.isActive,
      sortOrder: patch.sortOrder !== undefined ? patch.sortOrder : cur.sortOrder,
    };
    await this.write(arr, actor.id);
    return arr[idx];
  }

  async remove(id: string, actor: { id: string }): Promise<{ ok: true }> {
    const arr = await this.read();
    const next = arr.filter((r) => r.id !== id);
    if (next.length === arr.length) {
      throw new NotFoundException('hızlı yanıt bulunamadı');
    }
    await this.write(next, actor.id);
    return { ok: true };
  }

  // ── iç yardımcılar ────────────────────────────────────────────────────────

  /**
   * Depodan okur; yoksa/boşsa profesyonel default'ları tohumlar VE persist eder
   * (deterministik id'lerle → düzenleme/silme tutarlı çalışır).
   */
  private async read(): Promise<QuickReply[]> {
    const row = await this.prisma.appSetting.findUnique({
      where: { key: SETTING_KEY },
    });
    if (row?.value) {
      const parsed = safeParse(row.value);
      if (parsed && parsed.length > 0) return parsed;
    }
    // İlk erişim: default'ları persist et (stable id) ve döndür.
    const seeded = DEFAULT_QUICK_REPLIES.map((d) => ({ ...d }));
    await this.write(seeded, SEED_ACTOR);
    return seeded;
  }

  private async write(arr: QuickReply[], updatedBy: string): Promise<void> {
    const value = JSON.stringify(arr);
    await this.prisma.appSetting.upsert({
      where: { key: SETTING_KEY },
      create: {
        key: SETTING_KEY,
        value,
        type: 'string',
        category: 'support',
        label: 'Sipariş Talebi Hızlı Yanıtları',
        description:
          'Admin sipariş talepleri sayfasındaki hazır yanıt şablonları (JSON). ' +
          '"Hızlı Yanıtlar" ekranından yönetilir.',
        updatedBy,
      },
      update: { value, updatedBy },
    });
  }
}

function normalizeIntent(v: unknown): QuickReplyIntent | null {
  if (typeof v === 'string' && VALID_INTENTS.has(v)) {
    return v as QuickReplyIntent;
  }
  return null;
}

/** Depodaki JSON'u güvenle QuickReply[]'e çevirir; bozuk satırları eler. */
function safeParse(raw: string): QuickReply[] | null {
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return null;
    const out: QuickReply[] = [];
    for (const it of data) {
      if (!it || typeof it !== 'object') continue;
      const o = it as Record<string, unknown>;
      if (typeof o.id !== 'string' || typeof o.body !== 'string') continue;
      out.push({
        id: o.id,
        title: typeof o.title === 'string' ? o.title : 'Yanıt',
        body: o.body,
        intent: normalizeIntent(o.intent),
        sortOrder: typeof o.sortOrder === 'number' ? o.sortOrder : 0,
        isActive: o.isActive !== false,
      });
    }
    return out;
  } catch {
    return null;
  }
}
