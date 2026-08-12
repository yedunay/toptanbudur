import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { DealerService } from './dealer.service';
import { DealerApplyDto } from './dto/dealer-apply.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { RequirePage } from '../permissions/require-page.decorator';
import { PagePermissionGuard } from '../permissions/page-permission.guard';
import type { RequestUser } from '../auth/jwt.strategy';

@Controller()
export class DealerController {
  constructor(private readonly dealer: DealerService) {}

  // Throttle gevşetildi: 5/dk → 20/5dk. Eski sınır UI'dan tekrar deneme yapan
  // kullanıcılarda "Başvurunuz iletilemedi" hatasına yol açıyordu.
  @Throttle({ default: { limit: 20, ttl: 300_000 } })
  @Post('dealer/apply')
  apply(@Body() dto: DealerApplyDto, @Req() req: Request) {
    return this.dealer.apply(dto, req);
  }

  @UseGuards(JwtAuthGuard, RolesGuard, PagePermissionGuard)
  @Roles('OWNER', 'ADMIN', 'MEMBER')
  @RequirePage('mesajlar')
  @Get('admin/dealer/applications')
  listApplications(
    @Req() req: Request & { user: RequestUser },
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.dealer.listApplications(req.user.tenantId, {
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  /**
   * Aliased route — yeni admin paneli "dealer-applications" ad altında çağırıyor.
   * Eski URL geriye dönük uyumluluk için bırakıldı.
   */
  @UseGuards(JwtAuthGuard, RolesGuard, PagePermissionGuard)
  @Roles('OWNER', 'ADMIN', 'MEMBER')
  @RequirePage('mesajlar')
  @Get('admin/dealer-applications')
  listApplicationsV2(
    @Req() req: Request & { user: RequestUser },
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.dealer.listApplications(req.user.tenantId, {
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @UseGuards(JwtAuthGuard, RolesGuard, PagePermissionGuard)
  @Roles('OWNER', 'ADMIN', 'MEMBER')
  @RequirePage('mesajlar')
  @Post('admin/dealer-applications/:id/approve')
  approve(
    @Param('id') id: string,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.dealer.approveApplication(
      id,
      { id: req.user.id, tenantId: req.user.tenantId, email: req.user.email },
      req,
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard, PagePermissionGuard)
  @Roles('OWNER', 'ADMIN', 'MEMBER')
  @RequirePage('mesajlar')
  @Post('admin/dealer-applications/:id/reject')
  reject(
    @Param('id') id: string,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.dealer.rejectApplication(
      id,
      { id: req.user.id, tenantId: req.user.tenantId, email: req.user.email },
      req,
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard, PagePermissionGuard)
  @Roles('OWNER', 'ADMIN', 'MEMBER')
  @RequirePage('mesajlar')
  @Post('admin/dealer-applications/:id/undo')
  undo(
    @Param('id') id: string,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.dealer.undoApplication(
      id,
      { id: req.user.id, tenantId: req.user.tenantId, email: req.user.email },
      req,
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard, PagePermissionGuard)
  @Roles('OWNER', 'ADMIN', 'MEMBER')
  @RequirePage('mesajlar')
  @Post('admin/dealer-applications/:id/pre-register')
  preRegister(
    @Param('id') id: string,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.dealer.preRegisterApplication(
      id,
      { id: req.user.id, tenantId: req.user.tenantId, email: req.user.email },
      req,
    );
  }
}
