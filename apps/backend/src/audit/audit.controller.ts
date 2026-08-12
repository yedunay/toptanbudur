import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RequirePage } from '../permissions/require-page.decorator';
import { PagePermissionGuard } from '../permissions/page-permission.guard';
import { RolesGuard } from '../auth/roles.guard';
import { trDateRange } from '../common/utils/tr-time';
import {
  PaginationQueryDto,
  resolvePagination,
} from '../common/dto/pagination.dto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditDigestService } from './audit-digest.service';

class AuditListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  actorId?: string;

  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  /**
   * 'admin'   → sadece admin kullanıcı aksiyonları
   * 'customer'→ müşteri + anonim form gönderimleri (public)
   * yoksa     → hepsi
   */
  @IsOptional()
  @IsIn(['admin', 'customer'])
  audience?: 'admin' | 'customer';

  /**
   * Loglar sayfası sekme ayrımı: 'ADMIN' | 'BIRFATURA' | 'CUSTOMER'.
   * Verilmezse tüm kovalar döner. logCategory DB alanı üzerinden filtreler;
   * yeni kayıtlar audit.service tarafından doğru kovaya yazılır.
   */
  @IsOptional()
  @IsIn(['ADMIN', 'BIRFATURA', 'CUSTOMER'])
  logCategory?: 'ADMIN' | 'BIRFATURA' | 'CUSTOMER';

  /**
   * 'true' geldiğinde "POST /api/..." gibi HTTP-stili legacy kayıtlar
   * gizlenir. Yeni tüm aksiyonlar UPPER_SNAKE action koduyla yazıldığı için
   * varsayılan 'true' kabul edilir.
   */
  @IsOptional()
  @IsString()
  hideHttp?: string;

  @IsOptional()
  @IsString()
  q?: string;
}

interface RecipientsDto {
  emails: string[];
}

const SETTING_ID = 'default';

