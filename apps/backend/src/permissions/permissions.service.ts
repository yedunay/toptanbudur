import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PAGE_KEYS, isValidPageKey, type PageKey } from './permission-keys';
import { getRoleDefaults, isUnboundedRole } from './role-templates';

export interface EffectivePermissions {
  role: Role;
  defaults: readonly PageKey[];
  overrides: { pageKey: PageKey; granted: boolean }[];
  /** Final efektif izin listesi — JWT'ye gömülen liste budur. */
  effective: PageKey[];
  /** OWNER için true — her zaman her şeye yetkili. */
  unbounded: boolean;
}

interface ActorContext {
  id: string;
  tenantId: string;
}

/** Canlı izin cache TTL'i — guard her istekte DB'ye gitmesin diye. Patronun
 *  izin değişikliği en geç bu süre içinde API'de etkili olur (kendi yazma
 *  yolumuz `setOverrides` cache'i anında düşürür; TTL, rol değişimi gibi
 *  dolaylı yollar için üst sınırdır). */
const LIVE_CACHE_TTL_MS = 30_000;

@Injectable()
export class PermissionsService {
  private readonly liveCache = new Map<
    string,
    { perms: readonly string[]; expiresAt: number }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Kullanıcının efektif sayfa izinlerini hesaplar.
   *
   * OWNER → daima `unbounded: true` ve tüm PAGE_KEYS.
   * Diğer roller → role defaults ∪ (override granted=true) − (override granted=false).
   *
   * Bu fonksiyon JWT issue/refresh sırasında ve guard'ın canlı kontrolünde
   * çağrılır; JWT'deki kopya frontend'in ilk boyaması içindir.
   *
   * `tenantId` verilirse kullanıcı o tenant içinde aranır (cross-tenant
   * okuma engeli); verilmezse yalnız id ile bulunur (kendi izinleri, guard).
   */
  async getEffectivePermissions(
    userId: string,
    tenantId?: string,
  ): Promise<EffectivePermissions> {
    const user = await this.prisma.user.findFirst({
      where: tenantId ? { id: userId, tenantId } : { id: userId },
      select: { id: true, role: true },
    });
    if (!user) throw new NotFoundException('Kullanıcı bulunamadı');

    if (isUnboundedRole(user.role)) {
      return {
        role: user.role,
        defaults: PAGE_KEYS,
        overrides: [],
        effective: [...PAGE_KEYS],
        unbounded: true,
      };
    }

    const overrideRows = await this.prisma.userPagePermission.findMany({
      where: { userId },
      select: { pageKey: true, granted: true },
    });

    const overrides = overrideRows
      .filter((row): row is { pageKey: PageKey; granted: boolean } =>
        isValidPageKey(row.pageKey),
      )
      .map((row) => ({ pageKey: row.pageKey, granted: row.granted }));

    const defaults = getRoleDefaults(user.role);
    const effectiveSet = new Set<PageKey>(defaults);
    for (const o of overrides) {
      if (o.granted) effectiveSet.add(o.pageKey);
      else effectiveSet.delete(o.pageKey);
    }

    // Stable order — PAGE_KEYS sırasını koru
    const effective = PAGE_KEYS.filter((k) => effectiveSet.has(k));

    return {
      role: user.role,
      defaults,
      overrides,
      effective,
      unbounded: false,
    };
  }

  /**
   * Sadece izin keylerini düz dizi olarak döner (JWT için).
   * OWNER için `['*']` döner — guard tarafı bunu özel olarak ele alır.
   */
  async getJwtPermissions(userId: string): Promise<string[]> {
    const eff = await this.getEffectivePermissions(userId);
    if (eff.unbounded) return ['*'];
    return [...eff.effective];
  }

  /**
   * Guard'ın her istekte kullandığı CANLI izin listesi (kısa süreli cache).
   * `setOverrides` kendi yazdığı kullanıcının cache'ini anında düşürür;
   * rol değişimi gibi dolaylı güncellemeler en geç TTL kadar gecikir.
   */
  async getLivePermissions(userId: string): Promise<readonly string[]> {
    const now = Date.now();
    const hit = this.liveCache.get(userId);
    if (hit && hit.expiresAt > now) return hit.perms;

    const perms = await this.getJwtPermissions(userId);
    if (this.liveCache.size >= 1000) {
      // Sınırsız büyümesin: süresi geçenleri temizle, hâlâ doluysa sıfırla.
      for (const [key, value] of this.liveCache) {
        if (value.expiresAt <= now) this.liveCache.delete(key);
      }
      if (this.liveCache.size >= 1000) this.liveCache.clear();
    }
    this.liveCache.set(userId, { perms, expiresAt: now + LIVE_CACHE_TTL_MS });
    return perms;
  }

