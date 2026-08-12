import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { RequirePage } from '../../permissions/require-page.decorator';
import { PagePermissionGuard } from '../../permissions/page-permission.guard';
import { canSeeCostProfit } from '../../permissions/capability.util';

type AdminReq = Request & { user: RequestUser };
import type { RequestUser } from '../../auth/jwt.strategy';

/**
 * İndirim/kâr yapılandırması (discountPercent, profitDiscountPercent,
 * customerStatus) "⚙ Yetki — Maliyet & Kâr Görebilir" anahtarına bağlıdır;
 * patron izin matrisinden istediği kullanıcıya açabilir.
 */
function canSeeProfitConfig(req: AdminReq): boolean {
  return canSeeCostProfit(req);
}
import { AdminCustomersService } from './admin-customers.service';
import {
  AdjustCustomerBalanceDto,
  BulkCustomerActionDto,
  CreateTestCustomerDto,
  GiftCustomerBalanceDto,
  SetCustomerPasswordDto,
  SetCustomerTagsDto,
  SetVacationModeDto,
  UpdateCustomerDto,
  UpdateDiscountDto,
} from './dto/admin-customer.dto';

@UseGuards(JwtAuthGuard, RolesGuard, PagePermissionGuard)
@RequirePage('customers')
@Roles('OWNER', 'ADMIN', 'MEMBER')
@Controller('admin/customers')
export class AdminCustomersController {
  constructor(private readonly service: AdminCustomersService) {}

  @Get()
  list(
    @Req() req: Request & { user: RequestUser },
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('q') q?: string,
    @Query('tagId') tagId?: string,
    @Query('autoTag') autoTag?: string,
  ) {
    // "all" sentinel'ı sayısal parse edilmez — parseInt('all') NaN üretirdi.
    const wantsAll = pageSize === 'all';
    return this.service.list(req.user.tenantId, {
      page: page ? parseInt(page, 10) : undefined,
      pageSize: wantsAll || !pageSize ? undefined : parseInt(pageSize, 10),
      all: wantsAll,
      q,
      tagId: tagId || undefined,
      autoTag: autoTag || undefined,
    }, canSeeProfitConfig(req as AdminReq));
  }

  @Get(':id')
  findOne(
    @Param('id') id: string,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.service.findOne(
      req.user.tenantId,
      id,
      canSeeProfitConfig(req as AdminReq),
    );
  }

  /** Müşterinin MANUEL etiketlerini verilen sete eşitler (set-all). */
  @Put(':id/tags')
  setTags(
    @Param('id') id: string,
    @Body() dto: SetCustomerTagsDto,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.service.setCustomerTags(req.user.tenantId, id, dto.tagIds);
  }

  @Patch(':id/discount')
  @RequirePage('customers', 'yetki_maliyet_kar')
  updateDiscount(
    @Param('id') id: string,
    @Body() body: UpdateDiscountDto,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.service.updateDiscount(
      id,
      body.discountPercent,
      { id: req.user.id, tenantId: req.user.tenantId },
    );
  }

  /**
   * PATCH /api/admin/customers/:id
   * Body: { name?, email?, phone?, vergiDairesi?, discountPercent? } —
   * kısmi güncelleme. Audit log: CUSTOMER_UPDATED.
   */
  @Patch(':id')
  @RequirePage('customers', 'yetki_maliyet_kar')
  update(
    @Param('id') id: string,
    @Body() body: UpdateCustomerDto,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.service.updateCustomer(id, body, {
      id: req.user.id,
      tenantId: req.user.tenantId,
    });
  }

  /**
   * POST /api/admin/customers/:id/regenerate-token
   * Müşterinin XML feed token'ını yeniden üretir (cuid). Eski token devre dışı.
   * Audit log: CUSTOMER_TOKEN_REGENERATED.
   */
  @Post(':id/regenerate-token')
  @Roles('OWNER', 'ADMIN')
  @HttpCode(200)
  regenerateToken(
    @Param('id') id: string,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.service.regenerateXmlToken(id, {
      id: req.user.id,
      tenantId: req.user.tenantId,
    });
  }

