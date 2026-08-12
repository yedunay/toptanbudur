import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import type { Request } from 'express';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { PermissionsService } from '../../permissions/permissions.service';
import { MailService } from '../../mail/mail.service';
import { AdminNotifierService } from '../../mail/admin-notifier.service';
import { parseOtpMode, type OtpMode } from '../../auth/auth.service';
import { STORAGE_SERVICE } from '../../storage/storage.constants';
import type { IFileStorage } from '../../storage/storage.interface';
import { detectImage } from '../../common/utils/image-magic-bytes';
import type { CreateUserDto } from './dto/create-user.dto';
import type { UpdateUserDto } from './dto/update-user.dto';

const BCRYPT_ROUNDS = 12;

export const MAX_PROFILE_PHOTO_BYTES = 2 * 1024 * 1024;

export interface ProfilePhotoInput {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

/**
 * Admin panel kullanıcıları (User tablosu) için CRUD.
 *
 * Güvenlik kuralları:
 *  - Sadece OWNER/ADMIN erişebilir (controller-level RolesGuard).
 *  - OWNER rolüne sahip son kullanıcı SİLİNEMEZ (tenant'a kilitleme riski).
 *  - OWNER rolünden ADMIN/MEMBER'a indiren işlem son OWNER'sa engellenir.
 *  - Self-delete engellenir (admin kendi hesabını silemez).
 *  - Şifre policy: 12+ karakter, harf + rakam (auth.service.ts ile aynı).
 *  - Tüm değişimler audit log'a yazılır.
 */
/**
 * Stored `profilePhotoUrl` may be either:
 *  - Local driver: `/api/storage/users/<id>/<uuid>.jpg?exp=...&sig=...`
 *  - R2 driver:    `https://cdn.example.com/users/<id>/<uuid>.jpg` (or presigned)
 * We need the raw `key` (`users/<id>/<uuid>.jpg`) to call storage.delete().
 * Strip the protocol/host, the `/api/storage/` prefix, and the query string.
 */
function extractStorageKey(urlOrKey: string): string | null {
  if (!urlOrKey) return null;
  let s = urlOrKey;
  s = s.split('?')[0];
  const idx = s.indexOf('/api/storage/');
  if (idx >= 0) {
    s = s.slice(idx + '/api/storage/'.length);
  } else {
    try {
      const u = new URL(urlOrKey);
      s = u.pathname.replace(/^\/+/, '');
    } catch {
      s = s.replace(/^\/+/, '');
    }
  }
  return s || null;
}

@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly adminNotifier: AdminNotifierService,
    private readonly permissions: PermissionsService,
    @Optional()
    @Inject(STORAGE_SERVICE)
    private readonly storage?: IFileStorage,
  ) {}

  getOtpMode(): OtpMode {
    return parseOtpMode(this.config.get<string>('OTP_MODE'));
  }

  async list(tenantId: string) {
    const rows = await this.prisma.user.findMany({
      where: { tenantId },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        mustChangePassword: true,
        otpEnabled: true,
        profilePhotoUrl: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return { success: true, data: rows, otpMode: this.getOtpMode() };
  }

  async create(
    tenantId: string,
    dto: CreateUserDto,
    actor: { id: string; tenantId: string; email?: string; role?: string },
    req?: Request,
  ) {
    // #1 Yetki yükseltme koruması: yalnız OWNER aktör yeni bir OWNER
    // oluşturabilir. ADMIN aktör OWNER rolü atayamaz (kendini/başkasını
    // OWNER seviyesine yükseltemez).
    if (dto.role === 'OWNER' && actor.role !== 'OWNER') {
      throw new ForbiddenException(
        'Yalnızca OWNER rolündeki kullanıcılar OWNER atayabilir',
      );
    }

    this.assertPasswordPolicy(dto.password);

    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });
    if (existing) throw new ConflictException('Bu e-posta zaten kullanılıyor');

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    const created = await this.prisma.user.create({
      data: {
        tenantId,
        email: dto.email,
        name: dto.name,
        role: dto.role,
        passwordHash,
        mustChangePassword: true, // ilk login'de yeni şifre zorla
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        mustChangePassword: true,
        createdAt: true,
      },
    });

    const actorEmail = actor.email ?? actor.id;
    void this.audit.record({
      action: 'ADMIN_USER_CREATED',
      summary: `${actorEmail} '${created.email}' kullanıcısını (${created.role}) oluşturdu`,
      actor: {
        type: 'admin',
        id: actor.id,
        email: actor.email ?? null,
        name: actor.email ?? null,
        tenantId: actor.tenantId,
      },
      target: { id: created.id, type: 'admin-user', label: created.email },
      after: {
        email: created.email,
        name: created.name,
        role: created.role,
      },
      req: req ?? null,
    });

    void (async () => {
      try {
        const [actorUser, emails] = await Promise.all([
          this.prisma.user.findUnique({ where: { id: actor.id }, select: { name: true, email: true } }),
          this.adminNotifier.resolveAdminEmails(tenantId),
        ]);
        if (emails.length === 0) {
          this.logger.warn(
            `[admin.user.create] admin notification skipped — tenant=${tenantId} aktif OWNER/ADMIN yok newUserId=${created.id}`,
          );
          return;
        }
        await this.mail.sendAdminNewAdmin({
          to: emails,
          newAdminName: created.name ?? created.email,
          newAdminEmail: created.email,
          addedByName: actorUser?.name ?? actorUser?.email ?? actor.id,
        });
      } catch (e) {
        this.logger.warn(`new admin notification mail failed: ${(e as Error).message}`);
      }
    })();

    return { success: true, data: created };
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateUserDto,
    actor: { id: string; tenantId: string; email?: string; role?: string },
    req?: Request,
  ) {
    const existing = await this.prisma.user.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        otpEnabled: true,
      },
    });
    if (!existing) throw new NotFoundException('Kullanıcı bulunamadı');

    // #1 Yetki yükseltme koruması (ADMIN aktör için). OWNER aktör bu kontrollerin
    // hiçbirine takılmaz (tam yetkili).
    if (actor.role !== 'OWNER') {
      // (a) ADMIN, kimseye (kendine/başkasına) OWNER rolü ATAYAMAZ.
      if (dto.role === 'OWNER') {
        throw new ForbiddenException(
          'Yalnızca OWNER rolündeki kullanıcılar OWNER atayabilir',
        );
      }
      // (b) ADMIN kendi rolünü değiştiremez (kendini yükseltme/indirme yok).
      if (id === actor.id && dto.role !== undefined && dto.role !== existing.role) {
        throw new ForbiddenException('Kendi rolünüzü değiştiremezsiniz');
      }
      // (c) ADMIN bir OWNER hedefin rolünü veya parolasını değiştiremez.
      if (existing.role === 'OWNER' && (dto.role !== undefined || dto.password !== undefined)) {
        throw new ForbiddenException(
          'OWNER kullanıcının rolü veya parolası yalnızca OWNER tarafından değiştirilebilir',
        );
      }
    }

    // Son OWNER'ı ADMIN/MEMBER'a indirmeyi engelle
    if (dto.role && dto.role !== 'OWNER' && existing.role === 'OWNER') {
      const ownerCount = await this.prisma.user.count({
        where: { tenantId, role: 'OWNER' },
      });
      if (ownerCount <= 1) {
        throw new BadRequestException(
          'Son OWNER kullanıcının rolü değiştirilemez (en az bir OWNER kalmalı)',
        );
      }
    }

    // otpEnabled sadece OTP_MODE=optional iken anlam ifade ediyor; diğer
    // modlarda yanlış UI durumunu önlemek için sessizce yok saymak yerine
    // hata atıyoruz.
    if (dto.otpEnabled !== undefined) {
      const mode = this.getOtpMode();
      if (mode !== 'optional') {
        throw new BadRequestException(
          mode === 'required'
            ? 'OTP sistem ayarı "zorunlu" — kullanıcı bazında değiştirilemez'
            : 'OTP sistem ayarı "kapalı" — kullanıcı bazında değiştirilemez',
        );
      }
    }

    const data: {
      name?: string;
      role?: 'OWNER' | 'ADMIN' | 'MEMBER';
      passwordHash?: string;
      mustChangePassword?: boolean;
      otpEnabled?: boolean;
    } = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.password !== undefined) {
      this.assertPasswordPolicy(dto.password);
      data.passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
      data.mustChangePassword = true; // admin-set parola → user ilk login'de değiştirsin
    }
    if (dto.otpEnabled !== undefined) data.otpEnabled = dto.otpEnabled;

    const updated = await this.prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        mustChangePassword: true,
        otpEnabled: true,
        updatedAt: true,
      },
    });

    // Rol değişimi izin defaultlarını değiştirir — guard'ın canlı izin
    // cache'ini düşür ki yeni rol anında etkili olsun.
    if (dto.role !== undefined) this.permissions.invalidateLiveCache(id);

    const actorEmail = actor.email ?? actor.id;
    const roleChanged = dto.role !== undefined && existing.role !== updated.role;
    const passwordReset = dto.password !== undefined;
    let summary: string;
    if (roleChanged && passwordReset) {
      summary = `${actorEmail} '${existing.email}' kullanıcısının rolünü ${existing.role} → ${updated.role} değiştirdi ve şifresini sıfırladı`;
    } else if (roleChanged) {
      summary = `${actorEmail} '${existing.email}' kullanıcısının rolünü ${existing.role} → ${updated.role} olarak değiştirdi`;
    } else if (passwordReset) {
      summary = `${actorEmail} '${existing.email}' kullanıcısının şifresini sıfırladı`;
    } else if (dto.otpEnabled !== undefined && existing.otpEnabled !== updated.otpEnabled) {
      summary = `${actorEmail} '${existing.email}' kullanıcısının iki adımlı doğrulamasını ${updated.otpEnabled ? 'açtı' : 'kapattı'}`;
    } else {
      summary = `${actorEmail} '${existing.email}' kullanıcısının bilgilerini güncelledi`;
    }

    void this.audit.record({
      action: 'ADMIN_USER_UPDATED',
      summary,
      actor: {
        type: 'admin',
        id: actor.id,
        email: actor.email ?? null,
        name: actor.email ?? null,
        tenantId: actor.tenantId,
      },
      target: { id, type: 'admin-user', label: existing.email },
      before: {
        name: existing.name,
        role: existing.role,
        otpEnabled: existing.otpEnabled,
      },
      after: {
        name: updated.name,
        role: updated.role,
        otpEnabled: updated.otpEnabled,
        passwordReset,
      },
      req: req ?? null,
    });

    return { success: true, data: updated };
  }

  async remove(
    tenantId: string,
    id: string,
    actor: { id: string; tenantId: string; email?: string },
    req?: Request,
  ) {
    if (id === actor.id) {
      throw new ForbiddenException('Kendi hesabını silemezsin');
    }

    const existing = await this.prisma.user.findFirst({
      where: { id, tenantId },
      select: { id: true, email: true, name: true, role: true },
    });
    if (!existing) throw new NotFoundException('Kullanıcı bulunamadı');

    if (existing.role === 'OWNER') {
      const ownerCount = await this.prisma.user.count({
        where: { tenantId, role: 'OWNER' },
      });
      if (ownerCount <= 1) {
        throw new BadRequestException(
          'Son OWNER kullanıcı silinemez (en az bir OWNER kalmalı)',
        );
      }
    }

    await this.prisma.user.delete({ where: { id } });
    this.permissions.invalidateLiveCache(id);

    const actorEmail = actor.email ?? actor.id;
    void this.audit.record({
      action: 'ADMIN_USER_DELETED',
      summary: `${actorEmail} '${existing.email}' kullanıcısını (${existing.role}) sildi`,
      actor: {
        type: 'admin',
        id: actor.id,
        email: actor.email ?? null,
        name: actor.email ?? null,
        tenantId: actor.tenantId,
      },
      target: { id, type: 'admin-user', label: existing.email },
      before: {
        email: existing.email,
        name: existing.name,
        role: existing.role,
      },
      req: req ?? null,
    });

    return { success: true, data: { id } };
  }

  /**
   * Profil fotoğrafı yükler. Magic-byte ile gerçek MIME doğrulanır (sahte
   * Content-Type'lar reddedilir). Eski foto varsa silinir, yenisi `users/<id>/`
   * altına yazılır. Yetki kontrolü controller'da yapılır:
   *  - Kendi fotoğrafına herkes (OWNER/ADMIN/MEMBER) erişebilir
   *  - Başkasının fotoğrafına sadece OWNER/ADMIN
   */
  async uploadPhoto(
    tenantId: string,
    targetUserId: string,
    actor: { id: string; tenantId: string; role: string; email?: string },
    input: ProfilePhotoInput,
    req?: Request,
  ): Promise<{ success: true; data: { id: string; profilePhotoUrl: string } }> {
    if (!this.storage) {
      throw new BadRequestException('Dosya depolama yapılandırılmamış');
    }
    if (input.size > MAX_PROFILE_PHOTO_BYTES) {
      throw new BadRequestException(
        `Fotoğraf en fazla ${Math.floor(MAX_PROFILE_PHOTO_BYTES / 1024 / 1024)} MB olabilir`,
      );
    }
    const detected = detectImage(input.buffer);
    if (!detected) {
      throw new BadRequestException(
        'Yalnızca JPEG, PNG veya WEBP fotoğraflar yüklenebilir',
      );
    }

    const target = await this.prisma.user.findFirst({
      where: { id: targetUserId, tenantId },
      select: { id: true, email: true, profilePhotoUrl: true },
    });
    if (!target) throw new NotFoundException('Kullanıcı bulunamadı');

    if (target.id !== actor.id && actor.role !== 'OWNER' && actor.role !== 'ADMIN') {
      throw new ForbiddenException('Başka kullanıcının fotoğrafını değiştiremezsiniz');
    }

    const key = `users/${target.id}/${randomUUID()}.${detected.extension}`;
    const uploaded = await this.storage.upload(key, input.buffer, detected.mimetype);
    // DURABLE url: profilePhotoUrl is persisted and rendered for the user's
    // lifetime. upload()'s short-lived url would 403 ~10 min later — same bug
    // class as manual-product images. Re-sign from the stable key.
    const photoUrl = await this.storage.getPublicUrl(uploaded.key);

    if (target.profilePhotoUrl) {
      const oldKey = extractStorageKey(target.profilePhotoUrl);
      if (oldKey && oldKey !== uploaded.key) {
        void this.storage.delete(oldKey).catch((err: unknown) => {
          this.logger.warn(
            `profile photo old delete failed user=${target.id} key=${oldKey} err=${(err as Error)?.message ?? 'unknown'}`,
          );
        });
      }
    }

    const updated = await this.prisma.user.update({
      where: { id: target.id },
      data: { profilePhotoUrl: photoUrl },
      select: { id: true, profilePhotoUrl: true },
    });

    const actorEmail = actor.email ?? actor.id;
    const isSelf = target.id === actor.id;
    void this.audit.record({
      action: isSelf ? 'ADMIN_USER_PHOTO_SELF_UPDATED' : 'ADMIN_USER_PHOTO_UPDATED',
      summary: isSelf
        ? `${actorEmail} profil fotoğrafını güncelledi`
        : `${actorEmail} '${target.email}' kullanıcısının profil fotoğrafını güncelledi`,
      actor: {
        type: 'admin',
        id: actor.id,
        email: actor.email ?? null,
        name: actor.email ?? null,
        tenantId: actor.tenantId,
      },
      target: { id: target.id, type: 'admin-user', label: target.email },
      extra: { size: input.size, mimetype: detected.mimetype },
      req: req ?? null,
    });

    return {
      success: true,
      data: { id: updated.id, profilePhotoUrl: updated.profilePhotoUrl ?? '' },
    };
  }

  async deletePhoto(
    tenantId: string,
    targetUserId: string,
    actor: { id: string; tenantId: string; role: string; email?: string },
    req?: Request,
  ): Promise<{ success: true; data: { id: string } }> {
    const target = await this.prisma.user.findFirst({
      where: { id: targetUserId, tenantId },
      select: { id: true, email: true, profilePhotoUrl: true },
    });
    if (!target) throw new NotFoundException('Kullanıcı bulunamadı');

    if (target.id !== actor.id && actor.role !== 'OWNER' && actor.role !== 'ADMIN') {
      throw new ForbiddenException('Başka kullanıcının fotoğrafını değiştiremezsiniz');
    }

    if (target.profilePhotoUrl && this.storage) {
      const oldKey = extractStorageKey(target.profilePhotoUrl);
      if (oldKey) {
        void this.storage.delete(oldKey).catch((err: unknown) => {
          this.logger.warn(
            `profile photo delete failed user=${target.id} key=${oldKey} err=${(err as Error)?.message ?? 'unknown'}`,
          );
        });
      }
    }

    await this.prisma.user.update({
      where: { id: target.id },
      data: { profilePhotoUrl: null },
    });

    const actorEmail = actor.email ?? actor.id;
    const isSelf = target.id === actor.id;
    void this.audit.record({
      action: isSelf ? 'ADMIN_USER_PHOTO_SELF_DELETED' : 'ADMIN_USER_PHOTO_DELETED',
      summary: isSelf
        ? `${actorEmail} profil fotoğrafını kaldırdı`
        : `${actorEmail} '${target.email}' kullanıcısının profil fotoğrafını kaldırdı`,
      actor: {
        type: 'admin',
        id: actor.id,
        email: actor.email ?? null,
        name: actor.email ?? null,
        tenantId: actor.tenantId,
      },
      target: { id: target.id, type: 'admin-user', label: target.email },
      req: req ?? null,
    });

    return { success: true, data: { id: target.id } };
  }

  /**
   * Aktif refresh token oturumlarını listeler. revokedAt IS NULL ve expiresAt
   * > now() olanlar "aktif" sayılır. jti güvenlik gereği truncate edilir
   * (sadece son 8 karakter UI'da gösterilir).
   */
  async listSessions(
    tenantId: string,
    targetUserId: string,
  ): Promise<{
    success: true;
    data: Array<{
      id: string;
      jtiSuffix: string;
      userAgent: string | null;
      ip: string | null;
      createdAt: Date;
      expiresAt: Date;
    }>;
  }> {
    const target = await this.prisma.user.findFirst({
      where: { id: targetUserId, tenantId },
      select: { id: true },
    });
    if (!target) throw new NotFoundException('Kullanıcı bulunamadı');

    const now = new Date();
    const rows = await this.prisma.refreshToken.findMany({
      where: {
        userId: target.id,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        jti: true,
        userAgent: true,
        ip: true,
        createdAt: true,
        expiresAt: true,
      },
    });

    return {
      success: true,
      data: rows.map((r) => ({
        id: r.id,
        jtiSuffix: r.jti.slice(-8),
        userAgent: r.userAgent,
        ip: r.ip,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
      })),
    };
  }

  /**
   * Tüm aktif oturumları zorla kapatır (admin tarafından). Kendi oturumunu
   * kapatmak isterse /me/logout-all kendi controller'ından yapılır;
   * burada self-action engellenir, çünkü admin UI'da yanlışlıkla
   * kendisini kilitlemesini önleriz.
   */
  async revokeAllSessions(
    tenantId: string,
    targetUserId: string,
    actor: { id: string; tenantId: string; email?: string },
    req?: Request,
  ): Promise<{ success: true; data: { revokedCount: number } }> {
    if (targetUserId === actor.id) {
      throw new ForbiddenException(
        'Kendi oturumlarını bu menüden kapatamazsın — Hesap → Çıkış yap kullan',
      );
    }

    const target = await this.prisma.user.findFirst({
      where: { id: targetUserId, tenantId },
      select: { id: true, email: true },
    });
    if (!target) throw new NotFoundException('Kullanıcı bulunamadı');

    const result = await this.prisma.refreshToken.updateMany({
      where: {
        userId: target.id,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });

    const actorEmail = actor.email ?? actor.id;
    void this.audit.record({
      action: 'ADMIN_USER_SESSIONS_REVOKED',
      summary:
        result.count > 0
          ? `${actorEmail} '${target.email}' kullanıcısının ${result.count} aktif oturumunu sonlandırdı`
          : `${actorEmail} '${target.email}' kullanıcısının oturumlarını sonlandırmaya çalıştı (aktif oturum bulunamadı)`,
      actor: {
        type: 'admin',
        id: actor.id,
        email: actor.email ?? null,
        name: actor.email ?? null,
        tenantId: actor.tenantId,
      },
      target: { id: target.id, type: 'admin-user', label: target.email },
      extra: { revokedCount: result.count },
      req: req ?? null,
    });

    return { success: true, data: { revokedCount: result.count } };
  }

  /**
   * Şifre değişikliği zorlar: mustChangePassword=true + tüm aktif oturumları
   * kapatır. Kullanıcı bir sonraki login'de yeni şifre belirlemek zorunda
   * kalır. Self-action engellenir.
   */
  async forcePasswordReset(
    tenantId: string,
    targetUserId: string,
    actor: { id: string; tenantId: string; email?: string },
    req?: Request,
  ): Promise<{ success: true; data: { id: string; revokedCount: number } }> {
    if (targetUserId === actor.id) {
      throw new ForbiddenException('Kendi hesabın için bu işlemi başlatamazsın');
    }

    const target = await this.prisma.user.findFirst({
      where: { id: targetUserId, tenantId },
      select: { id: true, email: true, role: true },
    });
    if (!target) throw new NotFoundException('Kullanıcı bulunamadı');

    const [, revokeResult] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: target.id },
        data: { mustChangePassword: true },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: target.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    const actorEmail = actor.email ?? actor.id;
    void this.audit.record({
      action: 'ADMIN_USER_FORCE_PASSWORD_RESET',
      summary: `${actorEmail} '${target.email}' kullanıcısına zorunlu şifre sıfırlama uyguladı${
        revokeResult.count > 0 ? ` (${revokeResult.count} oturum sonlandırıldı)` : ''
      }`,
      actor: {
        type: 'admin',
        id: actor.id,
        email: actor.email ?? null,
        name: actor.email ?? null,
        tenantId: actor.tenantId,
      },
      target: { id: target.id, type: 'admin-user', label: target.email },
      extra: { role: target.role, revokedCount: revokeResult.count },
      req: req ?? null,
    });

    return {
      success: true,
      data: { id: target.id, revokedCount: revokeResult.count },
    };
  }

  private assertPasswordPolicy(password: string): void {
    const hasLetter = /[A-Za-z]/.test(password);
    const hasDigit = /[0-9]/.test(password);
    if (password.length < 12 || !hasLetter || !hasDigit) {
      throw new BadRequestException(
        'Şifre en az 12 karakter olmalı ve en az bir harf ile bir rakam içermeli',
      );
    }
  }
}
