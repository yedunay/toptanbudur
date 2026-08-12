import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AutoShipService } from './auto-ship.service';

// #3: Otomatik sevk tetikleyicisi yüksek-etkili bir operasyon (tüm uygun
// siparişleri sevk eder). Yalnız OWNER manuel olarak tetikleyebilsin.
@Controller('admin/auto-ship')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER')
export class AutoShipController {
  constructor(private readonly autoShip: AutoShipService) {}

  @Post('run-now')
  async runNow() {
    const result = await this.autoShip.runAutoShip();
    return { success: true, data: result };
  }
}
