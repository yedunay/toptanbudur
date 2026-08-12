import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type AppSetting } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * Yapısal konfigürasyon tutan kategoriler — bunlar kendi doğrulamalı servisleri
 * üzerinden yazılır (ör. DealerXmlConfigService JSON config, supplier bootstrap
 * kimlik eşlemeleri). Generic PUT /admin/settings/:key bunları EZEMEZ; aksi
 * halde JSON/kimlik eşlemeleri doğrulamasız bozulup feed'leri kırabilir.
 */
const PROTECTED_CATEGORIES = new Set<string>([
  'xml-dealer', // xml.dealer.<id> JSON config → DealerXmlConfigService
  'kategori',
]);

/** Kategori metadata'sından bağımsız olarak korunan anahtar önekleri. */
const PROTECTED_KEY_PREFIXES = ['xml.dealer.'];

/**
 * Runtime config tablosu. Değerler `value` kolonunda string olarak tutulur,
 * `type` alanına göre parse edilir. İn-memory cache TTL=60s — admin değişiklik
 * yapınca cache invalidate edilir, böylece güncellemeler hızlı yansır.
 *
 * Hassas/secret değerler (API token vs.) BURAYA KONULMAZ — onlar .env'de.
 */
@Injectable()
export class AppSettingsService {
  private readonly logger = new Logger(AppSettingsService.name);
  private readonly cache = new Map<string, { value: string; expiresAt: number }>();
  private readonly CACHE_TTL_MS = 60_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async getRaw(key: string): Promise<string | null> {
    const now = Date.now();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > now) return cached.value;

    const row = await this.prisma.appSetting.findUnique({
      where: { key },
      select: { value: true },
    });
    if (!row) {
      this.cache.delete(key);
      return null;
    }
    this.cache.set(key, { value: row.value, expiresAt: now + this.CACHE_TTL_MS });
    return row.value;
  }

  async getNumber(key: string, fallback: number): Promise<number> {
    const raw = await this.getRaw(key);
    if (raw === null) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      this.logger.warn(`AppSetting "${key}" non-numeric value: ${raw}`);
      return fallback;
    }
    return n;
  }

  async getDecimal(
    key: string,
    fallback: Prisma.Decimal | number,
  ): Promise<Prisma.Decimal> {
    const raw = await this.getRaw(key);
    const fb =
      fallback instanceof Prisma.Decimal
        ? fallback
        : new Prisma.Decimal(fallback);
    if (raw === null) return fb;
    try {
      return new Prisma.Decimal(raw);
    } catch {
      this.logger.warn(`AppSetting "${key}" non-decimal value: ${raw}`);
      return fb;
    }
  }

  async getBoolean(key: string, fallback: boolean): Promise<boolean> {
    const raw = await this.getRaw(key);
    if (raw === null) return fallback;
    return raw === 'true' || raw === '1';
  }

  async getString(key: string, fallback: string): Promise<string> {
    const raw = await this.getRaw(key);
    return raw ?? fallback;
  }

  async list(category?: string): Promise<AppSetting[]> {
    return this.prisma.appSetting.findMany({
      where: category ? { category } : undefined,
      orderBy: [{ category: 'asc' }, { key: 'asc' }],
    });
  }

  async get(key: string): Promise<AppSetting> {
    const row = await this.prisma.appSetting.findUnique({ where: { key } });
    if (!row) throw new NotFoundException(`setting "${key}" not found`);
    return row;
  }

  /**
   * Update setting value. Validates against type / min / max.
   * Emits audit log with old → new value.
   */
  async set(
    key: string,
    rawValue: string,
    actor: { id: string; tenantId: string | null },
  ): Promise<AppSetting> {
    const existing = await this.prisma.appSetting.findUnique({ where: { key } });
    if (!existing) throw new NotFoundException(`setting "${key}" not found`);

    this.assertEditable(existing);

    const trimmed = rawValue.trim();
    this.validateValue(existing, trimmed);

    const updated = await this.prisma.appSetting.update({
      where: { key },
      data: {
        value: trimmed,
        updatedBy: actor.id,
      },
    });

    this.cache.delete(key);

    void this.audit.log({
      actorType: 'admin',
      actorId: actor.id,
      tenantId: actor.tenantId,
      action: 'APP_SETTING_UPDATED',
      target: key,
      metadata: {
        key,
        oldValue: existing.value,
        newValue: trimmed,
        type: existing.type,
        category: existing.category,
      },
    });

    return updated;
  }

  /**
   * Generic setter yalnızca UI-yönetilebilir skaler ayarları günceller. Yapısal
   * konfigürasyon (xml.dealer.<id> JSON, supplier kimlik eşlemeleri) kendi
   * doğrulamalı servisleri üzerinden değiştirilmelidir.
   */
  private assertEditable(setting: AppSetting): void {
    const isProtected =
      PROTECTED_CATEGORIES.has(setting.category) ||
      PROTECTED_KEY_PREFIXES.some((prefix) => setting.key.startsWith(prefix));
    if (isProtected) {
      throw new BadRequestException(
        `"${setting.key}" yapısal bir ayardır ve genel ayarlar ekranından düzenlenemez; ilgili yönetim ekranını kullanın.`,
      );
    }
  }

  private validateValue(setting: AppSetting, value: string): void {
    if (setting.type === 'number' || setting.type === 'decimal') {
      const n = Number(value);
      if (!Number.isFinite(n)) {
        throw new BadRequestException(
          `value for "${setting.key}" must be numeric`,
        );
      }
      if (setting.minValue && n < Number(setting.minValue)) {
        throw new BadRequestException(
          `value for "${setting.key}" below min ${setting.minValue}`,
        );
      }
      if (setting.maxValue && n > Number(setting.maxValue)) {
        throw new BadRequestException(
          `value for "${setting.key}" above max ${setting.maxValue}`,
        );
      }
    } else if (setting.type === 'boolean') {
      if (value !== 'true' && value !== 'false') {
        throw new BadRequestException(
          `value for "${setting.key}" must be 'true' or 'false'`,
        );
      }
    }
  }
}
