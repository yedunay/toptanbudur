import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PagePermissionGuard } from '../permissions/page-permission.guard';
import { RequirePage } from '../permissions/require-page.decorator';
import type { RequestUser } from '../auth/jwt.strategy';
import { AppSettingsService } from './app-settings.service';
import { UpdateSettingDto } from './dto/update-setting.dto';

// Global ayarlar yalnız Değişkenler sayfası üzerinden okunur/yazılır —
// 'ayarlar_degiskenler' sayfa izni şart (matristen açılabilir).
@UseGuards(JwtAuthGuard, RolesGuard, PagePermissionGuard)
@RequirePage('ayarlar_degiskenler')
@Roles('OWNER', 'ADMIN', 'MEMBER')
@Controller('admin/settings')
export class AppSettingsController {
  constructor(private readonly service: AppSettingsService) {}

  @Get()
  async list(@Query('category') category?: string) {
    const rows = await this.service.list(category);
    return {
      success: true,
      data: rows.map((r) => ({
        key: r.key,
        value: r.value,
        type: r.type,
        category: r.category,
        label: r.label,
        description: r.description,
        minValue: r.minValue !== null ? Number(r.minValue) : null,
        maxValue: r.maxValue !== null ? Number(r.maxValue) : null,
        updatedAt: r.updatedAt,
        updatedBy: r.updatedBy,
      })),
    };
  }

  @Put(':key')
  async update(
    @Param('key') key: string,
    @Body() dto: UpdateSettingDto,
    @Req() req: Request & { user: RequestUser },
  ) {
    const updated = await this.service.set(key, dto.value, {
      id: req.user.id,
      tenantId: req.user.tenantId,
    });
    return {
      success: true,
      data: { key: updated.key, value: updated.value, updatedAt: updated.updatedAt },
    };
  }
}
