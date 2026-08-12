import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { Prisma, PopupAudience, type Popup } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { STORAGE_SERVICE } from '../../storage/storage.constants';
import type { IFileStorage } from '../../storage/storage.interface';
import { detectImage } from '../../common/utils/image-magic-bytes';
import { detectVideo } from '../../common/utils/video-magic-bytes';
import {
  validatePopupContent,
  collectContentMediaKeys,
  hasRenderableContent,
  type PopupBlock,
} from './popup-content';
import type { CreatePopupDto } from './dto/create-popup.dto';
import type { UpdatePopupDto } from './dto/update-popup.dto';

/** Legacy basit-mod görseli için üst sınır (2 MB) — `/:id/image` endpoint'i. */
export const MAX_POPUP_IMAGE_BYTES = 2 * 1024 * 1024;

/** Blok görseli üst sınırı (8 MB) — `/:id/media` endpoint'i (tasarım görseli). */
export const MAX_POPUP_BLOCK_IMAGE_BYTES = 8 * 1024 * 1024;

/** Blok videosu üst sınırı (30 MB) — kısa duyuru videosu için makul tavan. */
export const MAX_POPUP_VIDEO_BYTES = 30 * 1024 * 1024;

export interface PopupImageInput {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

/** Tek bir kayıttan tüm storage medya anahtarlarını toplar (blok + legacy). */
function collectAllMediaKeys(p: {
  mediaKeys?: string[] | null;
  imageKey?: string | null;
}): string[] {
  const set = new Set<string>();
  for (const k of p.mediaKeys ?? []) if (k) set.add(k);
  if (p.imageKey) set.add(p.imageKey);
  return [...set];
}

/** Json kolonundan güvenle blok dizisi okur (bizim yazdığımız doğrulanmış veri). */
function asBlocks(value: Prisma.JsonValue | null | undefined): PopupBlock[] | null {
  return Array.isArray(value) ? (value as unknown as PopupBlock[]) : null;
}

export interface PopupActor {
  id: string;
  tenantId: string;
  email?: string | null;
}

export type PopupStatus = 'inactive' | 'scheduled' | 'active' | 'expired';

@Injectable()
export class AdminPopupsService {
  private readonly logger = new Logger(AdminPopupsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional()
    @Inject(STORAGE_SERVICE)
    private readonly storage?: IFileStorage,
  ) {}

  // ---- Sorgular ---------------------------------------------------------

  async list(tenantId: string) {
    const now = new Date();
    const popups = await this.prisma.popup.findMany({
      where: { tenantId },
      orderBy: [{ createdAt: 'desc' }],
      include: { _count: { select: { impressions: true } } },
    });

    const ids = popups.map((p) => p.id);
    const clickMap = new Map<string, number>();
    const dismissMap = new Map<string, number>();
    if (ids.length) {
      const [clicks, dismisses] = await Promise.all([
        this.prisma.popupImpression.groupBy({
          by: ['popupId'],
          where: { popupId: { in: ids }, clicked: true },
          _count: { _all: true },
        }),
        this.prisma.popupImpression.groupBy({
          by: ['popupId'],
          where: { popupId: { in: ids }, dismissed: true },
          _count: { _all: true },
        }),
      ]);
      for (const c of clicks) clickMap.set(c.popupId, c._count._all);
      for (const d of dismisses) dismissMap.set(d.popupId, d._count._all);
    }

    const data = popups.map(({ _count, ...p }) => ({
      ...p,
      status: this.statusOf(p, now),
      stats: {
        seen: _count.impressions,
        clicks: clickMap.get(p.id) ?? 0,
        dismissed: dismissMap.get(p.id) ?? 0,
      },
    }));
    return { success: true as const, data };
  }

  async get(tenantId: string, id: string) {
    const now = new Date();
    const popup = await this.prisma.popup.findFirst({
      where: { id, tenantId },
      include: { _count: { select: { impressions: true } } },
    });
    if (!popup) throw new NotFoundException('Pop-up bulunamadı');

    const [clicks, dismissed] = await Promise.all([
      this.prisma.popupImpression.count({
        where: { popupId: id, clicked: true },
      }),
      this.prisma.popupImpression.count({
        where: { popupId: id, dismissed: true },
      }),
    ]);

    const { _count, ...rest } = popup;
    return {
      success: true as const,
      data: {
        ...rest,
        status: this.statusOf(popup, now),
        stats: { seen: _count.impressions, clicks, dismissed },
      },
    };
  }

  // ---- Mutasyonlar ------------------------------------------------------

