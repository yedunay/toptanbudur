import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { RequirePage } from '../permissions/require-page.decorator';
import { PagePermissionGuard } from '../permissions/page-permission.guard';
import type { RequestUser } from '../auth/jwt.strategy';
import { CariBalanceService } from './cari-balance.service';
import { TopupDecisionDto } from './dto/topup-decision.dto';

@UseGuards(JwtAuthGuard, RolesGuard, PagePermissionGuard)
@RequirePage('cari')
@Roles('OWNER', 'ADMIN', 'MEMBER')
@Controller('admin/cari-topups')
export class AdminCariTopupsController {
  constructor(private readonly service: CariBalanceService) {}

  @Get()
  list(
    @Req() req: Request & { user: RequestUser },
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.listTopupsForAdmin(
      req.user.tenantId,
      status,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 20,
    );
  }

  @Patch(':id')
  decide(
    @Param('id') id: string,
    @Body() dto: TopupDecisionDto,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.service.decideTopup({
      topupId: id,
      decidedByUserId: req.user.id,
      tenantId: req.user.tenantId,
      decision: dto.decision,
      adminNote: dto.adminNote,
      actorEmail: req.user.email,
      req,
    });
  }
}
