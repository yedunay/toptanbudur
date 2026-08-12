import {
  Controller,
  Get,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PartnerFinanceApiGuard, type RequestWithPartner } from './partner-finance-api.guard';
import { PartnerFinanceDataService } from './partner-finance-data.service';
import type { PartnerContext } from './partner-finance-api-key.service';

/**
 * Dış Finans API — halka açık ama API-anahtarı korumalı, YALNIZ GET.
 * Global `/api` prefix'i ile uçlar: `/api/partner-finance/*`.
 *
 * Kimlik doğrulama PartnerFinanceApiGuard'da (token → ortak). Her istek ortağın
 * KENDİ dilimine kilitlidir (token hangi ortağa aitse). Throttle: 60 istek/dk.
 */
@Controller('partner-finance')
@UseGuards(PartnerFinanceApiGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class PartnerFinanceApiController {
  constructor(private readonly data: PartnerFinanceDataService) {}

  private partner(req: RequestWithPartner): PartnerContext {
    const p = req.partnerAuth?.partner;
    if (!p) throw new UnauthorizedException('Ortak çözümlenemedi.');
    return p;
  }

  /** Anahtarın hangi ortağa ait olduğunu doğrular (sağlık/kimlik ucu). */
  @Get('me')
  me(@Req() req: RequestWithPartner) {
    return this.data.identity(this.partner(req));
  }

  /** Başlık kartı: seçili ay + kümülatif şirket & ortak rakamları. */
  @Get('summary')
  summary(@Req() req: RequestWithPartner, @Query('month') month?: string) {
    return this.data.summary(this.partner(req), month);
  }

  /** Seçili ayın tam finans dökümü (ortağın dilimiyle). */
  @Get('monthly')
  monthly(@Req() req: RequestWithPartner, @Query('month') month?: string) {
    return this.data.monthly(this.partner(req), month);
  }

  /** Ay-ay şirket gelir/gider/kâr trendi + ortağın o ayki çekimleri. */
  @Get('series')
  series(
    @Req() req: RequestWithPartner,
    @Query('months') months?: string,
    @Query('to') to?: string,
  ) {
    return this.data.series(this.partner(req), months, to);
  }

  /** Ortağın kâr avansı (çekim) geçmişi. */
  @Get('advances')
  advances(
    @Req() req: RequestWithPartner,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.data.advances(this.partner(req), from, to);
  }
}
