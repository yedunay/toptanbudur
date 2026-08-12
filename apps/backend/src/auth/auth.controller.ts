import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtRefreshGuard } from './jwt-refresh.guard';
import type { RequestUser } from './jwt.strategy';
import type { JwtRefreshPayload } from './jwt-refresh.strategy';

const TRUSTED_DEVICE_COOKIE = 'admin_trusted_device';
const TRUSTED_DEVICE_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 gün

function extractContext(req: Request): { userAgent?: string | null; ip?: string | null } {
  const userAgent = req.headers['user-agent'] ?? null;
  const ip = (req.ip || req.socket?.remoteAddress) ?? null;
  return {
    userAgent: typeof userAgent === 'string' ? userAgent : null,
    ip,
  };
}

/**
 * Prod'da admin paneli (admin.toptanbudur.com) ile API (api.toptanbudur.com)
 * farklı origin'lerde çalıştığı için cookie'nin POST /auth/login üzerinde
 * tarayıcıdan gönderilmesi için `SameSite=None; Secure` ZORUNLU. Dev'de
 * her şey localhost üzerinden gittiği için `lax` yeterli ve `Secure` olmadan
 * çalışabilir.
 *
 * `COOKIE_DOMAIN` env'i set edilmişse (örn. `.toptanbudur.com`) cookie
 * kök domain'e bağlanır, böylece prod'da ana domain ve subdomain'ler arası
 * paylaşılır.
 */
function trustedDeviceCookieOptions(isProd: boolean) {
  const domain = process.env.COOKIE_DOMAIN || undefined;
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? ('none' as const) : ('lax' as const),
    maxAge: TRUSTED_DEVICE_MAX_AGE,
    path: '/',
    ...(domain ? { domain } : {}),
  };
}

function setTrustedDeviceCookie(res: Response, token: string, isProd: boolean): void {
  res.cookie(TRUSTED_DEVICE_COOKIE, token, trustedDeviceCookieOptions(isProd));
}

function clearTrustedDeviceCookie(res: Response, isProd: boolean): void {
  const { maxAge: _drop, ...rest } = trustedDeviceCookieOptions(isProd);
  res.clearCookie(TRUSTED_DEVICE_COOKIE, rest);
}

@Controller('auth')
export class AuthController {
  private readonly isProd: boolean;

  constructor(private readonly auth: AuthService) {
    this.isProd = process.env.NODE_ENV === 'production';
  }

  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  @Post('register')
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.auth.register(dto, extractContext(req));
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Req() req: Request) {
    const trustedDeviceToken = req.cookies?.[TRUSTED_DEVICE_COOKIE] as string | undefined;
    return this.auth.login(dto, { ...extractContext(req), trustedDeviceToken });
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('verify-otp')
  @HttpCode(200)
  async verifyOtp(
    @Body() body: { otpSession: string; code: string; rememberMe?: boolean },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.verifyOtp(
      { otpSession: body.otpSession, code: body.code, rememberMe: body.rememberMe },
      extractContext(req),
    );

    if (result.trustedDeviceToken) {
      setTrustedDeviceCookie(res, result.trustedDeviceToken, this.isProd);
    }

    // Don't expose raw token in response body
    const { trustedDeviceToken: _drop, ...safeResult } = result;
    return safeResult;
  }

  /**
   * POST /api/auth/auto-login
   *
   * Şifresiz, OTP'siz giriş — sadece HttpOnly `admin_trusted_device` cookie'siyle
   * çalışır. Cookie yoksa/expire olduysa 401 döner; frontend bu durumda
   * sessizce login formunu gösterir.
   *
   * Rate limit: throttling brute force'ı engelleyecek kadar sıkı tutuldu,
   * normal kullanımda çok seyrek tetiklenir (cihaz mount başına 1 kez).
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('auto-login')
  @HttpCode(200)
  autoLogin(@Req() req: Request) {
    const trustedDeviceToken = req.cookies?.[TRUSTED_DEVICE_COOKIE] as string | undefined;
    return this.auth.autoLogin(trustedDeviceToken, extractContext(req));
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: Request & { user: RequestUser }) {
    return this.auth.getMe(req.user.id);
  }

  /**
   * POST /api/auth/me/otp
   *
   * Kullanıcı kendi 2FA tercihini değiştirir. Sadece OTP_MODE=optional
   * iken kabul edilir; aksi halde 409.
   */
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('me/otp')
  @HttpCode(200)
  setOwnOtp(
    @Body() body: { enabled: boolean },
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.auth.setOwnOtpEnabled(req.user.id, !!body.enabled);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('change-password')
  @HttpCode(200)
  changePassword(
    @Body() dto: ChangePasswordDto,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.auth.changePassword(req.user.id, {
      currentPassword: dto.currentPassword,
      newPassword: dto.newPassword,
    });
  }

  /**
   * POST /api/auth/refresh
   *
   * Authorization: Bearer <refreshToken>
   * Yeni bir access+refresh çifti döner; eski refresh jti revoke edilir.
   */
  @UseGuards(JwtRefreshGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  refresh(@Req() req: Request & { user: JwtRefreshPayload }) {
    return this.auth.refresh(
      { sub: req.user.sub, jti: req.user.jti },
      extractContext(req),
    );
  }

  /**
   * POST /api/auth/logout
   *
   * Authorization: Bearer <refreshToken>
   * Refresh token jti'sini revoke eder + trusted device cookie'sini siler.
   * Idempotent.
   */
  @UseGuards(JwtRefreshGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('logout')
  @HttpCode(200)
  async logout(
    @Req() req: Request & { user: JwtRefreshPayload },
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.logout({ sub: req.user.sub, jti: req.user.jti });
    clearTrustedDeviceCookie(res, this.isProd);
    return result;
  }
}
