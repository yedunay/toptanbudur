import { Module } from '@nestjs/common';
import { OrdersModule } from '../../orders/orders.module';
import { CariBalanceModule } from '../../cari-balance/cari-balance.module';
import { ToslaClient } from './tosla.client';
import { ToslaController } from './tosla.controller';
import { ToslaService } from './tosla.service';

@Module({
  imports: [OrdersModule, CariBalanceModule],
  controllers: [ToslaController],
  providers: [ToslaClient, ToslaService],
  exports: [ToslaClient, ToslaService],
})
export class ToslaModule {}