  async create(
    tenantId: string,
    dto: CreatePopupDto,
    actor: PopupActor,
    req?: Request,
  ) {
    const audience = dto.audience ?? PopupAudience.ALL;
    const startsAt = this.parseDate(dto.startsAt);
    const endsAt = this.parseDate(dto.endsAt);
    const content = validatePopupContent(dto.content);
    const title = dto.title?.trim() || null;
    const body = dto.body && dto.body.trim() ? dto.body : null;
    this.assertCta(dto.ctaLabel, dto.ctaUrl);
    this.assertWindow(startsAt, endsAt);
    this.assertAudience(audience, dto.segment, dto.customerIds);
    if (!hasRenderableContent({ blocks: content, title, body, imageKey: null })) {
      throw new BadRequestException(
        'Pop-up boş olamaz: en az bir blok, başlık, metin veya görsel ekleyin',
      );
    }

    const created = await this.prisma.popup.create({
      data: {
        tenantId,
        title,
        body,
        content:
          content === null
            ? Prisma.DbNull
            : (content as unknown as Prisma.InputJsonValue),
        mediaKeys: collectContentMediaKeys(content),
        widthPx: dto.widthPx ?? null,
        backgroundColor: dto.backgroundColor?.trim() || null,
        ctaLabel: dto.ctaLabel?.trim() || null,
        ctaUrl: dto.ctaUrl?.trim() || null,
        ctaNewTab: dto.ctaNewTab ?? undefined,
        position: dto.position ?? undefined,
        size: dto.size ?? undefined,
        frequency: dto.frequency ?? undefined,
        showLimit: dto.showLimit ?? undefined,
        dismissible: dto.dismissible ?? undefined,
        audience,
        segment:
          audience === PopupAudience.SEGMENT
            ? dto.segment?.trim() || null
            : null,
        customerIds:
          audience === PopupAudience.SPECIFIC ? dto.customerIds ?? [] : [],
        startsAt,
        endsAt,
        isActive: dto.isActive ?? undefined,
        priority: dto.priority ?? undefined,
        themeColor: dto.themeColor?.trim() || null,
        createdById: actor.id,
      },
    });

    this.recordAudit(
      'POPUP_CREATED',
      `'${created.title}' pop-up'ı oluşturuldu`,
      actor,
      created.id,
      created.title ?? '',
      null,
      this.snapshot(created),
      req,
    );
    return { success: true as const, data: created };
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdatePopupDto,
    actor: PopupActor,
    req?: Request,
  ) {
    const existing = await this.prisma.popup.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Pop-up bulunamadı');

    const data: Prisma.PopupUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title?.trim() || null;
    if (dto.body !== undefined)
      data.body = dto.body && dto.body.trim() ? dto.body : null;
    if (dto.widthPx !== undefined) data.widthPx = dto.widthPx ?? null;
    if (dto.backgroundColor !== undefined)
      data.backgroundColor = dto.backgroundColor?.trim() || null;

    // İçerik blokları gönderildiyse doğrula. null/[] => blok modunu kapat.
    let newContent: PopupBlock[] | null | undefined;
    if (dto.content !== undefined) {
      newContent = validatePopupContent(dto.content);
      data.content =
        newContent === null
          ? Prisma.DbNull
          : (newContent as unknown as Prisma.InputJsonValue);
    }
    if (dto.ctaLabel !== undefined) data.ctaLabel = dto.ctaLabel?.trim() || null;
    if (dto.ctaUrl !== undefined) data.ctaUrl = dto.ctaUrl?.trim() || null;
    if (dto.ctaNewTab !== undefined) data.ctaNewTab = dto.ctaNewTab;
    if (dto.position !== undefined) data.position = dto.position;
    if (dto.size !== undefined) data.size = dto.size;
    if (dto.frequency !== undefined) data.frequency = dto.frequency;
    if (dto.showLimit !== undefined) data.showLimit = dto.showLimit;
    if (dto.dismissible !== undefined) data.dismissible = dto.dismissible;
    if (dto.audience !== undefined) data.audience = dto.audience;
    if (dto.segment !== undefined) data.segment = dto.segment?.trim() || null;
    if (dto.customerIds !== undefined) data.customerIds = dto.customerIds;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.themeColor !== undefined)
      data.themeColor = dto.themeColor?.trim() || null;

    // Tarihler: gönderildiyse parse et (null => temizle).
    const effStart =
      dto.startsAt !== undefined
        ? this.parseDate(dto.startsAt)
        : existing.startsAt;
    const effEnd =
      dto.endsAt !== undefined ? this.parseDate(dto.endsAt) : existing.endsAt;
    if (dto.startsAt !== undefined) data.startsAt = effStart;
    if (dto.endsAt !== undefined) data.endsAt = effEnd;

