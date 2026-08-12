import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PagePermissionGuard } from '../../permissions/page-permission.guard';
import { RequirePage } from '../../permissions/require-page.decorator';
import type { RequestUser } from '../../auth/jwt.strategy';
import { AdminDashboardService } from './admin-dashboard.service';

@UseGuards(JwtAuthGuard, RolesGuard, PagePermissionGuard)
@RequirePage('dashboard')
@Roles('OWNER', 'ADMIN', 'MEMBER')
@Controller('admin/dashboard')
export class AdminDashboardController {
  constructor(private readonly service: AdminDashboardService) {}

  @Get('overview')
  overview(
    @Req() req: Request & { user: RequestUser },
    @Query('fresh') fresh?: string,
    @Query('debug') debug?: string,
  ) {
    return this.service.overview(req.user.tenantId, {
      fresh: fresh === '1' || fresh === 'true',
      debug: debug === '1' || debug === 'true',
    });
  }
}
