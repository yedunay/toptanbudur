import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { RequirePage } from '../../permissions/require-page.decorator';
import { PagePermissionGuard } from '../../permissions/page-permission.guard';
import type { RequestUser } from '../../auth/jwt.strategy';
import { AdminInvoicesService } from './admin-invoices.service';
import {
  FreezeInvoicesDto,
  PreviewInvoicesDto,
  UpdateInvoiceSettingsDto,
} from './dto/admin-invoices.dto';

/**
 * Faz 7 — Admin konsolide fatura paneli API'si (birfatura.md §9).
 *
 * Guard deseni customers ile aynı: JWT + Roller + sayfa izni (`ayarlar_fatura`).
 * Tüm yanıtlar `{ success, data }` zarfında döner (frontend lib unwrap eder).
 */
@UseGuards(JwtAuthGuard, RolesGuard, PagePermissionGuard)
@RequirePage('ayarlar_fatura')
@Roles('OWNER', 'ADMIN', 'MEMBER')
@Controller('admin/invoices')
export class AdminInvoicesController {
  constructor(private readonly service: AdminInvoicesService) {}

  /** Fatura ayar bloğu (cutoffDay / packagingUnitFee / consolidationEnabled / ordersEnabled). */
  @Get('settings')
  async getSettings() {
    return { success: true, data: await this.service.getSettings() };
  }

  /** Verilen ayar alanlarını yazar (her biri içeride doğrulanır + audit'lenir). */
  @Put('settings')
  async updateSettings(
    @Body() dto: UpdateInvoiceSettingsDto,
    @Req() req: Request & { user: RequestUser },
  ) {
    const data = await this.service.updateSettings(dto, {
      id: req.user.id,
      tenantId: req.user.tenantId,
    });
    return { success: true, data };
  }

  /** Ay-ay gruplanmış batch listesi (opsiyonel customerId / status filtresi). */
  @Get('batches')
  async listBatches(
    @Query('customerId') customerId?: string,
    @Query('status') status?: string,
  ) {
    return { success: true, data: await this.service.listBatches({ customerId, status }) };
  }

  /** Tek batch detayı (üye siparişler + kalem dökümü + toplamlar). */
  @Get('batches/:id')
  async getBatch(@Param('id') id: string) {
    return { success: true, data: await this.service.getBatch(id) };
  }

  /** Tek bayinin tüm faturaları (müşteri alt sayfası / fatura geçmişi). */
  @Get('customers/:customerId/batches')
  async listCustomerBatches(@Param('customerId') customerId: string) {
    return {
      success: true,
      data: await this.service.listCustomerBatches(customerId),
    };
  }

  /** Tekli (customerId verili) veya toplu kesim tetiği. */
  @Post('freeze')
  async freeze(
    @Body() dto: FreezeInvoicesDto,
    @Req() req: Request & { user: RequestUser },
  ) {
    const data = await this.service.freezeInvoices(
      dto.customerId,
      req.user.id,
      dto.asOf,
    );
    return { success: true, data };
  }

  /** Önizleme — DB'ye yazmadan kesilecek faturanın birebir aynısı. */
  @Post('preview')
  async preview(@Body() dto: PreviewInvoicesDto) {
    return { success: true, data: await this.service.preview(dto) };
  }

  /**
   * Donmuş batch'i iptal et + üye siparişleri serbest bırak (birfatura.md §12.9).
   * Faturalanmış batch iptal edilemez (409); zaten iptalse idempotent döner.
   */
  @Post('batches/:id/cancel')
  async cancelBatch(
    @Param('id') id: string,
    @Req() req: Request & { user: RequestUser },
  ) {
    const data = await this.service.cancelBatch(id, req.user.id);
    return { success: true, data };
  }
}