  /** İzin/rol değişiminde çağrılır — bir kullanıcının (veya hepsinin)
   *  canlı izin cache'ini düşürür. */
  invalidateLiveCache(userId?: string): void {
    if (userId) this.liveCache.delete(userId);
    else this.liveCache.clear();
  }

  /**
   * Admin tarafından bir kullanıcının izin matrisini günceller.
   *
   * Beklenen payload: `{ pageKey: PageKey, granted: boolean | null }[]`
   *   - `granted=true`  → o sayfayı zorla AÇ (role default'ünün üstüne yaz)
   *   - `granted=false` → o sayfayı zorla KAPAT
   *   - `granted=null`  → override'ı temizle (role default'üne dön)
   *
   * Güvenlik:
   *   - Aynı tenant olmalı.
   *   - Hedef OWNER ise override yapılamaz (zaten yok sayılır — UI'a hata).
   *   - Aktör kendi izinlerini düşüremez (kendi tenant'tan kilitlenme önlenir).
   */
  async setOverrides(
    targetUserId: string,
    updates: { pageKey: string; granted: boolean | null }[],
    actor: ActorContext,
  ): Promise<EffectivePermissions> {
    if (!Array.isArray(updates) || updates.length === 0) {
      throw new BadRequestException('Boş güncelleme listesi');
    }

    const target = await this.prisma.user.findFirst({
      where: { id: targetUserId, tenantId: actor.tenantId },
      select: { id: true, role: true, email: true },
    });
    if (!target) throw new NotFoundException('Kullanıcı bulunamadı');

    if (target.role === 'OWNER') {
      throw new BadRequestException(
        'OWNER rolündeki kullanıcının izinleri kısıtlanamaz',
      );
    }

    if (target.id === actor.id) {
      throw new ForbiddenException(
        'Kendi izinlerini düzenleyemezsin (kilitlenme riski)',
      );
    }

    // Validate keys
    for (const u of updates) {
      if (!isValidPageKey(u.pageKey)) {
        throw new BadRequestException(`Geçersiz sayfa anahtarı: ${u.pageKey}`);
      }
    }

    const before = await this.getEffectivePermissions(targetUserId);

    await this.prisma.$transaction(async (tx) => {
      for (const u of updates) {
        // `== null` bilinçli: DTO'da alan hiç gönderilmezse `undefined` gelir
        // ve `@IsOptional`'dan geçer — o da "override sil" demektir (eskiden
        // Prisma'ya `granted: undefined` sızıp 500 veriyordu).
        if (u.granted == null) {
          await tx.userPagePermission.deleteMany({
            where: { userId: targetUserId, pageKey: u.pageKey },
          });
        } else {
          await tx.userPagePermission.upsert({
            where: {
              userId_pageKey: { userId: targetUserId, pageKey: u.pageKey },
            },
            create: {
              userId: targetUserId,
              pageKey: u.pageKey,
              granted: u.granted,
            },
            update: { granted: u.granted },
          });
        }
      }
    });

    // Guard'ın canlı cache'ini anında düşür — patronun kapattığı sayfa
    // bir sonraki istekte hemen 403 olsun.
    this.invalidateLiveCache(targetUserId);

    const after = await this.getEffectivePermissions(targetUserId);

    void this.audit.log({
      actorType: 'admin',
      actorId: actor.id,
      tenantId: actor.tenantId,
      action: 'ADMIN_USER_PERMISSIONS_UPDATED',
      target: targetUserId,
      metadata: {
        email: target.email,
        role: target.role,
        before: {
          effective: before.effective,
          overrides: before.overrides,
        },
        after: {
          effective: after.effective,
          overrides: after.overrides,
        },
        updates,
      },
    });

    return after;
  }
}