  /**
   * POST /api/admin/customers/:id/reset-password
   * Şifreyi sabit varsayılana "toptan1234" döndürür ve mustChangePassword=true
   * işaretler. Müşteri /giris ile girince yeni şifre belirlemeye zorlanır.
   * Audit log: CUSTOMER_PASSWORD_RESET.
   */
  @Post(':id/reset-password')
  @Roles('OWNER', 'ADMIN')
  @HttpCode(200)
  resetPassword(
    @Param('id') id: string,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.service.resetPassword(id, {
      id: req.user.id,
      tenantId: req.user.tenantId,
    });
  }

  /**
   * PATCH /api/admin/customers/:id/password
   * Body: { password: string } — admin tarafından özel şifre belirleme.
   * mustChangePassword=false. encryptedPassword da güncellenir, böylece
   * görüntüleme akışı plaintext döner. Audit log: CUSTOMER_PASSWORD_SET.
   */
  @Patch(':id/password')
  @Roles('OWNER', 'ADMIN')
  @HttpCode(200)
  setPassword(
    @Param('id') id: string,
    @Body() body: SetCustomerPasswordDto,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.service.setPassword(id, body.password, {
      id: req.user.id,
      tenantId: req.user.tenantId,
    });
  }

  /**
   * GET /api/admin/customers/:id/password
   * Admin "şifre görüntüle" — encryptedPassword AES çözer ve plaintext döner.
   * Sealed kopya yoksa `{ password: null, hasEncryptedPassword: false }` döner;
   * UI bu durumda "Şifre kayıtlı değil — sıfırla" mesajını gösterir ve
   * `POST :id/reset-password` akışına yönlendirir.
   *
   * Throttle: 5 req/dakika — admin başı (auth user). Bulk şifre tarama riskine
   * karşı koruma. Audit log: CUSTOMER_PASSWORD_VIEWED.
   */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Get(':id/password')
  @Roles('OWNER', 'ADMIN')
  getPassword(
    @Param('id') id: string,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.service.getPassword(id, {
      id: req.user.id,
      tenantId: req.user.tenantId,
    });
  }

  /**
   * DELETE /api/admin/customers/:id
   * Hard delete — Customer cascade addresses ve Order.customerId SET NULL.
   * Audit log: CUSTOMER_DELETED. (RLS yok — Customer model tenant-bağımsız.)
   */
  @Delete(':id')
  @Roles('OWNER', 'ADMIN')
  remove(
    @Param('id') id: string,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.service.remove(id, {
      id: req.user.id,
      tenantId: req.user.tenantId,
    });
  }

  @Get(':id/supplier-discounts')
  @RequirePage('customers', 'yetki_maliyet_kar')
  getSupplierDiscounts(
    @Param('id') id: string,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.service.getSupplierDiscounts(id, {
      id: req.user.id,
      tenantId: req.user.tenantId,
    });
  }

  @Put(':id/supplier-discounts')
  @RequirePage('customers', 'yetki_maliyet_kar')
  @HttpCode(200)
  updateSupplierDiscounts(
    @Param('id') id: string,
    @Body() body: { discounts: Array<{ supplierId: string; profitDiscountPercent?: number | null; adminDiscount?: boolean; clearOverride?: boolean }> },
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.service.updateSupplierDiscounts(
      id,
      body.discounts ?? [],
      {
        id: req.user.id,
        tenantId: req.user.tenantId,
        email: req.user.email,
      },
      req,
    );
  }

  /**
   * POST /api/admin/customers/:id/balance-adjustment
   * Body: { newBalance: number, reason?: string } — admin manuel cari bakiye
   * düzeltmesi. `newBalance` yeni mutlak bakiye; backend işaretli farkı hesaplar
   * ve ADJUSTMENT tipli CariLedger kaydı yazar. Audit log: CUSTOMER_BALANCE_ADJUSTED.
   */
  @Post(':id/balance-adjustment')
  @RequirePage('customers', 'yetki_para_islemleri')
  @HttpCode(200)
  adjustBalance(
    @Param('id') id: string,
    @Body() body: AdjustCustomerBalanceDto,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.service.adjustBalance(
      id,
      body.newBalance,
      body.reason,
      {
        id: req.user.id,
        tenantId: req.user.tenantId,
        email: req.user.email,
      },
      req,
    );
  }

