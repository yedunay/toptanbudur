import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  PartnerFinanceApiKeyService,
  type PartnerContext,
} from './partner-finance-api-key.service';

/**
 * Dış Finans API guard'ı. Token şuradan alınır (öncelik sırası):
 *   1. `Authorization: Bearer <token>`
 *   2. `x-akb-finance-key: <token>` header
 *   3. `?token=` / `?key=` query
 *
 * Geçerliyse `req.partnerAuth = { partner, tenantId }` iliştirilir. Auth yalnız
 * bu guard'da; JWT/oturum YOK (bilinçli — sunucu-sunucu GET erişimi).
 */
export interface PartnerAuth {
  partner: PartnerContext;
  tenantId: string;
}

export type RequestWithPartner = Request & { partnerAuth?: PartnerAuth };

@Injectable()
export class PartnerFinanceApiGuard implements CanActivate {
  constructor(private readonly keys: PartnerFinanceApiKeyService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const http = ctx.switchToHttp();
    const req = http.getRequest<RequestWithPartner>();

    // Anahtar `?token=` ile URL'de taşınabildiğinden (Sheets kolaylığı) sızıntıyı
    // en aza indir: bu yanıtlar Referer'a düşmesin ve ara-belleklenmesin.
    const res = http.getResponse<Response>();
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');

    const token = this.extractToken(req);
    if (!token) {
      throw new UnauthorizedException(
        'API anahtarı gerekli (Authorization: Bearer, x-akb-finance-key veya ?token=).',
      );
    }
    const partner = await this.keys.authenticateToken(token, req.ip);
    if (!partner) {
      throw new UnauthorizedException(
        'Geçersiz veya iptal edilmiş API anahtarı.',
      );
    }
    req.partnerAuth = { partner, tenantId: partner.tenantId };
    return true;
  }

  private extractToken(req: RequestWithPartner): string | null {
    const auth = req.headers['authorization'];
    if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
      const v = auth.slice(7).trim();
      if (v) return v;
    }
    const header = req.headers['x-akb-finance-key'];
    const fromHeader = Array.isArray(header) ? header[0] : header;
    if (fromHeader) return String(fromHeader).trim();

    const q: unknown = req.query?.token ?? req.query?.key;
    const fromQuery = Array.isArray(q) ? q[0] : q;
    if (fromQuery) return String(fromQuery).trim();

    return null;
  }
}
