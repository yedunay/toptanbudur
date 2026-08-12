import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';

export interface JwtPayload {
  sub: string;
  email: string;
  tenantId: string;
  role: string;
  /**
   * Müşteri (storefront) token'ları `type: 'customer'` taşır ve aynı
   * JWT_SECRET ile imzalanır. Admin tarafı bu alanı asla set etmez; bu yüzden
   * `type === 'customer'` görülürse admin guard'ında reddedilir (#1 JWT type
   * confusion — müşteri token'ı admin token'ı yerine geçmesin).
   */
  type?: string;
  /**
   * Sayfa izin listesi — PermissionsService tarafından JWT issue/refresh
   * sırasında doldurulur. OWNER (ve eski tokenlar geriye dönük uyumluluk
   * için) `['*']` taşır → PagePermissionGuard her zaman izin verir.
   *
   * Eski tokenlarda alan yoksa guard tarafı boş diziye düşer, ancak
   * RolesGuard rol bazında bir başarısız check'i ayrıca yakalar.
   */
  permissions?: string[];
}

export interface RequestUser {
  id: string;
  email: string;
  tenantId: string;
  role: string;
  permissions: string[];
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      // Bearer header is the primary path. SSE endpoints (EventSource) can't
      // attach custom headers, so we also accept ?access_token= query for
      // explicitly-whitelisted stream routes.
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (req: Request) => {
          // SSE rotaları (EventSource) Authorization header taşıyamaz; bu yüzden
          // ?access_token=/?token= query param'ını YALNIZCA path'i `/stream` ile
          // BİTEN endpoint'lerde kabul ediyoruz. Bu hem /notifications/stream'i
          // hem `/stream` ile biten diğer canlı akış uçlarını kapsar.
          // Query'deki token app.module redactTokenInUrl ile log'da maskelenir.
          const url = req.originalUrl ?? req.url ?? '';
          const path = url.split('?')[0];
          if (path.endsWith('/stream')) {
            const token = (req.query?.access_token ?? req.query?.token) as
              | string
              | undefined;
            return token ?? null;
          }
          return null;
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  validate(payload: JwtPayload): RequestUser {
    // #1 JWT type confusion: storefront müşteri token'ı (type='customer')
    // aynı secret ile imzalandığından admin endpoint'lerinde de doğrulanır.
    // Müşteri token'ı admin/panel yetkisi kazanmasın diye burada reddediyoruz.
    if (payload.type === 'customer') {
      throw new UnauthorizedException('Invalid token');
    }
    return {
      id: payload.sub,
      email: payload.email,
      tenantId: payload.tenantId,
      role: payload.role,
      permissions: Array.isArray(payload.permissions) ? payload.permissions : [],
    };
  }
}
