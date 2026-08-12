import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { RequirePage } from '../../permissions/require-page.decorator';
import { PagePermissionGuard } from '../../permissions/page-permission.guard';
import type { RequestUser } from '../../auth/jwt.strategy';
import { ReceiptsService } from '../../receipts/receipts.service';
import { AdminReceiptListQueryDto } from './dto/list-receipts.dto';
import { trDayStart, trDayEndExclusive } from '../../common/utils/tr-time';

type AdminReq = Request & { user: RequestUser };

const DEFAULT_PAGE_SIZE = 50;

/**
 * Admin "Makbuzlar" sayfası — kredi kartı tahsilat makbuzlarını listeler,
 * bayiye/türe/tarihe göre filtreler ve her satırın PDF'ini servis eder.
 *
 * Yetki: yalnızca OWNER/ADMIN + `makbuzlar` sayfa izni. Tüm sorgular admin'in
 * kendi tenant'ına (RLS sınırı) kapsanır.
 */
@UseGuards(JwtAuthGuard, RolesGuard, PagePermissionGuard)
@RequirePage('makbuzlar')
@Roles('OWNER', 'ADMIN', 'MEMBER')
@Controller('admin/receipts')
export class AdminReceiptsController {
  constructor(private readonly receipts: ReceiptsService) {}

  /** Filtreli + sayfalı makbuz listesi (tüm sütunlar). */
  @Get()
  async list(@Req() req: AdminReq, @Query() query: AdminReceiptListQueryDto) {
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const page = query.page ?? 1;
    const { items, total } = await this.receipts.listForAdmin({
      tenantId: req.user.tenantId,
      kind: query.kind,
      customerId: query.customerId,
      // TR takvim günü: başlangıç gün başı; bitiş günü DAHİL (gün sonu anı).
      from: trDayStart(query.from) ?? undefined,
      to: query.to
        ? new Date(trDayEndExclusive(query.to)!.getTime() - 1)
        : undefined,
      take: pageSize,
      skip: (page - 1) * pageSize,
    });
    return {
      success: true,
      data: items,
      meta: {
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }

  /** Makbuzu olan bayilerin dropdown listesi (filtre için). */
  @Get('dealers')
  async dealers(@Req() req: AdminReq) {
    const data = await this.receipts.listDealerOptions(req.user.tenantId);
    return { success: true, data };
  }

  /**
   * Bir makbuzun PDF'ini (lazy üretilerek) imzalı URL olarak döner. Admin paneli
   * JWT (Bearer) ile çalıştığı için PDF'i `window.open` ile açabilsin diye
   * self-authenticating signed URL JSON içinde döndürülür.
   */
  @Get(':id/pdf')
  async pdf(@Req() req: AdminReq, @Param('id') id: string) {
    const { url } = await this.receipts.ensurePdfForAdmin(id, req.user.tenantId);
    return { success: true, data: { url } };
  }
}
