import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { IsOptional, IsString } from 'class-validator';
import type { Request, Response } from 'express';
import {
  CustomerJwtGuard,
  type RequestWithCustomer,
} from '../../customer-auth/customer-jwt.guard';
import {
  SESSION_COOKIE_NAME,
  readSessionCookie,
} from '../../customer-auth/session-cookie';
import { PaytrService, type PaytrCallbackPost } from './paytr.service';

class CreatePaytrTokenDto {
  @IsString()
  orderId!: string;

  /** Makbuz token'ı (misafir akışı) — sipariş oluşturma yanıtındaki `token`. */
  @IsOptional()
  @IsString()
  t?: string;
}

class CreatePaytrTopupTokenDto {
  @IsString()
  topupId!: string;
}

interface MaybeCustomerPayload {
  sub?: string;
  type?: string;
}

@Controller('payments/paytr')
export class PaytrController {
  constructor(
    private readonly paytr: PaytrService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * iFrame token — kart ödeme sayfası açılırken çağrılır.
   * Girişli müşteri cookie ile, misafir makbuz token'ı (t) ile yetkilenir.
   * Not: throttler isimleri app.module'deki 'short'/'medium' kayıtlarıyla
   * eşleşmeli — 'default' adlı throttler tanımlı olmadığı için no-op olur.
   */
  @Throttle({
    short: { limit: 3, ttl: 1_000 },
    medium: { limit: 10, ttl: 60_000 },
  })
  @Post('token')
  createToken(@Body() dto: CreatePaytrTokenDto, @Req() req: Request) {
    return this.paytr.createIframeToken({
      orderId: dto.orderId,
      receiptToken: dto.t,
      customerId: this.extractCustomerId(req),
      userIp: this.extractClientIp(req),
    });
  }

  /** Kart ile cari yükleme — iFrame token (yalnızca girişli müşteri). */
  @UseGuards(CustomerJwtGuard)
  @Throttle({
    short: { limit: 3, ttl: 1_000 },
    medium: { limit: 10, ttl: 60_000 },
  })
  @Post('topup-token')
  createTopupToken(
    @Body() dto: CreatePaytrTopupTokenDto,
    @Req() req: RequestWithCustomer,
  ) {
    return this.paytr.createTopupIframeToken({
      topupId: dto.topupId,
      customerId: req.customer!.id,
      userIp: this.extractClientIp(req),
    });
  }

  /**
   * Müşteriye yansıtılan kart komisyon oranı — sepet sayfası komisyon
   * satırını canlı hesaplamak için çağırır (public, cache'li).
   */
  @Throttle({ medium: { limit: 60, ttl: 60_000 } })
  @Get('card-fee')
  cardFee() {
    return this.paytr.getCardFee();
  }

  /**
   * PayTR Bildirim URL (callback) — paytr.md 2. Adım.
   *
   * KURALLAR (dökümandan, değiştirilemez):
   *  - Erişim kısıtlaması YOK (PayTR server-side çağırır) → guard yok,
   *    throttle muaf.
   *  - Yanıt yalnızca düz metin "OK" olmalı; öncesinde/sonrasında başka
   *    içerik basılamaz.
   *  - Oturum (session) kullanılamaz; işlem merchant_oid ile yapılır.
   *  - Hash doğrulanmadan sipariş onaylanmaz/iptal edilmez.
   *
   * PayTR Mağaza Paneli > Destek & Kurulum > Ayarlar > Bildirim URL:
   *   https://toptanbudur.com/api/payments/paytr/callback  (HTTPS)
   */
  @SkipThrottle({ short: true, medium: true, default: true })
  @Post('callback')
  async callback(
    @Body() body: PaytrCallbackPost,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.paytr.handleCallback(body ?? {});
    if (result === 'ok') {
      res.status(200).type('text/plain').send('OK');
      return;
    }
    // Hash hatası: OK dönülmez → PayTR bildirimi yineler (doc örneğindeki
    // "PAYTR notification failed: bad hash" davranışının karşılığı).
    res.status(400).type('text/plain').send('PAYTR notification failed: bad hash');
  }

  private extractCustomerId(req: Request): string | undefined {
    const fromCookie = readSessionCookie(req.headers.cookie, SESSION_COOKIE_NAME);
    const authHeader = req.headers.authorization;
    const fromBearer =
      authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length).trim()
        : null;
    const token = fromCookie ?? fromBearer;
    if (!token) return undefined;
    try {
      const payload = this.jwt.verify<MaybeCustomerPayload>(token);
      if (payload?.type === 'customer' && payload.sub) return payload.sub;
    } catch {
      // misafir say
    }
    return undefined;
  }

  /**
   * Müşterinin DIŞ IP'si — PayTR get-token hash'ine girer. Reverse proxy
   * arkasında x-forwarded-for'un ilk değeri gerçek istemci IP'sidir.
   */
  private extractClientIp(req: Request): string {
    const xff = req.headers['x-forwarded-for'];
    const first = Array.isArray(xff) ? xff[0] : xff?.split(',')[0];
    const ip = (first ?? req.socket.remoteAddress ?? '').trim();
    // IPv4-mapped IPv6 ("::ffff:1.2.3.4") sadeleştir
    return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  }
}
