import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { timingSafeEqual } from 'node:crypto';
import { BasitKargoService } from './basitkargo.service';
import { BasitKargoConfigService } from './basitkargo.config.service';

/**
 * Basit Kargo public uçları:
 *  - `POST webhook` — durum değişikliği bildirimi (BK panelinden `?k=<token>`
 *    ile çağrılır; timingSafeEqual doğrular). Global auth guard yok → token tek
 *    savunma. Throttle atlanır (BK callback'leri düşmemeli).
 *  - Konum proxy — il/ilçe/mahalle listeleri; token'ı client'a sızdırmamak için
 *    backend üzerinden geçer.
 */
@Controller('basitkargo')
export class BasitKargoController {
  constructor(
    private readonly service: BasitKargoService,
    private readonly config: BasitKargoConfigService,
  ) {}

  @SkipThrottle()
  @Post('webhook')
  async webhook(
    @Query('k') token: string | undefined,
    @Body() body: unknown,
  ): Promise<{ matched: boolean }> {
    this.assertWebhookToken(token);
    return this.service.handleWebhook(body);
  }

  @Get('cities')
  async cities() {
    return this.service.getCities();
  }

  @Get('cities/:id/towns')
  async towns(@Param('id') id: string) {
    return this.service.getTowns(id);
  }

  @Get('neighborhoods')
  async neighborhoods(
    @Query('city') city: string | undefined,
    @Query('town') town: string | undefined,
  ) {
    if (!city?.trim() || !town?.trim()) {
      throw new BadRequestException('city ve town parametreleri zorunlu');
    }
    return this.service.getNeighborhoods(city.trim(), town.trim());
  }

  private assertWebhookToken(provided: string | undefined): void {
    const expected = this.config.getWebhookToken();
    if (!expected) {
      throw new UnauthorizedException('webhook token not configured');
    }
    const a = Buffer.from(provided ?? '', 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('invalid webhook token');
    }
  }
}
