import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CreateOrderDto } from './dto';
import { OrdersService } from './orders.service';
import {
  CustomerJwtGuard,
  type RequestWithCustomer,
} from '../customer-auth/customer-jwt.guard';
import {
  SESSION_COOKIE_NAME,
  readSessionCookie,
} from '../customer-auth/session-cookie';

interface MaybeCustomerPayload {
  sub?: string;
  type?: string;
}

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Misafir + müşteri checkout ortak endpoint'i. Müşteri girişliyse
   * `extractCustomerId` cookie'den (varsa Bearer fallback'inden) müşteri
   * kimliğini çözer ve siparişi hesaba bağlar; misafirde `customerId`
   * undefined kalır ve sipariş anonim olarak kaydedilir.
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  create(@Body() dto: CreateOrderDto, @Req() req: Request) {
    const customerId = this.extractCustomerId(req);
    return this.orders.create(dto, customerId);
  }

  /**
   * POST /api/orders/upload-pdf
   * Body (JSON): `{ filename: string, contentBase64: string }`.
   * Tedarikçi `requiresPdf=true` ise sipariş oluşturmadan önce çağrılır;
   * dönen `pdfUrl` `CreateOrderDto.pdfUrl` alanına yazılır. Multer bağımlılığı
   * eklenmesin diye base64 JSON akışı tercih edildi (max 10 MB).
   *
   * Auth: HttpOnly `tb_session` cookie'si zorunlu — `CustomerJwtGuard`
   * reddederse 401 düşer. Bearer fallback'i guard'ın içinde değil; ancak
   * `extractCustomerId` ile uyumlu kalsın diye buradan da test edilebiliyor
   * — fakat üretimde cookie tek doğru kaynak (CLAUDE.md keskin kural).
   */
  @UseGuards(CustomerJwtGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('upload-pdf')
  uploadPdf(
    @Body() body: { filename?: string; contentBase64?: string },
    @Req() _req: RequestWithCustomer,
  ): Promise<{ pdfUrl: string; key: string }> {
    return this.orders.uploadPdf(body ?? {});
  }

  /**
   * POST /api/orders/checkout-policy
   * Body: `{ tenantSlug, marketplace?, items: [{ slug, qty }] }`.
   * Sepet, PDF yükleme kutusunu VİTRİN değil GERÇEK alım (override) tedarikçisine
   * göre gösterebilsin diye salt-okunur ön-kontrol. Yalnız `{ requiresPdf }`
   * boolean döner (tedarikçi bilgisi sızmaz). Misafir checkout'u da kullandığı
   * için auth istemez; throttled.
   */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('checkout-policy')
  checkoutPolicy(
    @Body()
    body: {
      tenantSlug?: string;
      marketplace?: string;
      items?: Array<{ slug?: string; qty?: number }>;
    },
  ): Promise<{ requiresPdf: boolean }> {
    return this.orders.getCheckoutPdfPolicy({
      tenantSlug: (body?.tenantSlug ?? '').trim(),
      marketplace: body?.marketplace,
      items: (body?.items ?? [])
        .map((i) => ({ slug: (i?.slug ?? '').trim(), qty: Number(i?.qty) || 0 }))
        .filter((i) => i.slug.length > 0),
    });
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get()
  listForCustomer(@Req() req: Request) {
    const customerId = this.extractCustomerId(req);
    if (!customerId) {
      throw new ForbiddenException('login required');
    }
    return this.orders.listForCustomer(customerId);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':id')
  getById(@Param('id') id: string, @Query('t') token?: string) {
    return this.orders.getById(id, token);
  }

  /**
   * Müşteri kimliğini çıkarır. Öncelik:
   *   1. HttpOnly `tb_session` cookie (yeni keskin kural — tek doğru kaynak).
   *   2. `Authorization: Bearer <jwt>` (geriye dönük uyumluluk; CLAUDE.md'ye
   *      göre 1 release sonra kaldırılacak).
   *
   * Doğrulanamayan token'larda undefined döner — POST /orders misafir
   * akışını destekler, GET /orders bu durumda 403 atar.
   */
  private extractCustomerId(req: Request): string | undefined {
    const fromCookie = readSessionCookie(
      req.headers.cookie,
      SESSION_COOKIE_NAME,
    );
    const authHeader = req.headers.authorization;
    const fromBearer =
      authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length).trim()
        : null;
    const token = fromCookie ?? fromBearer;
    if (!token) return undefined;
    try {
      const payload = this.jwt.verify<MaybeCustomerPayload>(token);
      if (payload?.type === 'customer' && payload.sub) {
        return payload.sub;
      }
    } catch {
      // ignore, treat as guest
    }
    return undefined;
  }
}
