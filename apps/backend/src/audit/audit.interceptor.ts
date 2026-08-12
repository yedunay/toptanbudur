import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import * as jwt from 'jsonwebtoken';
import { Observable, tap, catchError } from 'rxjs';
import { AuditService } from './audit.service';
import { buildRequestMeta } from '../common/utils/request-meta';
import { PrismaService } from '../prisma/prisma.service';

/**
 * actorName cache — log yazılırken DB lookup ucuza gelsin diye küçük bir
 * in-memory cache. JWT'den gelen email/tenant değişmediği sürece geçerli.
 */
const ACTOR_NAME_CACHE = new Map<string, string | null>();
const ACTOR_NAME_CACHE_MAX = 500;
function cacheActorName(key: string, name: string | null): void {
  if (ACTOR_NAME_CACHE.size >= ACTOR_NAME_CACHE_MAX) {
    const firstKey = ACTOR_NAME_CACHE.keys().next().value;
    if (firstKey !== undefined) ACTOR_NAME_CACHE.delete(firstKey);
  }
  ACTOR_NAME_CACHE.set(key, name);
}

const SENSITIVE_KEYS = new Set([
  'password',
  'passwordHash',
  'token',
  'currentPassword',
  'newPassword',
  'apiKey',
  'apiSecret',
  'sealedCredentials',
  'secret',
  'authToken',
]);

function redact(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_KEYS.has(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redact(v);
      }
    }
    return out;
  }
  return value;
}

interface DecodedToken {
  sub?: string;
  email?: string;
  tenantId?: string;
  role?: string;
  /** Customer JWT'lerinde 'customer'. Admin JWT'lerinde tanımsız. */
  type?: string;
}

/**
 * C-34: İmzasız token'larla sahte audit log üretilmesini engellemek için
 * `jwt.decode` yerine `jwt.verify` kullanıyoruz. Geçersiz imza → null döner.
 *
 * Not: Burada gelen secret zorunlu; ConfigService'den `JWT_SECRET` ile
 * çözüldüğü için runtime'da boş olamaz.
 */
function verifyToken(req: Request, secret: string): DecodedToken | null {
  const auth = req.headers['authorization'];
  if (!auth || typeof auth !== 'string') return null;
  const parts = auth.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') return null;
  try {
    const decoded = jwt.verify(parts[1], secret);
    if (decoded && typeof decoded === 'object') {
      return decoded as DecodedToken;
    }
  } catch {
    // Süresi dolmuş veya imzası geçersiz token → audit'e güvenilir aktör
    // bağlanamaz; anonim olarak loglanır.
    return null;
  }
  return null;
}

