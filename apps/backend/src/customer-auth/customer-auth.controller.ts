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
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import { CustomerAuthService } from './customer-auth.service';
import { AuditService } from '../audit/audit.service';
import { LoginCustomerDto } from './dto/login-customer.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ValidateResetTokenDto } from './dto/validate-reset-token.dto';
import {
  CustomerJwtGuard,
  type CustomerJwtPayload,
  type RequestWithCustomer,
} from './customer-jwt.guard';
import {
  SESSION_COOKIE_NAME,
  clearSessionCookie,
  readSessionCookie,
  setSessionCookie,
} from './session-cookie';

@Controller('customer/auth')
export class CustomerAuthController {
  constructor(
    private readonly auth: CustomerAuthService,
    private readonly audit: AuditService,
    private readonly jwt: JwtService,
  ) {}

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginCustomerDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // #2: trust proxy=1 sayesinde req.ip nginx arkasındaki gerçek istemci
    // IP'sini taşır → per-IP başarısız deneme sayacı doğru çalışır.
    const result = await this.auth.login(dto, req.ip);
    setSessionCookie(res, result.accessToken);
    void (async () => {
      try {
        const label = result.customer.name?.trim() || result.customer.email;
        await this.audit.record({
          action: 'CUSTOMER_LOGIN',
          summary: `${label} müşteri panelinden giriş yaptı`,
          actor: {
            type: 'customer',
            id: result.customer.id,
            email: result.customer.email,
            name: result.customer.name,
          },
          extra: {
            mustChangePassword: result.mustChangePassword,
            profileCompleted: result.customer.profileCompleted,
          },
          req,
        });
      } catch {
        // swallow — audit best-effort
      }
    })();
    return result;
  }

  /**
   * "Şifremi unuttum" — bayi e-postasına 5 dk geçerli sıfırlama linki yollar.
   * Yanıt HER DURUMDA generic (enumeration yok); kayıtlı+aktif değilse mail
   * gitmez. Throttle: dakikada 5 (mail-bomb/abuse koruması).
   */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('forgot-password')
  @HttpCode(200)
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    const result = await this.auth.requestPasswordReset(dto.email);
    void (async () => {
      try {
        await this.audit.record({
          action: 'CUSTOMER_PASSWORD_RESET_REQUEST',
          summary: `${dto.email} için şifre sıfırlama talebi alındı`,
          actor: { type: 'customer', id: null, email: dto.email, name: dto.email },
          req,
        });
      } catch {
        // audit best-effort
      }
    })();
    return result;
  }

  /**
   * Sıfırlama linkindeki token'ı doğrular (reset sayfası formu göstermeden
   * önce). Yalnız geçerlilik bilgisi döner; hiçbir kimlik bilgisi sızdırmaz.
   * POST + body: ham token query string'e (nginx/backend access-log'una) düşmesin.
   */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('reset-password/validate')
  @HttpCode(200)
  validateReset(@Body() dto: ValidateResetTokenDto) {
    return this.auth.validateResetToken(dto.token);
  }

  /**
   * Sıfırlama token'ı + yeni şifre ile şifreyi günceller. Token tek-kullanımdır
   * ve 5 dk geçerlidir. Geçersizse generic hata.
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('reset-password')
  @HttpCode(200)
  resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    return this.auth.resetPassword(dto.token, dto.newPassword, req);
  }

  // KESKİN KURAL: çıkışta cookie HER DURUMDA temizlenir — token süresi dolmuş
  // ya da geçersiz olsa bile. Bu yüzden guard YOK; guard olsaydı 401 handler'a
  // ulaşmadan atılır, bayat cookie kalır ve kullanıcı "çıkış yaptım ama hâlâ
  // girişli" durumuna düşerdi. Müşteri kimliği yalnızca audit için best-effort
  // decode edilir; doğrulama başarısız olursa atfsız geçilir.
  @Post('logout')
  @HttpCode(200)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    clearSessionCookie(res);

    let customer: { id: string; email: string } | null = null;
    try {
      const token = readSessionCookie(req.headers.cookie, SESSION_COOKIE_NAME);
      if (token) {
        const payload = this.jwt.verify<CustomerJwtPayload>(token);
        if (payload?.type === 'customer' && payload.sub) {
          customer = { id: payload.sub, email: payload.email };
        }
      }
    } catch {
      // token geçersiz/expired — audit atfı yok; cookie zaten temizlendi.
    }

    if (customer) {
      await this.audit.record({
        action: 'CUSTOMER_LOGOUT',
        summary: `${customer.email ?? customer.id} müşteri panelinden çıkış yaptı`,
        actor: {
          type: 'customer',
          id: customer.id,
          email: customer.email,
          name: customer.email,
        },
        req: req as Request,
      });
    }
    return { success: true };
  }

  @UseGuards(CustomerJwtGuard)
  @Get('me')
  async me(@Req() req: RequestWithCustomer) {
    const customer = await this.auth.getById(req.customer!.id);
    return { customer };
  }

  @UseGuards(CustomerJwtGuard)
  @Get('orders')
  orders(@Req() req: RequestWithCustomer) {
    return this.auth.listOrders(req.customer!.id);
  }
}
