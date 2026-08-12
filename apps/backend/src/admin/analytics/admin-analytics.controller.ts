import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PagePermissionGuard } from '../../permissions/page-permission.guard';
import { RequirePage } from '../../permissions/require-page.decorator';
import type { RequestUser } from '../../auth/jwt.strategy';
import { AdminAnalyticsService } from './admin-analytics.service';

@UseGuards(JwtAuthGuard, RolesGuard, PagePermissionGuard)
@RequirePage('dashboard')
@Roles('OWNER', 'ADMIN', 'MEMBER')
@Controller('admin/analytics')
export class AdminAnalyticsController {
  constructor(private readonly service: AdminAnalyticsService) {}

  /** @deprecated Use `/admin/dashboard/overview` instead. Kept for the old DashboardPage until next release. */
  @Get('summary')
  summary(@Req() req: Request & { user: RequestUser }) {
    return this.service.summary(req.user.tenantId);
  }
}
