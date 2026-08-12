import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AdminProfitabilityService } from './admin-profitability.service';
import { ProfitabilityQueryDto } from './dto/profitability-query.dto';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { RequirePage } from '../../permissions/require-page.decorator';
import { PagePermissionGuard } from '../../permissions/page-permission.guard';
import type { RequestUser } from '../../auth/jwt.strategy';

@Controller('admin/profitability')
@UseGuards(JwtAuthGuard, RolesGuard, PagePermissionGuard)
@Roles('ADMIN', 'OWNER', 'MEMBER')
@RequirePage('karlilik_analizi')
export class AdminProfitabilityController {
  constructor(private readonly svc: AdminProfitabilityService) {}

  @Get('analysis')
  getAnalysis(
    @Req() req: Request & { user: RequestUser },
    @Query() query: ProfitabilityQueryDto,
  ) {
    return this.svc.getAnalysis(req.user.tenantId, query);
  }

  @Get('analysis/export')
  async exportExcel(
    @Req() req: Request & { user: RequestUser },
    @Query() query: ProfitabilityQueryDto,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.svc.getExcelReport(
      req.user.tenantId,
      query,
      { id: req.user.id, email: req.user.email },
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    res.setHeader('Content-Length', String(buffer.length));
    res.end(buffer);
  }

  @Get('suppliers/:supplierId')
  getSupplierDetail(
    @Req() req: Request & { user: RequestUser },
    @Param('supplierId') supplierId: string,
    @Query() query: ProfitabilityQueryDto,
  ) {
    return this.svc.getSupplierDetail(req.user.tenantId, supplierId, query);
  }

  // NOT: Tedarikçi alış/KDV/indirim ayarları artık TEK KAYNAK olarak tedarikçi
  // formundadır (Supplier). Eski GET/PUT /configs endpoint'leri kaldırıldı.
}
