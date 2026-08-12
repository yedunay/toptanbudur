import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import type { RequestUser } from '../auth/jwt.strategy';
import { PermissionsService } from './permissions.service';
import { PAGE_KEYS, PAGE_LABELS } from './permission-keys';
import { ROLE_PAGE_DEFAULTS } from './role-templates';
import { UpdatePermissionsDto } from './dto/update-permissions.dto';
import { RequirePage } from './require-page.decorator';
import { PagePermissionGuard } from './page-permission.guard';

/**
 * Sayfa izinleri (page permissions) yönetim API'si.
 *
 * - `GET /admin/permissions/catalog`     — Sayfa keyleri + label'lar + role default şablonları.
 * - `GET /admin/permissions/me`          — Aktör'ün kendi efektif izinleri (frontend boot/refresh).
 * - `GET /admin/permissions/:userId`     — Hedef kullanıcının efektif izinleri (matrix doldurma).
 * - `PUT /admin/permissions/:userId`     — Override güncellemesi (granted: true | false | null).
 *
 * Yönetim uçları (catalog/get/put) OWNER/ADMIN. `me` ucu MEMBER dahil her
 * panel kullanıcısına açık — self-introspection; frontend menüyü taze tutmak
 * için periyodik çağırır. Override işlemleri için ek olarak hedef OWNER
 * olamaz (PermissionsService kontrol eder).
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/permissions')
export class PermissionsController {
  constructor(private readonly service: PermissionsService) {}

  // #15: Sayfa-izin matrisi yönetimi "Ayarlar → Kullanıcılar" sayfasının
  // parçası. `me` endpoint'i self-introspection olduğu için sayfa izni
  // gerektirmez; diğer uçlar matrisi okur/yazar.
  @Get('catalog')
  @Roles('OWNER', 'ADMIN')
  @UseGuards(PagePermissionGuard)
  @RequirePage('ayarlar_kullanicilar')
  catalog() {
    return {
      success: true,
      data: {
        pages: PAGE_KEYS.map((key) => ({ key, label: PAGE_LABELS[key] })),
        roleDefaults: {
          OWNER: '*' as const,
          ADMIN: ROLE_PAGE_DEFAULTS.ADMIN,
          MEMBER: ROLE_PAGE_DEFAULTS.MEMBER,
          CUSTOMER: ROLE_PAGE_DEFAULTS.CUSTOMER,
        },
        // Yasak liste YOK: patron her sayfayı/yetkiyi açabilir (boş dizi
        // geriye dönük uyumluluk için korunuyor).
        memberBlocked: [] as string[],
      },
    };
  }

  @Get('me')
  @Roles('OWNER', 'ADMIN', 'MEMBER')
  async me(@Req() req: Request & { user: RequestUser }) {
    const eff = await this.service.getEffectivePermissions(req.user.id);
    return { success: true, data: eff };
  }

  @Get(':userId')
  @Roles('OWNER', 'ADMIN')
  @UseGuards(PagePermissionGuard)
  @RequirePage('ayarlar_kullanicilar')
  async getForUser(
    @Param('userId') userId: string,
    @Req() req: Request & { user: RequestUser },
  ) {
    // Tenant kısıtı: başka tenant'ın kullanıcısı okunamaz (404).
    const eff = await this.service.getEffectivePermissions(
      userId,
      req.user.tenantId,
    );
    return { success: true, data: eff };
  }

  @Put(':userId')
  @Roles('OWNER', 'ADMIN')
  @UseGuards(PagePermissionGuard)
  @RequirePage('ayarlar_kullanicilar')
  async update(
    @Param('userId') userId: string,
    @Body() dto: UpdatePermissionsDto,
    @Req() req: Request & { user: RequestUser },
  ) {
    const eff = await this.service.setOverrides(
      userId,
      dto.updates,
      { id: req.user.id, tenantId: req.user.tenantId },
    );
    return { success: true, data: eff };
  }
}