    // Cross-field doğrulama efektif (yeni ya da mevcut) değerler üzerinden.
    const effAudience = (dto.audience ?? existing.audience) as PopupAudience;
    const effSegment =
      dto.segment !== undefined ? dto.segment : existing.segment;
    const effCustomerIds =
      dto.customerIds !== undefined ? dto.customerIds : existing.customerIds;
    const effLabel =
      dto.ctaLabel !== undefined ? dto.ctaLabel : existing.ctaLabel;
    const effUrl = dto.ctaUrl !== undefined ? dto.ctaUrl : existing.ctaUrl;

    this.assertCta(effLabel, effUrl);
    this.assertWindow(effStart, effEnd);
    this.assertAudience(effAudience, effSegment, effCustomerIds);

    // Hedef kitle değiştiyse artık geçersiz olan alanları normalize et.
    if (dto.audience !== undefined) {
      if (effAudience !== PopupAudience.SEGMENT) data.segment = null;
      if (effAudience !== PopupAudience.SPECIFIC) data.customerIds = [];
    }

    // "Tamamen boş" engeli — efektif değerler üzerinden. İçerik gönderildiyse
    // legacy görsel bloklara devredilir, bu yüzden boşluk kontrolünde sayılmaz.
    const effTitle =
      dto.title !== undefined ? dto.title?.trim() || null : existing.title;
    const effBody =
      dto.body !== undefined
        ? dto.body && dto.body.trim()
          ? dto.body
          : null
        : existing.body;
    const effBlocks =
      newContent !== undefined ? newContent : asBlocks(existing.content);
    const effImageKey = dto.content !== undefined ? null : existing.imageKey;
    if (
      !hasRenderableContent({
        blocks: effBlocks,
        title: effTitle,
        body: effBody,
        imageKey: effImageKey,
      })
    ) {
      throw new BadRequestException(
        'Pop-up boş olamaz: en az bir blok, başlık, metin veya görsel ekleyin',
      );
    }

    // Medya mutabakatı — yalnız içerik AÇIKÇA gönderildiğinde. Blok modu tüm
    // medyaya sahip olur: kullanılmayan eski anahtarlar (blok + legacy görsel)
    // storage'dan silinir; legacy görsel kolonları temizlenir; orphan kalmaz.
    if (dto.content !== undefined) {
      const referenced = collectContentMediaKeys(newContent ?? null);
      const owned = collectAllMediaKeys(existing);
      let mediaChanged = owned.length !== referenced.length;
      for (const key of owned) {
        if (!referenced.includes(key)) {
          this.bestEffortDelete(key, id);
          mediaChanged = true;
        }
      }
      data.mediaKeys = { set: referenced };
      data.imageUrl = null;
      data.imageKey = null;
      // Sadece medya gerçekten değiştiyse purge damgasını sıfırla (boşuna grace uzamasın).
      if (mediaChanged) data.mediaPurgedAt = null;
    }

    const updated = await this.prisma.popup.update({ where: { id }, data });
    this.recordAudit(
      'POPUP_UPDATED',
      `'${updated.title ?? '(başlıksız)'}' pop-up'ı güncellendi`,
      actor,
      id,
      updated.title ?? '(başlıksız)',
      this.snapshot(existing),
      this.snapshot(updated),
      req,
    );
    return { success: true as const, data: updated };
  }

  async remove(tenantId: string, id: string, actor: PopupActor, req?: Request) {
    const existing = await this.prisma.popup.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Pop-up bulunamadı');

    // Kayda ait TÜM medyayı sil (blok görselleri/videoları + legacy görsel) —
    // storage'da hiçbir kalıntı bırakma.
    if (this.storage) {
      for (const key of collectAllMediaKeys(existing)) {
        this.bestEffortDelete(key, id);
      }
    }
    await this.prisma.popup.delete({ where: { id } });

    const label = existing.title ?? '(başlıksız)';
    this.recordAudit(
      'POPUP_DELETED',
      `'${label}' pop-up'ı silindi`,
      actor,
      id,
      label,
      this.snapshot(existing),
      null,
      req,
    );
    return { success: true as const, data: { id } };
  }

