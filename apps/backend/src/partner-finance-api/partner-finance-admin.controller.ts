import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import type { RequestUser } from '../auth/jwt.strategy';
import { PartnerFinanceApiKeyService } from './partner-finance-api-key.service';
import { GenerateFinanceApiKeyDto } from './dto/finance-api-key.dto';

/**
 * Admin tarafı — ortağın "Hesabım" sayfasından KENDİ Finans API anahtarını
 * yönetmesi. Yalnız bir finans ortağına bağlı admin kullanıcı (bkz.
 * `PARTNER_FINANCE_EMAIL_MAP` env'i) gerçek veri görür; diğer adminlerde
 * `state.isPartner=false` döner ve panelde
 * bölüm gizlenir. Tüm uçlar JWT + ADMIN/OWNER ister.
 */
@Controller('admin/finance-api')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'OWNER')
export class PartnerFinanceAdminController {
  constructor(private readonly keys: PartnerFinanceApiKeyService) {}

  private user(req: Request & { user: RequestUser }) {
    return { id: req.user.id, email: req.user.email };
  }

  /** Bu kullanıcı ortak mı + aktif anahtarın maskeli durumu. */
  @Get('state')
  getState(@Req() req: Request & { user: RequestUser }) {
    return this.keys.getState(req.user.tenantId, this.user(req));
  }

  /** (Yeniden) üret — düz metin BİR kez döner (ve sonra reveal ile alınabilir). */
  @Post('key')
  generate(
    @Req() req: Request & { user: RequestUser },
    @Body() dto: GenerateFinanceApiKeyDto,
  ) {
    return this.keys.generateKey(req.user.tenantId, this.user(req), dto.label);
  }

  /** Aktif anahtarın düz metnini çözer (yalnız sahibine). */
  @Get('key/reveal')
  reveal(@Req() req: Request & { user: RequestUser }) {
    return this.keys.revealKey(req.user.tenantId, this.user(req));
  }

  /** Aktif anahtar(lar)ı iptal eder. */
  @Post('key/revoke')
  revoke(@Req() req: Request & { user: RequestUser }) {
    return this.keys.revokeKey(req.user.tenantId, this.user(req));
  }
}
