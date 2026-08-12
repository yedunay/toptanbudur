import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
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
import { AdminPosService } from './admin-pos.service';
import {
  PaytrReportDto,
  PaytrStatusQueryDto,
  PosProviderCreateDto,
  PosProviderUpdateDto,
  PosTestPaymentDto,
  ToslaStatusQueryDto,
} from './dto/pos-provider.dto';

type AdminReq = Request & { user: RequestUser };

@UseGuards(JwtAuthGuard, RolesGuard, PagePermissionGuard)
@RequirePage('pos')
@Roles('OWNER', 'ADMIN', 'MEMBER')
@Controller('admin/pos')
export class AdminPosController {
  constructor(private readonly service: AdminPosService) {}

  @Get()
  list(@Req() req: AdminReq) {
    return this.service.list(req.user.tenantId);
  }

  @Post()
  create(@Body() dto: PosProviderCreateDto) {
    return this.service.create(dto);
  }

  // ── PayTR araçları (sabit yollar :key rotalarından ÖNCE gelmeli) ─────────

  @Post('paytr/status-query')
  paytrStatusQuery(@Body() dto: PaytrStatusQueryDto) {
    return this.service.paytrStatusQuery(dto.merchantOid);
  }

  @Post('paytr/transaction-report')
  paytrTransactionReport(@Body() dto: PaytrReportDto) {
    return this.service.paytrTransactionReport(dto.startDate, dto.endDate);
  }

  @Post('paytr/payment-report')
  paytrPaymentReport(@Body() dto: PaytrReportDto) {
    return this.service.paytrPaymentReport(dto.startDate, dto.endDate);
  }

  // ── TOSLA araçları (salt-okuma Durum Sorgu; iade/iptal YOK) ───────────────

  @Post('tosla/status-query')
  toslaStatusQuery(@Body() dto: ToslaStatusQueryDto) {
    return this.service.toslaStatusQuery(dto.merchantOid);
  }

  // ── Sağlayıcı CRUD ────────────────────────────────────────────────────────

  @Get(':key/detail')
  detail(@Param('key') key: string, @Req() req: AdminReq) {
    return this.service.detail(req.user.tenantId, key);
  }

  @Post(':key/activate')
  activate(@Param('key') key: string) {
    return this.service.activate(key);
  }

  @Post(':key/deactivate')
  deactivate(@Param('key') key: string) {
    return this.service.deactivate(key);
  }

  /**
   * Test Çekimi — müşterinin gördüğü ödeme ekranının aynısını (iframe URL)
   * üretir; gerçek sipariş/işlem YARATMAZ (callback no-op). Admin POS detayında
   * "Test Çekimi" bölümü kullanır.
   */
  @Post(':key/test-payment')
  testPayment(@Param('key') key: string, @Body() dto: PosTestPaymentDto) {
    return this.service.testPayment(key, dto.amount);
  }

  @Patch(':key')
  update(@Param('key') key: string, @Body() dto: PosProviderUpdateDto) {
    return this.service.update(key, dto);
  }

  @Delete(':key')
  remove(@Param('key') key: string) {
    return this.service.remove(key);
  }
}
