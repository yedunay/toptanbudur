import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Req,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PagePermissionGuard } from '../permissions/page-permission.guard';
import { RequireAnyPage } from '../permissions/require-page.decorator';
import type { RequestUser } from '../auth/jwt.strategy';
import { AuditService } from '../audit/audit.service';
import { SECRET_REGISTRY, SecretsService } from './secrets.service';

class UpdateSecretDto {
  @IsString()
  @MinLength(1)
  value!: string;
}

// Kredensiyel uçları POS detay (pos) ve Fatura (ayarlar_fatura) sayfalarından
// çağrılır — OR-guard: iki sayfadan birinin izni yeterli. Okumalar maskeli,
// yazma/silme method-seviyesi @Roles('OWNER') ile ayrıca kilitli.
@UseGuards(JwtAuthGuard, RolesGuard, PagePermissionGuard)
@RequireAnyPage('pos', 'ayarlar_fatura')
@Roles('OWNER', 'ADMIN', 'MEMBER')
@Controller('admin/secrets')
export class SecretsController {
  constructor(
    private readonly secrets: SecretsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list() {
    const items = await Promise.all(
      Object.values(SECRET_REGISTRY).map(async (meta) => {
        const configured = await this.secrets.isConfigured(meta.key);
        const masked = configured ? await this.secrets.getMasked(meta.key) : null;
        return {
          key: meta.key,
          label: meta.label,
          description: meta.description,
          envKey: meta.envKey,
          configured,
          masked,
        };
      }),
    );
    return { success: true, data: items };
  }

  @Get(':key')
  async getOne(@Param('key') key: string) {
    const meta = SECRET_REGISTRY[key];
    if (!meta) throw new BadRequestException('Unknown secret key');
    const configured = await this.secrets.isConfigured(key);
    return {
      success: true,
      data: {
        key: meta.key,
        label: meta.label,
        description: meta.description,
        envKey: meta.envKey,
        configured,
        masked: configured ? await this.secrets.getMasked(key) : null,
      },
    };
  }

  // Kredensiyel YAZMA yalnız OWNER (PayTR/BirFatura anahtarları hassas).
  // Method-level @Roles, controller'daki ('OWNER','ADMIN')'i override eder
  // (RolesGuard getAllAndOverride). GET'ler (maskeli okuma) admin'de kalır.
  @Roles('OWNER')
  @Put(':key')
  async update(
    @Param('key') key: string,
    @Body() dto: UpdateSecretDto,
    @Req() req: Request & { user: RequestUser },
  ) {
    const meta = SECRET_REGISTRY[key];
    if (!meta) throw new BadRequestException('Unknown secret key');

    await this.secrets.set(key, dto.value, {
      id: req.user.id,
      email: req.user.email,
    });

    await this.audit.record({
      action: 'admin.secrets.update',
      summary: `${req.user.email ?? 'Admin'} "${meta.label}" değerini güncelledi`,
      actor: {
        type: 'admin',
        id: req.user.id,
        email: req.user.email,
        tenantId: req.user.tenantId,
      },
      target: { id: meta.key, type: 'secret', label: meta.label },
      req,
    });

    return {
      success: true,
      data: { key, configured: true, masked: await this.secrets.getMasked(key) },
    };
  }

  // Kredensiyel SİLME yalnız OWNER (bkz. update — hassas anahtar yönetimi).
  @Roles('OWNER')
  @Delete(':key')
  async clear(
    @Param('key') key: string,
    @Req() req: Request & { user: RequestUser },
  ) {
    const meta = SECRET_REGISTRY[key];
    if (!meta) throw new BadRequestException('Unknown secret key');

    await this.secrets.clear(key, {
      id: req.user.id,
      email: req.user.email,
    });

    await this.audit.record({
      action: 'admin.secrets.clear',
      summary: `${req.user.email ?? 'Admin'} "${meta.label}" değerini sildi`,
      actor: {
        type: 'admin',
        id: req.user.id,
        email: req.user.email,
        tenantId: req.user.tenantId,
      },
      target: { id: meta.key, type: 'secret', label: meta.label },
      req,
    });

    return { success: true, data: { key, configured: false, masked: null } };
  }
}
