import { Injectable, NotFoundException } from '@nestjs/common';
import { PopupAudience, Prisma, type Popup } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { PopupBlock } from '../../admin/popups/popup-content';

/** Müşterinin pop-up uygunluğunu çözmek için gereken minimum alanlar. */
type EligibilityCustomer = {
  id: string;
  segment: string | null;
  timezone: string;
};

/**
 * Müşteri ekranına çıkacak pop-up'ları çözen ve görüntülenme/kapatma/tıklama
 * sayaçlarını sunucu tarafında tutan servis. Sıklık (frequency) kısıtı
 * localStorage YASAK olduğu için tamamen PopupImpression tablosu üzerinden
 * uygulanır (CLAUDE.md kuralı).
 */
@Injectable()
export class CustomerPopupsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Bu müşteriye, şu an gösterilmesi gereken aktif pop-up'lar (sıklık filtreli). */
  async getActive(customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, segment: true, timezone: true },
    });
    if (!customer) return { success: true as const, data: [] };

    const tenantId = await this.resolveDefaultTenantId();
    const now = new Date();

    const popups = await this.prisma.popup.findMany({
      where: this.eligibilityWhere(customer, tenantId, now),
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });
    if (popups.length === 0) return { success: true as const, data: [] };

    const impressions = await this.prisma.popupImpression.findMany({
      where: {
        customerId: customer.id,
        popupId: { in: popups.map((p) => p.id) },
      },
    });
    const impByPopup = new Map(impressions.map((i) => [i.popupId, i]));
    // "Bugün" sınırı sunucu saatine göre değil, müşterinin saat dilimine göre
    // hesaplanır (repo geneli Europe/Istanbul kuralı). EVERY_LOGIN sıfırlaması
    // doğru günde olur.
    const todayKey = this.dateKey(now, customer.timezone);

    const visible = popups
      .filter((p) =>
        this.shouldShow(p, impByPopup.get(p.id), todayKey, customer.timezone),
      )
      .map((p) => this.toClient(p));

    return { success: true as const, data: visible };
  }

  /** Görüntülendi: sayaç +1, lastSeenAt güncellenir. */
  async markSeen(customerId: string, popupId: string) {
    await this.assertEligible(customerId, popupId);
    const now = new Date();
    await this.prisma.popupImpression.upsert({
      where: { popupId_customerId: { popupId, customerId } },
      create: {
        popupId,
        customerId,
        seenCount: 1,
        firstSeenAt: now,
        lastSeenAt: now,
      },
      update: { seenCount: { increment: 1 }, lastSeenAt: now },
    });
    return { success: true as const };
  }

  /** Kapatıldı (dismiss): bir daha (sıklık kuralına göre) gösterilmemesi için işaretlenir. */
  async markDismissed(customerId: string, popupId: string) {
    await this.assertEligible(customerId, popupId);
    const now = new Date();
    await this.prisma.popupImpression.upsert({
      where: { popupId_customerId: { popupId, customerId } },
      create: {
        popupId,
        customerId,
        seenCount: 1,
        dismissed: true,
        firstSeenAt: now,
        lastSeenAt: now,
      },
      update: { dismissed: true, lastSeenAt: now },
    });
    return { success: true as const };
  }

  /** CTA tıklandı: dönüşüm metriği için işaretlenir. */
  async markClicked(customerId: string, popupId: string) {
    await this.assertEligible(customerId, popupId);
    const now = new Date();
    await this.prisma.popupImpression.upsert({
      where: { popupId_customerId: { popupId, customerId } },
      create: {
        popupId,
        customerId,
        seenCount: 1,
        clicked: true,
        firstSeenAt: now,
        lastSeenAt: now,
      },
      update: { clicked: true, lastSeenAt: now },
    });
    return { success: true as const };
  }

  // ---- Yardımcılar ------------------------------------------------------

  private shouldShow(
    popup: Popup,
    imp: { seenCount: number; dismissed: boolean; lastSeenAt: Date } | undefined,
    todayKey: string,
    timezone: string,
  ): boolean {
    if (!imp) return true;
    switch (popup.frequency) {
      case 'EVERY_LOGIN':
        // Her gün bir kez: bugün henüz görülmediyse göster. Dismiss yalnızca o
        // günü etkiler (lastSeenAt bugün => bugün gösterme, yarın tekrar çıkar).
        // Gün sınırı müşterinin saat dilimine göre (en-CA YYYY-MM-DD,
        // sözlüksel olarak karşılaştırılabilir).
        return this.dateKey(imp.lastSeenAt, timezone) < todayKey;
      case 'LIMITED':
        if (imp.dismissed) return false;
        return imp.seenCount < Math.max(1, popup.showLimit);
      case 'ONCE':
      default:
        if (imp.dismissed) return false;
        return imp.seenCount < 1;
    }
  }

  /**
   * Müşteriye gidecek blok içeriği — iç storage anahtarlarını (`key`) çıkarır.
   * Müşterinin yalnız `url`'e ihtiyacı var; depo anahtarı sızdırmak gereksiz
   * yüzey açar (cross-tenant anahtar tahmini). Geçersiz/boş içerik → null.
   */
  private sanitizeContent(value: Prisma.JsonValue | null): PopupBlock[] | null {
    if (!Array.isArray(value)) return null;
    return (value as unknown as PopupBlock[]).map((b) => {
      if (b && (b.type === 'image' || b.type === 'video')) {
        const { key, ...rest } = b;
        void key;
        return rest;
      }
      return b;
    });
  }

  /** İç alanları (tenantId, segment, customerIds, sayaçlar) sızdırmadan client DTO'su. */
  private toClient(p: Popup) {
    return {
      id: p.id,
      title: p.title,
      body: p.body,
      // Blok içeriği (görsel düzenleyici). Dolu ise müşteri blokları render eder
      // ve legacy title/body/image/cta'yı yok sayar. Doğrulama admin tarafında
      // (validatePopupContent) yapıldı; burada müşteriye iç storage anahtarları
      // (block.key) sızdırılmadan geçirilir (yalnız url gerekir).
      content: this.sanitizeContent(p.content),
      imageUrl: p.imageUrl,
      ctaLabel: p.ctaLabel,
      ctaUrl: p.ctaUrl,
      ctaNewTab: p.ctaNewTab,
      position: p.position,
      size: p.size,
      widthPx: p.widthPx,
      backgroundColor: p.backgroundColor,
      dismissible: p.dismissible,
      themeColor: p.themeColor,
      priority: p.priority,
    };
  }

  /**
   * Bir müşterinin bir pop-up'ı görmeye uygun olup olmadığını belirleyen tek
   * doğruluk kaynağı. Hem okuma (getActive) hem yazma (assertEligible)
   * yollarında AYNI yüklem kullanılır; böylece bir müşteri yalnızca kendisine
   * hedeflenmiş pop-up için sayaç/izlenim üretebilir (IDOR + hedefleme bypass
   * koruması).
   */
  private eligibilityWhere(
    customer: EligibilityCustomer,
    tenantId: string,
    now: Date,
  ): Prisma.PopupWhereInput {
    return {
      tenantId,
      isActive: true,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        {
          OR: [
            { audience: PopupAudience.ALL },
            ...(customer.segment
              ? [
                  {
                    audience: PopupAudience.SEGMENT,
                    segment: customer.segment,
                  },
                ]
              : []),
            {
              audience: PopupAudience.SPECIFIC,
              customerIds: { has: customer.id },
            },
          ],
        },
      ],
    };
  }

  /**
   * Yazma yolundaki (seen/dismiss/click) koruma: müşteri yalnızca kendisine
   * gösterilmeye uygun pop-up için izlenim üretebilir. Aksi halde varlığı
   * sızdırmadan 404 döner.
   */
  private async assertEligible(
    customerId: string,
    popupId: string,
  ): Promise<void> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, segment: true, timezone: true },
    });
    if (!customer) throw new NotFoundException('Pop-up bulunamadı');

    const tenantId = await this.resolveDefaultTenantId();
    const eligible = await this.prisma.popup.findFirst({
      where: {
        id: popupId,
        ...this.eligibilityWhere(customer, tenantId, new Date()),
      },
      select: { id: true },
    });
    if (!eligible) throw new NotFoundException('Pop-up bulunamadı');
  }

  /** Verilen tarihi, hedef saat diliminde sözlüksel karşılaştırılabilir gün anahtarına (YYYY-MM-DD) çevirir. */
  private dateKey(date: Date, timeZone: string): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  }

  private async resolveDefaultTenantId(): Promise<string> {
    const slug = process.env.DEFAULT_TENANT_SLUG ?? 'acme';
    const tenant = await this.prisma.tenant.findFirst({
      where: { slug },
      select: { id: true },
    });
    if (tenant) return tenant.id;
    const first = await this.prisma.tenant.findFirst({ select: { id: true } });
    if (!first) throw new Error('No tenant configured');
    return first.id;
  }
}