  /**
   * POST /api/admin/customers/:id/gift-balance
   * Body: { amount: number (>0), note?: string } — admin HEDİYE BAKİYE tanımlar.
   * `amount` müşterinin cari bakiyesine EKLENECEK pozitif hediye tutarıdır.
   * Backend isGift+isPromo işaretli ADJUSTMENT ledger kaydı yazar, müşteriye
   * hediye e-postası gönderir. Audit log: CARI_GIFT_BALANCE_GRANT.
   */
  @Post(':id/gift-balance')
  @RequirePage('customers', 'yetki_para_islemleri')
  @HttpCode(200)
  giftBalance(
    @Param('id') id: string,
    @Body() body: GiftCustomerBalanceDto,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.service.giftBalance(
      id,
      body.amount,
      body.note,
      {
        id: req.user.id,
        tenantId: req.user.tenantId,
        email: req.user.email,
      },
      req,
    );
  }

  /**
   * GET /api/admin/customers/:id/cari-ledger?page=&pageSize=
   * Müşterinin cari hareket defteri — bakiye doğruluğunu denetlemek için
   * salt-okunur. Yükleme / sipariş ödemesi / iade / manuel düzeltme kayıtları.
   */
  @Get(':id/cari-ledger')
  @RequirePage('customers', 'yetki_para_islemleri')
  getCariLedger(
    @Param('id') id: string,
    @Req() req: Request & { user: RequestUser },
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.getCariLedger(
      id,
      { id: req.user.id, tenantId: req.user.tenantId },
      page ? parseInt(page, 10) : undefined,
      pageSize ? parseInt(pageSize, 10) : undefined,
    );
  }

  /**
   * POST /api/admin/customers/test
   * Geliştirme/QA için tek-tıkla test müşterisi yaratma yardımcısı.
   * Body opsiyonel: `{ email?, password?, name? }`. Gönderilmezse
   * `musteri-{ts}@test.local` / `test1234` üretilir. Email çakışırsa upsert
   * davranışı: parola yeniden hashlenir, mevcut kayıt güncellenir.
   * Cevap, plain-text password içerir (sadece bu uçta!).
   */
  @Post('test')
  @HttpCode(201)
  createTest(
    @Req() req: Request & { user: RequestUser },
    @Body() body: CreateTestCustomerDto,
  ) {
    return this.service.createTestCustomer(
      { id: req.user.id, tenantId: req.user.tenantId },
      body ?? {},
    );
  }

  /**
   * POST /api/admin/customers/:id/activate
   * Ön kayıtlı (isActive=false) müşteriyi aktive eder: isActive=true, taze
   * geçici şifre üretilir ve hoş geldin e-postası gönderilir.
   */
  @Post(':id/activate')
  @HttpCode(200)
  activate(
    @Param('id') id: string,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.service.activateCustomer(id, {
      id: req.user.id,
      tenantId: req.user.tenantId,
    });
  }

  /**
   * PATCH /api/admin/customers/:id/vacation
   * Body: `{ enabled: boolean }` — müşteriyi tatil moduna alır/çıkarır.
   * Audit log: CUSTOMER_VACATION_ENABLED / CUSTOMER_VACATION_DISABLED.
   */
  @Patch(':id/vacation')
  setVacation(
    @Param('id') id: string,
    @Body() body: SetVacationModeDto,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.service.setVacationMode(id, body.enabled, {
      id: req.user.id,
      tenantId: req.user.tenantId,
    });
  }

  /**
   * Toplu aktif/pasif. Body: `{ ids: string[], action: 'activate' | 'deactivate' }`.
   * Tek müşteri aktivasyon akışından (welcome mail + temp parola) farklıdır;
   * toplu işlem sadece isActive flag'ini değiştirir.
   */
  @Post('bulk-action')
  @Roles('OWNER', 'ADMIN')
  @HttpCode(200)
  bulkAction(
    @Body() dto: BulkCustomerActionDto,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.service.bulkSetActive(
      req.user.tenantId,
      dto.ids,
      dto.action,
      { id: req.user.id },
    );
  }
}
