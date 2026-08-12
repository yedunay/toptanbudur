import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsString } from 'class-validator';
import type { Request } from 'express';
import {
  CustomerJwtGuard,
  type RequestWithCustomer,
} from '../../customer-auth/customer-jwt.guard';
import {
  SESSION_COOKIE_NAME,
  readSessionCookie,
} from '../../customer-auth/session-cookie';
import { CardPaymentService } from './card-payment.service';

class CreateCardTokenDto {
  @IsString()
  orderId!: string;

  /** Makbuz token'ı (misafir akışı) — sipariş oluşturma yanıtındaki `token`. */
  @IsOptional()
  @IsString()
  t?: string;
}

class CreateCardTopupTokenDto {
  @IsString()
  topupId!: string;
}

interface MaybeCustomerPayload {
  sub?: string;
  type?: string;
}

/**
 * Sağlayıcı-bağımsız kart ödeme uçları. Aktif POS sağlayıcısına (PayTR/TOSLA)
 * CardPaymentService üzerinden yönlendirir. Auth/throttle mantığı
 * PaytrController ile birebir aynıdır.
 */
@Controller('payments/card')
export class CardPaymentController {
  constructor(
    private readonly card: CardPaymentService,
    private readonly jwt: JwtService,
  ) {}

  @Throttle({
    short: { limit: 3, ttl: 1_000 },
    medium: { limit: 10, ttl: 60_000 },
  })
  @Post('token')
  createToken(@Body() dto: CreateCardTokenDto, @Req() req: Request) {
    return this.card.createOrderToken({
      orderId: dto.orderId,
      receiptToken: dto.t,
      customerId: this.extractCustomerId(req),
      userIp: this.extractClientIp(req),
    });
  }

  @UseGuards(CustomerJwtGuard)
  @Throttle({
    short: { limit: 3, ttl: 1_000 },
    medium: { limit: 10, ttl: 60_000 },
  })
  @Post('topup-token')
  createTopupToken(
    @Body() dto: CreateCardTopupTokenDto,
    @Req() req: RequestWithCustomer,
  ) {
    return this.card.createTopupToken({
      topupId: dto.topupId,
      customerId: req.customer!.id,
      userIp: this.extractClientIp(req),
    });
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

  private extractClientIp(req: Request): string {
    const xff = req.headers['x-forwarded-for'];
    const first = Array.isArray(xff) ? xff[0] : xff?.split(',')[0];
    const ip = (first ?? req.socket.remoteAddress ?? '').trim();
    return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  }
}