  async uploadImage(
    tenantId: string,
    id: string,
    actor: PopupActor,
    input: PopupImageInput,
    req?: Request,
  ) {
    if (!this.storage) {
      throw new BadRequestException('Dosya depolama yapılandırılmamış');
    }
    if (input.size > MAX_POPUP_IMAGE_BYTES) {
      throw new BadRequestException(
        `Görsel en fazla ${Math.floor(MAX_POPUP_IMAGE_BYTES / 1024 / 1024)} MB olabilir`,
      );
    }
    const detected = detectImage(input.buffer);
    if (!detected) {
      throw new BadRequestException(
        'Yalnızca JPEG, PNG veya WEBP görseller yüklenebilir',
      );
    }

    const existing = await this.prisma.popup.findFirst({
      where: { id, tenantId },
      select: { id: true, imageKey: true, title: true },
    });
    if (!existing) throw new NotFoundException('Pop-up bulunamadı');

    const key = `popups/${randomUUID()}.${detected.extension}`;
    const uploaded = await this.storage.upload(
      key,
      input.buffer,
      detected.mimetype,
    );
    const imageUrl = await this.storage.getPublicUrl(uploaded.key);

    if (existing.imageKey && existing.imageKey !== uploaded.key) {
      this.bestEffortDelete(existing.imageKey, id);
    }

    const updated = await this.prisma.popup.update({
      where: { id },
      data: { imageUrl, imageKey: uploaded.key },
    });

    this.recordAudit(
      'POPUP_IMAGE_UPDATED',
      `'${existing.title ?? '(başlıksız)'}' pop-up görseli güncellendi`,
      actor,
      id,
      existing.title ?? '(başlıksız)',
      null,
      { imageUrl },
      req,
    );
    return { success: true as const, data: updated };
  }

  async deleteImage(
    tenantId: string,
    id: string,
    actor: PopupActor,
    req?: Request,
  ) {
    const existing = await this.prisma.popup.findFirst({
      where: { id, tenantId },
      select: { id: true, imageKey: true, title: true },
    });
    if (!existing) throw new NotFoundException('Pop-up bulunamadı');

    if (existing.imageKey && this.storage) {
      this.bestEffortDelete(existing.imageKey, id);
    }

    const updated = await this.prisma.popup.update({
      where: { id },
      data: { imageUrl: null, imageKey: null },
    });

    this.recordAudit(
      'POPUP_IMAGE_DELETED',
      `'${existing.title ?? '(başlıksız)'}' pop-up görseli kaldırıldı`,
      actor,
      id,
      existing.title ?? '(başlıksız)',
      null,
      null,
      req,
    );
    return { success: true as const, data: updated };
  }

  /**
   * Blok medyası yükleme (görsel VEYA video) — görsel blok düzenleyici için.
   * Sihirli baytlarla tür doğrulanır (MIME spoof'a güvenilmez). Anahtar
   * `mediaKeys`'e eklenir; blokta kullanılmazsa sonraki kaydetmede / süre
   * bitiminde temizlenir. Döner: { key, url, kind } — admin bunu bloğa koyar.
   */
  async uploadMedia(
    tenantId: string,
    id: string,
    actor: PopupActor,
    input: PopupImageInput,
    req?: Request,
  ) {
    if (!this.storage) {
      throw new BadRequestException('Dosya depolama yapılandırılmamış');
    }
    const image = detectImage(input.buffer);
    const video = image ? null : detectVideo(input.buffer);
    if (!image && !video) {
      throw new BadRequestException(
        'Yalnızca JPEG/PNG/WEBP görsel veya MP4/WEBM video yüklenebilir',
      );
    }
    const kind: 'image' | 'video' = image ? 'image' : 'video';
    const maxBytes = image
      ? MAX_POPUP_BLOCK_IMAGE_BYTES
      : MAX_POPUP_VIDEO_BYTES;
    if (input.size > maxBytes) {
      throw new BadRequestException(
        `${image ? 'Görsel' : 'Video'} en fazla ${Math.floor(
          maxBytes / 1024 / 1024,
        )} MB olabilir`,
      );
    }

    const existing = await this.prisma.popup.findFirst({
      where: { id, tenantId },
      select: { id: true, title: true },
    });
    if (!existing) throw new NotFoundException('Pop-up bulunamadı');

    const detected = image ?? video!;
    const key = `popups/${randomUUID()}.${detected.extension}`;
    const uploaded = await this.storage.upload(
      key,
      input.buffer,
      detected.mimetype,
    );
    const url = await this.storage.getPublicUrl(uploaded.key);

    // Anahtarı kayda iliştir (sahiplenme) — kullanılmazsa mutabakat/süre cron'u
    // temizler. mediaPurgedAt sıfırlanır (yeni medya geldi).
    await this.prisma.popup.update({
      where: { id },
      data: { mediaKeys: { push: uploaded.key }, mediaPurgedAt: null },
    });

    this.recordAudit(
      'POPUP_MEDIA_UPLOADED',
      `'${existing.title ?? '(başlıksız)'}' pop-up'ına ${kind === 'image' ? 'görsel' : 'video'} yüklendi`,
      actor,
      id,
      existing.title ?? '(başlıksız)',
      null,
      { kind, url },
      req,
    );
    return { success: true as const, data: { key: uploaded.key, url, kind } };
  }

