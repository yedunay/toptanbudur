import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomBytes, createHash, randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { AdminNotifierService } from '../mail/admin-notifier.service';
import { PermissionsService } from '../permissions/permissions.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

const BCRYPT_ROUNDS = 12;

// Access token TTL — refresh token rotasyonu olduğu için aşırı kısa tutmaya
// gerek yok; 1 saat hem refresh sıklığını düşürür hem de reuse-detection
// edge case'lerini azaltır. `JWT_EXPIRES_IN` env override edebilir.
const DEFAULT_ACCESS_TTL = '1h';
// Refresh token TTL — 30 gün.
const DEFAULT_REFRESH_TTL = '30d';
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const OTP_TTL_MS = 10 * 60 * 1000; // 10 dakika
// OTP brute-force koruması — bu kadar yanlış denemeden sonra kod yakılır.
const MAX_OTP_ATTEMPTS = 5;
const TRUSTED_DEVICE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 gün

// OTP politikası — backend .env üzerinden OTP_MODE ile yönetilir.
//   required : OTP herkes için zorunlu (default)
//   optional : User.otpEnabled değerine göre (self-service)
//   disabled : OTP herkes için kapalı (sadece email+şifre)
export type OtpMode = 'required' | 'optional' | 'disabled';

export function parseOtpMode(raw: string | undefined): OtpMode {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'optional' || v === 'disabled') return v;
  return 'required';
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    tenantId: string;
    role: string;
    mustChangePassword: boolean;
  };
  // Top-level convenience flag for clients that don't want to dig into `user`.
  mustChangePassword: boolean;
}

export interface OtpRequiredResult {
  otpRequired: true;
  // Opaque session token the client must send back with the OTP code.
  otpSession: string;
}

export type LoginResult = AuthResult | OtpRequiredResult;

export interface ChangePasswordResult {
  success: true;
  data: { changed: true };
}

export interface RefreshContext {
  userAgent?: string | null;
  ip?: string | null;
}

