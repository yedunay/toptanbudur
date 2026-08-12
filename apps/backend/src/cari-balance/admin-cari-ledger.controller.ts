import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { RequirePage } from '../permissions/require-page.decorator';
import { PagePermissionGuard } from '../permissions/page-permission.guard';
import type { RequestUser } from '../auth/jwt.strategy';
import { CariBalanceService } from './cari-balance.service';

@UseGuards(JwtAuthGuard, RolesGuard, PagePermissionGuard)
@RequirePage('cari')
@Roles('OWNER', 'ADMIN', 'MEMBER')
@Controller('admin/cari-ledger')
export class AdminCariLedgerController {
  constructor(private readonly service: CariBalanceService) {}

  @Get()
  list(
    @Req() req: Request & { user: RequestUser },
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.listLedgerForAdmin(req.user.tenantId, {
      type,
      status,
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize, 10) : 50,
    });
  }
}
