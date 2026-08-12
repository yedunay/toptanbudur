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
import { CariPaymentsService } from './cari-payments.service';
import { CariDecisionDto } from './dto/cari-decision.dto';

@UseGuards(JwtAuthGuard, RolesGuard, PagePermissionGuard)
@RequirePage('cari')
@Roles('OWNER', 'ADMIN', 'MEMBER')
@Controller('admin/cari-payments')
export class AdminCariPaymentsController {
  constructor(private readonly service: CariPaymentsService) {}

  @Get()
  list(
    @Req() req: Request & { user: RequestUser },
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.listForAdmin(
      req.user.tenantId,
      status,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 20,
    );
  }

  @Patch(':id')
  decide(
    @Param('id') id: string,
    @Body() dto: CariDecisionDto,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.service.decide(
      id,
      req.user.id,
      req.user.tenantId,
      dto.decision,
      dto.note,
      req.user.email,
      req,
    );
  }
}