export interface VerifyOtpResult extends AuthResult {
  // Raw trusted device token (set as HttpOnly cookie by controller)
  trustedDeviceToken?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly permissions: PermissionsService,
    private readonly adminNotifier: AdminNotifierService,
  ) {}

  async register(dto: RegisterDto, ctx: RefreshContext = {}): Promise<AuthResult> {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existingUser) throw new ConflictException('Email already in use');

    const existingSlug = await this.prisma.tenant.findUnique({
      where: { slug: dto.tenantSlug },
    });
    if (existingSlug) throw new ConflictException('Tenant slug already taken');

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    const tenant = await this.prisma.tenant.create({
      data: {
        slug: dto.tenantSlug,
        name: dto.tenantName,
        users: {
          create: {
            email: dto.email,
            passwordHash,
            name: dto.name,
            role: 'OWNER',
          },
        },
      },
      include: { users: true },
    });

    const user = tenant.users[0];
    return this.issueTokenPair(
      {
        id: user.id,
        email: user.email,
        tenantId: tenant.id,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
      },
      ctx,
    );
  }

  getOtpMode(): OtpMode {
    return parseOtpMode(this.config.get<string>('OTP_MODE'));
  }

  async login(
    dto: LoginDto,
    ctx: RefreshContext & { trustedDeviceToken?: string } = {},
  ): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    // Role.CUSTOMER taşıyan User kayıtları admin paneline giremez —
    // müşteri girişi ayrı akıştadır (customer-auth). Bu uç yalnız
    // OWNER/ADMIN/MEMBER (panel) rolleri içindir.
    if (user.role === 'CUSTOMER') {
      throw new UnauthorizedException('Invalid credentials');
    }

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    const issueTokens = () =>
      this.issueTokenPair(
        {
          id: user.id,
          email: user.email,
          tenantId: user.tenantId,
          role: user.role,
          mustChangePassword: user.mustChangePassword,
        },
        ctx,
      );

    const mode = this.getOtpMode();

    // OTP_MODE=disabled → her durumda OTP'siz giriş.
    if (mode === 'disabled') return issueTokens();

    // OTP_MODE=optional + kullanıcı kapatmış → OTP'siz giriş.
    if (mode === 'optional' && !user.otpEnabled) return issueTokens();

    // Check trusted device cookie — if valid, skip OTP
    if (ctx.trustedDeviceToken) {
      const tokenHash = createHash('sha256').update(ctx.trustedDeviceToken).digest('hex');
      const device = await this.prisma.adminTrustedDevice.findUnique({
        where: { tokenHash },
      });
      if (device && device.userId === user.id && device.expiresAt > new Date()) {
        return issueTokens();
      }
    }

    // New / untrusted device — generate and send OTP.
    // 4 haneli kod — admin giriş ekranı 4 hane bekler (maxLength=4, pattern \d{4}).
    // randomInt kriptografik (CSPRNG); Math.random() PRNG'si yerine. padStart ile
    // baştaki sıfırlar korunur (0123 gibi). 10.000 kombinasyon; brute-force
    // MAX_OTP_ATTEMPTS=5 + 10 dk TTL + bcrypt ile sınırlandırılır.
    const otpCode = randomInt(0, 10_000).toString().padStart(4, '0');
    const codeHash = await bcrypt.hash(otpCode, BCRYPT_ROUNDS);
    const otpSession = randomBytes(32).toString('hex');

    await this.prisma.adminOtp.create({
      data: {
        userId: user.id,
        codeHash,
        otpSession,
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
    });

    // Fire-and-forget: send OTP email to user
    void this.mail.sendAdminOtp({
      to: user.email,
      name: user.name ?? user.email,
      code: otpCode,
    }).catch(() => {/* swallow — OTP still in DB */});

    return { otpRequired: true, otpSession };
  }

  async verifyOtp(
    payload: { otpSession: string; code: string; rememberMe?: boolean },
    ctx: RefreshContext = {},
  ): Promise<VerifyOtpResult> {
    const otp = await this.prisma.adminOtp.findUnique({
      where: { otpSession: payload.otpSession },
      include: { user: true },
    });

    if (!otp) throw new UnauthorizedException('Invalid OTP session');
    if (otp.usedAt) throw new UnauthorizedException('OTP already used');
    if (otp.expiresAt <= new Date()) throw new UnauthorizedException('OTP expired');
    // Brute-force tavanı — IP throttle çok-IP'li saldırıyla aşılabildiği için
    // kodun kendisine de deneme sınırı koyuyoruz.
    if (otp.attempts >= MAX_OTP_ATTEMPTS) {
      throw new UnauthorizedException('OTP locked: too many attempts');
    }

    const codeOk = await bcrypt.compare(payload.code, otp.codeHash);
    if (!codeOk) {
      // Yanlış denemeyi say; tavana ulaşınca kodu yakarak (usedAt) bir daha
      // denenemez kıl.
      const attempts = otp.attempts + 1;
      await this.prisma.adminOtp.update({
        where: { id: otp.id },
        data: {
          attempts,
          ...(attempts >= MAX_OTP_ATTEMPTS ? { usedAt: new Date() } : {}),
        },
      });
      throw new UnauthorizedException('Invalid OTP code');
    }

    // Mark OTP as used
    await this.prisma.adminOtp.update({
      where: { id: otp.id },
      data: { usedAt: new Date() },
    });

    const user = otp.user;
    const authResult = await this.issueTokenPair(
      {
        id: user.id,
        email: user.email,
        tenantId: user.tenantId,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
      },
      ctx,
    );

    void (async () => {
      try {
        const emails = await this.adminNotifier.resolveAdminEmails(user.tenantId);
        if (emails.length === 0) return;
        await this.mail.sendAdminNewDeviceLogin({
          to: emails,
          userName: user.name ?? user.email,
          userEmail: user.email,
          userAgent: ctx.userAgent ?? undefined,
          ip: ctx.ip ?? undefined,
        });
      } catch {
        // non-critical notification
      }
    })();

    if (!payload.rememberMe) return authResult;

    // Create trusted device record
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    await this.prisma.adminTrustedDevice.create({
      data: {
        userId: user.id,
        tokenHash,
        userAgent: ctx.userAgent ?? null,
        ip: ctx.ip ?? null,
        expiresAt: new Date(Date.now() + TRUSTED_DEVICE_TTL_MS),
      },
    });

    return { ...authResult, trustedDeviceToken: rawToken };
  }

  /**
   * POST /api/auth/auto-login
   *
   * Sadece HttpOnly `admin_trusted_device` cookie'sine güvenerek tam giriş yapar
   * (şifre + OTP atlanır). Aynı cihaz için 30 gün boyunca geçerli; cookie yoksa
   * / geçersizse / expire olduysa UnauthorizedException fırlatır ve frontend
   * sessizce login ekranına düşer.
   *
   * Güvenlik: cookie token'ı SHA-256 ile hash'lenmiş halde saklanır
   * (`AdminTrustedDevice.tokenHash`), reuse-detection refresh token tarafında
   * çalışmaya devam eder, OTP mailing burada tetiklenmez (yeni cihaz değil).
   */
  async autoLogin(
    trustedDeviceToken: string | undefined,
    ctx: RefreshContext = {},
  ): Promise<AuthResult> {
    if (!trustedDeviceToken) {
      throw new UnauthorizedException('trusted device cookie missing');
    }

    const tokenHash = createHash('sha256').update(trustedDeviceToken).digest('hex');
    const device = await this.prisma.adminTrustedDevice.findUnique({
      where: { tokenHash },
    });

    if (!device) {
      throw new UnauthorizedException('trusted device not found');
    }
    if (device.expiresAt <= new Date()) {
      throw new UnauthorizedException('trusted device expired');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: device.userId },
    });
    if (!user) {
      throw new UnauthorizedException('user not found');
    }
    if (user.role === 'CUSTOMER') {
      throw new UnauthorizedException('user not found');
    }

    return this.issueTokenPair(
      {
        id: user.id,
        email: user.email,
        tenantId: user.tenantId,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
      },
      ctx,
    );
  }

  /**
   * GET /api/auth/me — JWT'den dönenlerden öteye veriyi DB'den okur
   * (otpEnabled gibi runtime tercihler için). otpMode ile birlikte döner
   * ki frontend tek istekle hesap ekranını oluşturabilsin.
   */
  async getMe(userId: string): Promise<{
    id: string;
    email: string;
    name: string | null;
    tenantId: string;
    role: string;
    mustChangePassword: boolean;
    otpEnabled: boolean;
    profilePhotoUrl: string | null;
    otpMode: OtpMode;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        tenantId: true,
        role: true,
        mustChangePassword: true,
        otpEnabled: true,
        profilePhotoUrl: true,
      },
    });
    if (!user) throw new UnauthorizedException('user not found');
    return { ...user, otpMode: this.getOtpMode() };
  }

  /**
   * POST /api/auth/me/otp — kullanıcı kendi 2FA tercihini değiştirir.
   * Sadece OTP_MODE=optional iken anlamlı; diğer modlarda 400 döner.
   */
  async setOwnOtpEnabled(
    userId: string,
    enabled: boolean,
  ): Promise<{ success: true; data: { otpEnabled: boolean; otpMode: OtpMode } }> {
    const mode = this.getOtpMode();
    if (mode !== 'optional') {
      throw new ConflictException(
        mode === 'required'
          ? 'OTP sistem ayarı zorunlu olduğu için değiştirilemez'
          : 'OTP sistem ayarı kapalı olduğu için değiştirilemez',
      );
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { otpEnabled: enabled },
    });
    return { success: true, data: { otpEnabled: enabled, otpMode: mode } };
  }

  /**
   * POST /api/auth/change-password
   *
   * `mustChangePassword === true` olan kullanıcılar yalnızca yeni şifreyi
   * sağlamak zorunda (bayi onayında tek kullanımlık random parola veya admin
   * tarafından sabit "toptan1234" sıfırlaması verildi). Diğer kullanıcılar
   * mevcut şifreyi de doğrulamak zorunda.
   */
  async changePassword(
    userId: string,
    payload: { currentPassword?: string; newPassword: string },
  ): Promise<ChangePasswordResult> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        passwordHash: true,
        mustChangePassword: true,
      },
    });
    if (!user) throw new UnauthorizedException('user not found');

    if (!user.mustChangePassword) {
      if (!payload.currentPassword) {
        throw new UnauthorizedException('current password required');
      }
      const ok = await bcrypt.compare(payload.currentPassword, user.passwordHash);
      if (!ok) throw new UnauthorizedException('current password is incorrect');
    }

    // Yeni şifre politikası: en az 12 karakter + en az 1 harf + en az 1 rakam.
    const newPassword = payload.newPassword ?? '';
    const hasLetter = /[A-Za-z]/.test(newPassword);
    const hasDigit = /[0-9]/.test(newPassword);
    if (newPassword.length < 12 || !hasLetter || !hasDigit) {
      throw new UnauthorizedException(
        'yeni şifre en az 12 karakter olmalı ve en az bir harf ile bir rakam içermeli',
      );
    }

    const passwordHash = await bcrypt.hash(payload.newPassword, BCRYPT_ROUNDS);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          passwordHash,
          mustChangePassword: false,
        },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    return { success: true, data: { changed: true } };
  }

  /**
   * Refresh token kullanılarak yeni bir access+refresh çifti üretir.
   *
   * Rotasyon: kullanılan jti revoke edilir (revokedAt set), aynı
   * kullanıcıya yeni bir jti açılır. Eğer jti zaten revoke edilmişse
   * (token yeniden kullanım denemesi) hata fırlatılır — saldırı işareti
   * olarak değerlendirilebilir; defansif davranmak için kullanıcının diğer
   * tüm aktif refresh token'ları da revoke edilir.
   */
  async refresh(
    payload: { sub: string; jti: string },
    ctx: RefreshContext = {},
  ): Promise<AuthResult> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { jti: payload.jti },
    });

    if (!stored) {
      throw new UnauthorizedException('refresh token not found');
    }
    if (stored.userId !== payload.sub) {
      throw new UnauthorizedException('refresh token user mismatch');
    }
    if (stored.revokedAt) {
      // Token reuse detected — kullanıcının tüm aktif refresh token'larını revoke et.
      await this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('refresh token already used');
    }
    if (stored.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('refresh token expired');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: stored.userId },
    });
    if (!user) throw new UnauthorizedException('user not found');

    // Eski jti'yi revoke et — atomik olmasa bile rotasyonun ilkesi: eski
    // jti reuse edilirse yukarıdaki `if (stored.revokedAt)` tetiklenir.
    await this.prisma.refreshToken.update({
      where: { jti: payload.jti },
      data: { revokedAt: new Date() },
    });

    return this.issueTokenPair(
      {
        id: user.id,
        email: user.email,
        tenantId: user.tenantId,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
      },
      ctx,
    );
  }

  /**
   * Belirtilen refresh jti'yi revoke eder. Tekrar kullanım girişimi
   * `refresh()` içinde yakalanır. Idempotent — kayıt yoksa veya zaten
   * revoke edilmişse sessizce başarılı döner.
   */
  async logout(payload: { sub: string; jti: string }): Promise<{ success: true; data: { loggedOut: true } }> {
    await this.prisma.refreshToken.updateMany({
      where: { jti: payload.jti, userId: payload.sub, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { success: true, data: { loggedOut: true } };
  }

  /**
   * Bir kullanıcının TÜM aktif refresh token'larını revoke eder. Bu, hedef
   * kullanıcının elindeki access token TTL'i dolar dolmaz (max 15dk)
   * otomatik olarak çıkış yapmasını sağlar.
   *
   * NOT: Anında etki için ileride access-token blacklist (Redis) eklenebilir;
   * şimdilik 15dk pencere kabul edilebilir bir gecikme.
   */
  async revokeAllSessions(userId: string): Promise<{ revoked: number }> {
    const res = await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { revoked: res.count };
  }

  /**
   * Access + refresh token çifti üretir, yeni refresh kaydını DB'ye yazar.
   * `crypto.randomBytes` ile CSPRNG-jti — Math.random kesinlikle değil.
   */
  private async issueTokenPair(
    user: {
      id: string;
      email: string;
      tenantId: string;
      role: string;
      mustChangePassword: boolean;
    },
    ctx: RefreshContext = {},
  ): Promise<AuthResult> {
    const accessTtl = this.config.get<string>('JWT_EXPIRES_IN', DEFAULT_ACCESS_TTL);
    const refreshTtl = this.config.get<string>('JWT_REFRESH_EXPIRES_IN', DEFAULT_REFRESH_TTL);
    const refreshSecret = this.config.getOrThrow<string>('JWT_REFRESH_SECRET');

    // Sayfa izinleri — JWT payload'ında taşınır. OWNER `['*']` döner.
    // Hata durumunda boş listeyle devam ederiz (login'i bozmak yerine
    // kullanıcı sayfasız bir oturum açar; PagePermissionGuard 403 üretir).
    let pagePermissions: string[] = [];
    try {
      pagePermissions = await this.permissions.getJwtPermissions(user.id);
    } catch {
      pagePermissions = [];
    }

    const accessToken = this.jwt.sign(
      {
        sub: user.id,
        email: user.email,
        tenantId: user.tenantId,
        role: user.role,
        permissions: pagePermissions,
      },
      { expiresIn: accessTtl as any },
    );

    const jti = randomBytes(32).toString('hex');
    const refreshToken = this.jwt.sign(
      { sub: user.id, jti, type: 'refresh' },
      { secret: refreshSecret, expiresIn: refreshTtl as any },
    );

    await this.prisma.refreshToken.create({
      data: {
        jti,
        userId: user.id,
        tenantId: user.tenantId,
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
        userAgent: ctx.userAgent ?? null,
        ip: ctx.ip ?? null,
      },
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        tenantId: user.tenantId,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
      },
      mustChangePassword: user.mustChangePassword,
    };
  }
}
