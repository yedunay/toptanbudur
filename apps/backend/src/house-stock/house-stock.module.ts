import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HouseStockController } from './house-stock.controller';
import { HouseStockService } from './house-stock.service';
import { HouseStockScheduler } from './house-stock.scheduler';
import { SupplierAccountModule } from '../supplier-account/supplier-account.module';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
    // Depo geri-alma / oto-transfer'de tedarikçi cüzdan iadesi için (idempotent).
    SupplierAccountModule,
  ],
  controllers: [HouseStockController],
  providers: [HouseStockService, HouseStockScheduler],
  exports: [HouseStockService],
})
export class HouseStockModule {}