function extractTargetId(body: unknown, params: Record<string, unknown>): string | null {
  if (params && typeof params['id'] === 'string') return params['id'] as string;
  if (body && typeof body === 'object' && body !== null) {
    const b = body as Record<string, unknown>;
    if (typeof b.id === 'string') return b.id;
  }
  return null;
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);
  private readonly jwtSecret: string;

  constructor(
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    // C-34: getOrThrow ile boot sırasında eksik secret yakalanır.
    this.jwtSecret = config.getOrThrow<string>('JWT_SECRET');
  }

  /**
   * actor name lookup — JWT payload'unda yoksa DB'den çekilir.
   * - Admin token (type yok): User tablosu.
   * - Customer token (type='customer'): Customer tablosu.
   * - Login akışında token henüz issue edilmemiş olabilir; o durumda email ile
   *   eşleşen kayıt aranır.
   */
  private async resolveActorName(
    token: DecodedToken | null,
    bodyEmail: string | null,
  ): Promise<string | null> {
    const isCustomer = token?.type === 'customer';
    const subjectId = token?.sub ?? null;
    const email = token?.email ?? bodyEmail ?? null;
    const cacheKey = `${isCustomer ? 'c' : 'a'}:${subjectId ?? email ?? ''}`;
    if (!subjectId && !email) return null;
    if (ACTOR_NAME_CACHE.has(cacheKey)) {
      return ACTOR_NAME_CACHE.get(cacheKey) ?? null;
    }

    try {
      let name: string | null = null;
      if (isCustomer) {
        const row = subjectId
          ? await this.prisma.customer.findUnique({
              where: { id: subjectId },
              select: { name: true },
            })
          : email
            ? await this.prisma.customer.findUnique({
                where: { email },
                select: { name: true },
              })
            : null;
        name = row?.name ?? null;
      } else {
        const row = subjectId
          ? await this.prisma.user.findUnique({
              where: { id: subjectId },
              select: { name: true },
            })
          : email
            ? await this.prisma.user.findUnique({
                where: { email },
                select: { name: true },
              })
            : null;
        name = row?.name ?? null;
      }
      cacheActorName(cacheKey, name);
      return name;
    } catch (err) {
      this.logger.warn(
        `actor name lookup failed: ${err instanceof Error ? err.message : 'unknown'}`,
      );
      return null;
    }
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const method = req.method?.toUpperCase() ?? 'UNKNOWN';
    const path = req.originalUrl?.split('?')[0] ?? req.url ?? '';

    const isAuthLogin = method === 'POST' && /\/auth\/login(\/?$|\?)/.test(path);
    const isCustomerLogin =
      method === 'POST' && /\/customer\/auth\/login(\/?$|\?)/.test(path);

    // Interceptor artık SADECE login denemelerini loglar. Diğer tüm aksiyonlar
    // için ilgili servisler `AuditService.record(...)` ile semantik özet
    // (`metadata.summary`) yazar. Bu sayede Loglar sayfasında "Post /api/..."
    // tarzı teknik string'ler bir daha üretilmez.
    if (!isAuthLogin && !isCustomerLogin) {
      return next.handle();
    }

    const token = verifyToken(req, this.jwtSecret);
    const meta = buildRequestMeta(req);

    const startedAt = Date.now();
    const action = isAuthLogin ? 'LOGIN' : 'CUSTOMER_LOGIN';
    const requestBody = redact(req.body);

    const finish = (statusCode: number, responseBody: unknown): void => {
      const durationMs = Date.now() - startedAt;
      const target = extractTargetIdFromResponse(
        responseBody,
        req.params,
        req.body,
      );
      const bodyEmail =
        req.body && typeof req.body === 'object' && req.body !== null
          ? ((req.body as Record<string, unknown>)['email'] as string | undefined)
          : undefined;
      // actorType'ı doğru ayır: customer login → 'customer', admin token → 'admin',
      // anonim → 'public'.
      const isCustomer = token?.type === 'customer';
      const actorType = token?.sub
        ? isCustomer
          ? 'customer'
          : 'admin'
        : isCustomerLogin
          ? 'customer'
          : 'public';

      // Actor name lookup async — log yazımı kısa süre gecikebilir ama tap()
      // içinde await edilemiyor. Promise-then ile fire-and-forget ediyoruz.
      void this.resolveActorName(token, bodyEmail ?? null).then((actorName) => {
        const success = statusCode >= 200 && statusCode < 300;
        const displayActor =
          actorName ?? token?.email ?? bodyEmail ?? 'Anonim kullanıcı';
        const summary = success
          ? isCustomerLogin
            ? `${displayActor} müşteri panelinden giriş yaptı`
            : `${displayActor} yönetim paneline giriş yaptı`
          : isCustomerLogin
            ? `${bodyEmail ?? 'Bilinmeyen e-posta'} ile müşteri girişi başarısız oldu`
            : `${bodyEmail ?? 'Bilinmeyen e-posta'} ile yönetim paneli girişi başarısız oldu`;

        void this.audit.log({
          actorType,
          actorId: token?.sub ?? null,
          action,
          target,
          tenantId: token?.tenantId ?? null,
          metadata: {
            summary,
            ip: meta.ip,
            userAgent: meta.userAgent,
            deviceType: meta.deviceType,
            statusCode,
            durationMs,
            path,
            method,
            email: token?.email ?? bodyEmail ?? null,
            role: token?.role ?? null,
            actorName,
            requestBody,
          },
        });
      });
    };

    return next.handle().pipe(
      tap((data) => {
        finish(res.statusCode ?? 200, data);
      }),
      catchError((err: unknown) => {
        const status =
          err && typeof err === 'object' && 'status' in err
            ? Number((err as { status?: number }).status ?? 500)
            : 500;
        finish(status, null);
        throw err;
      }),
    );
  }
}

function extractTargetIdFromResponse(
  responseBody: unknown,
  params: Record<string, unknown>,
  reqBody: unknown,
): string | null {
  // Prefer URL :id param
  if (params && typeof params['id'] === 'string') return params['id'] as string;
  // Then response data.id
  if (responseBody && typeof responseBody === 'object' && responseBody !== null) {
    const b = responseBody as Record<string, unknown>;
    if (typeof b.id === 'string') return b.id;
    if (b.data && typeof b.data === 'object' && b.data !== null) {
      const d = b.data as Record<string, unknown>;
      if (typeof d.id === 'string') return d.id;
    }
  }
  return extractTargetId(reqBody, params);
}
