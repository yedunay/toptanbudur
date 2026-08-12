import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { SESSION_COOKIE_NAME, readSessionCookie } from './session-cookie';

export interface CustomerJwtPayload {
  sub: string;
  email: string;
  type: 'customer';
  /**
   * Oturum sürümü. Şifre değişince Customer.tokenVersion +1 artar ve eski
   * token'lar geçersizleşir. Geriye uyum: eski (ver'siz) token'lar 0 sayılır.
   */
  ver?: number;
}

export interface RequestCustomer {
  id: string;
  email: string;
}

export interface RequestWithCustomer extends Request {
  customer?: RequestCustomer;
}

/**
 * #14 — Müşteri pasifleştirildiğinde / silindiğinde mevcut oturum token'ı
 * süresi dolana kadar (7 gün) geçerli kalıyordu. Artık her istekte müşterinin
 * hâlâ var olduğu ve isActive olduğu DB'den doğrulanıyor.
 *
 * Performans: her istekte DB sorgusu pahalı olduğundan kısa süreli (CACHE_TTL_MS)
 * pozitif sonuç cache'i tutuluyor. Pasifleştirme/silme en geç bu süre içinde
 * etkili olur. Cache yalnızca "aktif" sonucu saklar; pasif/yok durumda anında
 * 401 döner ve cache'e yazılmaz.
 */
const ACTIVE_CACHE_TTL_MS = 30 * 1000; // 30 sn
const activeCustomerCache = new Map<string, number>(); // customerId -> expiresAt

@Injectable()
export class CustomerJwtGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithCustomer>();
    const token = extractToken(req);
    if (!token) {
      throw new UnauthorizedException('Missing session');
    }
    let payload: CustomerJwtPayload;
    try {
      payload = this.jwt.verify<CustomerJwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
    if (payload?.type !== 'customer' || !payload.sub) {
      throw new UnauthorizedException('Not a customer token');
    }

    await this.assertCustomerActive(payload.sub, payload.ver ?? 0);

    req.customer = { id: payload.sub, email: payload.email };
    return true;
  }

  /**
   * Müşteri hâlâ var, isActive ve token sürümü güncel mi? Kısa cache ile DB
   * yükünü azaltır. Pasif/yok/bayat-sürüm ise 401 atar (cache'e yazmaz).
   *
   * Cache anahtarı (id + tokenVersion) çiftidir: şifre değişip tokenVersion
   * arttığında eski token'ın anahtarı farklı olur, en geç ACTIVE_CACHE_TTL_MS
   * içinde DB'den bayat-sürüm tespitiyle reddedilir.
   */
  private async assertCustomerActive(
    customerId: string,
    tokenVer: number,
  ): Promise<void> {
    const now = Date.now();
    const cacheKey = `${customerId}:${tokenVer}`;
    const cachedExpiry = activeCustomerCache.get(cacheKey);
    if (cachedExpiry !== undefined) {
      if (cachedExpiry > now) return; // taze pozitif cache
      activeCustomerCache.delete(cacheKey); // süresi dolmuş
    }

    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { isActive: true, tokenVersion: true },
    });
    if (!customer || customer.isActive === false) {
      throw new UnauthorizedException('Oturum geçersiz — hesabınız pasif');
    }
    if ((customer.tokenVersion ?? 0) !== tokenVer) {
      throw new UnauthorizedException(
        'Oturum geçersiz — şifreniz değiştirildi, lütfen tekrar giriş yapın',
      );
    }

    activeCustomerCache.set(cacheKey, now + ACTIVE_CACHE_TTL_MS);
  }
}

function extractToken(req: Request): string | null {
  return readSessionCookie(req.headers.cookie, SESSION_COOKIE_NAME);
}