  // ---- Yardımcılar ------------------------------------------------------

  private statusOf(
    p: { isActive: boolean; startsAt: Date | null; endsAt: Date | null },
    now: Date,
  ): PopupStatus {
    if (!p.isActive) return 'inactive';
    if (p.startsAt && p.startsAt.getTime() > now.getTime()) return 'scheduled';
    if (p.endsAt && p.endsAt.getTime() < now.getTime()) return 'expired';
    return 'active';
  }

  private parseDate(value?: string | null): Date | null {
    if (value === undefined || value === null || value === '') return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException('Geçersiz tarih biçimi');
    }
    return d;
  }

  private assertCta(label?: string | null, url?: string | null): void {
    const hasLabel = !!(label && label.trim());
    const hasUrl = !!(url && url.trim());
    if (hasLabel !== hasUrl) {
      throw new BadRequestException(
        'CTA için hem buton metni hem de bağlantı gerekli',
      );
    }
    if (hasUrl) {
      const u = url!.trim();
      // `//evil.com` protokol-göreli bir mutlak URL'dir (cross-origin). Dahili
      // yol gibi görünse de tek "/" değil "//" ile başladığı için reddedilir.
      const ok =
        u.startsWith('http://') ||
        u.startsWith('https://') ||
        (u.startsWith('/') && !u.startsWith('//'));
      if (!ok) {
        throw new BadRequestException(
          'CTA bağlantısı http(s):// ile veya / ile başlamalı',
        );
      }
    }
  }

  private assertWindow(start: Date | null, end: Date | null): void {
    if (start && end && end.getTime() <= start.getTime()) {
      throw new BadRequestException(
        'Bitiş tarihi başlangıç tarihinden sonra olmalı',
      );
    }
  }

  private assertAudience(
    audience: PopupAudience,
    segment?: string | null,
    customerIds?: string[] | null,
  ): void {
    if (audience === PopupAudience.SEGMENT && !(segment && segment.trim())) {
      throw new BadRequestException(
        'Segment hedeflemesi için sektör/segment etiketi gerekli',
      );
    }
    if (
      audience === PopupAudience.SPECIFIC &&
      (!customerIds || customerIds.length === 0)
    ) {
      throw new BadRequestException(
        'Seçili müşteri hedeflemesi için en az bir müşteri seçilmeli',
      );
    }
  }

  private snapshot(p: Popup): Record<string, unknown> {
    return {
      title: p.title,
      audience: p.audience,
      segment: p.segment,
      customerCount: p.customerIds.length,
      position: p.position,
      size: p.size,
      frequency: p.frequency,
      showLimit: p.showLimit,
      isActive: p.isActive,
      priority: p.priority,
      startsAt: p.startsAt ? p.startsAt.toISOString() : null,
      endsAt: p.endsAt ? p.endsAt.toISOString() : null,
      hasImage: !!p.imageUrl,
      hasCta: !!p.ctaUrl,
    };
  }

  private bestEffortDelete(key: string, popupId: string): void {
    if (!this.storage) return;
    // Savunma: yalnız pop-up namespace'indeki anahtarlar silinebilir; path
    // traversal ya da kapsam-dışı anahtar storage'a hiç ulaşmasın.
    if (!key.startsWith('popups/') || key.includes('..')) {
      this.logger.warn(`Geçersiz pop-up medya anahtarı atlandı id=${popupId} key=${key}`);
      return;
    }
    void this.storage.delete(key).catch((err: unknown) => {
      this.logger.warn(
        `Pop-up görseli silinemedi id=${popupId} key=${key} err=${
          err instanceof Error ? err.message : 'bilinmiyor'
        }`,
      );
    });
  }

  private recordAudit(
    action: string,
    summary: string,
    actor: PopupActor,
    targetId: string,
    targetLabel: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
    req?: Request,
  ): void {
    void this.audit.record({
      action,
      summary,
      actor: {
        type: 'admin',
        id: actor.id,
        email: actor.email ?? null,
        name: actor.email ?? null,
        tenantId: actor.tenantId,
      },
      target: { id: targetId, type: 'popup', label: targetLabel },
      before: before ?? undefined,
      after: after ?? undefined,
      req: req ?? null,
    });
  }
}
