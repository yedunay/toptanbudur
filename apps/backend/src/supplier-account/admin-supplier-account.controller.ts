import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { SupplierLedgerType } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { RequirePage } from '../permissions/require-page.decorator';
import { PagePermissionGuard } from '../permissions/page-permission.guard';
import type { RequestUser } from '../auth/jwt.strategy';
import { SupplierAccountService } from './supplier-account.service';
import {
  SupplierAdjustDto,
  SupplierLedgerQueryDto,
  SupplierSetBalanceDto,
  SupplierThresholdDto,
  SupplierTopupDto,
} from './dto/supplier-account.dto';

// ──────────────────────────────────────────────────────────────────────────
//  TEDARİKÇİ BAKİYE SENKRONU — admin uçları
//  Route: admin/tedarikci-bakiye (tedarikci-cari ile çakışmaz)
//  Page-permission: 'suppliers'
// ──────────────────────────────────────────────────────────────────────────

@UseGuards(JwtAuthGuard, RolesGuard, PagePermissionGuard)
@RequirePage('suppliers')
@Roles('OWNER', 'ADMIN', 'MEMBER')
@Controller('admin/tedarikci-bakiye')
export class AdminSupplierAccountController {
  constructor(private readonly service: SupplierAccountService) {}

  /** Dashboard + Tedarikçiler sayfası üst şeridi için özet. */
  @Get('summary')
  summary(@Req() req: Request & { user: RequestUser }) {
    return this.service.getSummary(req.user.tenantId);
  }

  /** Tek tedarikçinin hesap durumu. */
  @Get(':supplierId')
  getOne(
    @Param('supplierId') supplierId: string,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.service.getSupplierAccount(supplierId, req.user.tenantId);
  }

  /** Tek tedarikçinin bakiye hareket defteri. */
  @Get(':supplierId/ledger')
  ledger(
    @Param('supplierId') supplierId: string,
    @Query() query: SupplierLedgerQueryDto,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.service.getLedger(supplierId, req.user.tenantId, {
      page: query.page,
      pageSize: query.pageSize,
      type: query.type as SupplierLedgerType | undefined,
    });
  }

  /** Manuel para girişi. */
  @Post(':supplierId/topup')
  topup(
    @Param('supplierId') supplierId: string,
    @Body() dto: SupplierTopupDto,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.service.topUp({
      supplierId,
      tenantId: req.user.tenantId,
      amount: dto.amount,
      description: dto.description,
      adminUserId: req.user.id,
    });
  }

  /** İşaretli manuel düzeltme. */
  @Post(':supplierId/adjust')
  adjust(
    @Param('supplierId') supplierId: string,
    @Body() dto: SupplierAdjustDto,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.service.adjustByAdmin({
      supplierId,
      tenantId: req.user.tenantId,
      amount: dto.amount,
      reason: dto.reason,
      adminUserId: req.user.id,
    });
  }

  /** Mutlak bakiye set. */
  @Post(':supplierId/set-balance')
  setBalance(
    @Param('supplierId') supplierId: string,
    @Body() dto: SupplierSetBalanceDto,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.service.setBalanceByAdmin({
      supplierId,
      tenantId: req.user.tenantId,
      newBalance: dto.newBalance,
      reason: dto.reason,
      adminUserId: req.user.id,
    });
  }

  /** Düşük-bakiye eşiği güncelle. */
  @Patch(':supplierId/threshold')
  threshold(
    @Param('supplierId') supplierId: string,
    @Body() dto: SupplierThresholdDto,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.service.setThreshold({
      supplierId,
      tenantId: req.user.tenantId,
      threshold: dto.threshold,
    });
  }
}