@UseGuards(JwtAuthGuard, RolesGuard, PagePermissionGuard)
@RequirePage('loglar')
@Roles('OWNER', 'ADMIN', 'MEMBER')
@Controller('admin/audit-logs')
export class AuditController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly digest: AuditDigestService,
  ) {}

  @Get()
  async list(@Query() query: AuditListQueryDto) {
    const { page, pageSize, skip, take } = resolvePagination(query, {
      defaultPage: 1,
      defaultPageSize: 50,
      maxPageSize: 200,
    });

    const where: Record<string, unknown> = {};
    if (query.actorId) where.actorId = query.actorId;
    if (query.action) where.action = { contains: query.action, mode: 'insensitive' };
    if (query.audience === 'admin') {
      where.actorType = { in: ['admin', 'system'] };
    } else if (query.audience === 'customer') {
      where.actorType = { in: ['customer', 'public'] };
    }
    // Yeni kova ayrımı — ADMIN / BIRFATURA / CUSTOMER sekmeleri logCategory
    // alanıyla filtrelenir. audience ile birlikte verilebilir (her ikisi de AND).
    if (query.logCategory) {
      where.logCategory = query.logCategory;
    }
    // TR takvim günü: başlangıç dahil, bitiş günü de DAHİL (yarı-açık üst sınır).
    const createdAt = trDateRange(query.from, query.to);
    if (createdAt) where.createdAt = createdAt;

    // Eski kayıtlar arasında "POST /api/..." gibi HTTP-stili action'lar olabilir
    // (interceptor refactor öncesi yazılmış). Varsayılan olarak gizleriz; UI
    // hideHttp=false geçince gösterilir (debug için).
    const hideHttp = query.hideHttp !== 'false';
    if (hideHttp) {
      const existingNot = (where.NOT as Record<string, unknown> | undefined) ?? {};
      where.NOT = {
        ...existingNot,
        action: { contains: '/api/' },
      };
    }

    // Serbest metin arama — action veya target id eşleşmesi. metadata.summary
    // JSON içinde olduğu için ayrı bir post-filtreyle ele alınamıyor; tablo
    // tarafında daha derin arama gerekirse pg_trgm/raw query gerekir.
    if (query.q && query.q.trim()) {
      const term = query.q.trim();
      const existingAnd = Array.isArray(where.AND) ? (where.AND as unknown[]) : [];
      where.AND = [
        ...existingAnd,
        {
          OR: [
            { action: { contains: term, mode: 'insensitive' } },
            { target: { contains: term, mode: 'insensitive' } },
          ],
        },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    // Hydrate actor emails — actorType'a göre User veya Customer tablosu.
    const adminActorIds = Array.from(
      new Set(
        items
          .filter((i) => i.actorType !== 'customer')
          .map((i) => i.actorId)
          .filter((v): v is string => !!v),
      ),
    );
    const customerActorIds = Array.from(
      new Set(
        items
          .filter((i) => i.actorType === 'customer')
          .map((i) => i.actorId)
          .filter((v): v is string => !!v),
      ),
    );
    const [users, customers] = await Promise.all([
      adminActorIds.length
        ? this.prisma.user.findMany({
            where: { id: { in: adminActorIds } },
            select: { id: true, email: true, name: true },
          })
        : Promise.resolve([]),
      customerActorIds.length
        ? this.prisma.customer.findMany({
            where: { id: { in: customerActorIds } },
            select: { id: true, email: true, name: true },
          })
        : Promise.resolve([]),
    ]);
    const userMap = new Map(users.map((u) => [u.id, u]));
    const customerMap = new Map(customers.map((c) => [c.id, c]));

    // metadata içinde tutulan ip / userAgent / deviceType bilgilerini üst
    // seviyeye lift et ki UI tablo görünümünde tek tek metadata.* yazmak
    // gerekmesin. Kayıt zaten DB'de var; sadece response shape genişledi.
    const data = items.map((it) => {
      const meta =
        it.metadata && typeof it.metadata === 'object'
          ? (it.metadata as Record<string, unknown>)
          : {};
      const isCustomerActor = it.actorType === 'customer';
      const lookupRow = it.actorId
        ? isCustomerActor
          ? (customerMap.get(it.actorId) ?? null)
          : (userMap.get(it.actorId) ?? null)
        : null;
      const actorEmail =
        lookupRow?.email ?? (meta.email as string | undefined) ?? null;
      // Interceptor metadata'ya actorName yazıyor — DB lookup başarısızsa fallback.
      const actorName =
        lookupRow?.name ?? (meta.actorName as string | undefined) ?? null;
      return {
        ...it,
        ip: (meta.ip as string | undefined) ?? null,
        userAgent: (meta.userAgent as string | undefined) ?? null,
        deviceType: (meta.deviceType as string | undefined) ?? null,
        statusCode: (meta.statusCode as number | undefined) ?? null,
        durationMs: (meta.durationMs as number | undefined) ?? null,
        path: (meta.path as string | undefined) ?? null,
        method: (meta.method as string | undefined) ?? null,
        summary: (meta.summary as string | undefined) ?? null,
        targetLabel: (meta.targetLabel as string | undefined) ?? null,
        targetType: (meta.targetType as string | undefined) ?? null,
        actorEmail,
        actorName,
        actor: {
          id: it.actorId ?? null,
          email: actorEmail,
          name: actorName,
        },
      };
    });

    return {
      success: true,
      data,
      meta: {
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }

  @Get('recipients')
  async getRecipients() {
    const setting = await this.prisma.auditLogSetting.findUnique({
      where: { id: SETTING_ID },
    });
    return {
      success: true,
      data: { emails: setting?.emails ?? [] },
    };
  }

  @Put('recipients')
  async updateRecipients(@Body() body: RecipientsDto) {
    const emails = Array.isArray(body?.emails)
      ? body.emails
          .map((e) => (typeof e === 'string' ? e.trim() : ''))
          .filter((e) => e.length > 0 && e.includes('@'))
      : [];

    const setting = await this.prisma.auditLogSetting.upsert({
      where: { id: SETTING_ID },
      update: { emails },
      create: { id: SETTING_ID, emails },
    });
    return { success: true, data: { emails: setting.emails } };
  }

  @Post('digest/test')
  @HttpCode(202)
  async triggerTestDigest() {
    const result = await this.digest.runDigest();
    return { success: true, data: result };
  }

  @Get('today-summary')
  async todaySummary() {
    const data = await this.digest.todaySummary();
    return { success: true, data };
  }
}
