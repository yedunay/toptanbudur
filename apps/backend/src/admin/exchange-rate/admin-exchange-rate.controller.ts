import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, Min } from 'class-validator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { RequirePage } from '../../permissions/require-page.decorator';
import { PagePermissionGuard } from '../../permissions/page-permission.guard';
import { ExchangeRateService } from '../../common/services/exchange-rate.service';

class UsdRateQueryDto {
  /**
   * Margin (TL cinsinden, ör. 0.30 = 30 kuruş). Verilmezse 0.30 default.
   * SupplierForm bu değeri kullanıcının inputundan geçirir.
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  margin?: number;
}

@UseGuards(JwtAuthGuard, RolesGuard, PagePermissionGuard)
@RequirePage('ayarlar_degiskenler')
@Roles('OWNER', 'ADMIN', 'MEMBER')
@Controller('admin/exchange-rate')
export class AdminExchangeRateController {
  constructor(private readonly service: ExchangeRateService) {}

  /**
   * Anlık USD/TRY kuru. SupplierForm bu endpoint'i kullanıcı manuel kur
   * alanını boş bırakırsa "TCMB canlı: X TL (margin sonrası: Y TL)" göstermek
   * için çağırır.
   *
   * Response:
   *   rate          → TCMB ham satış kuru (ör. 42.83)
   *   source        → "TCMB"
   *   fetchedAt     → ISO timestamp (snapshot zamanı)
   *   margin        → Query'den gelen margin (default 0.30)
   *   withMargin    → rate + margin (ör. 43.13)
   *   cached        → true ise in-memory cache hit; false ise yeni fetch
   *   available     → false ise TCMB hiç ulaşılamadı (rate null döner)
   */
  @Get('usd')
  async usd(@Query() query: UsdRateQueryDto) {
    const margin = query.margin ?? 0.3;
    const wasCached = this.service.hasFreshCache();
    const snap = await this.service.getUsdToTry();

    if (!snap) {
      return {
        success: true,
        data: {
          rate: null,
          source: 'TCMB',
          fetchedAt: null,
          margin,
          withMargin: null,
          cached: false,
          available: false,
        },
      };
    }

    const withMargin = Math.round((snap.rate + margin) * 10000) / 10000;
    return {
      success: true,
      data: {
        rate: snap.rate,
        source: snap.source,
        fetchedAt: snap.fetchedAt.toISOString(),
        margin,
        withMargin,
        cached: wasCached,
        available: true,
      },
    };
  }
}
