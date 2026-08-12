import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { OrdersModule } from '../../orders/orders.module';
import { CariBalanceModule } from '../../cari-balance/cari-balance.module';
import { PaytrClient } from './paytr.client';
import { PaytrController } from './paytr.controller';
import { PaytrService } from './paytr.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
    OrdersModule,
    CariBalanceModule,
  ],
  controllers: [PaytrController],
  providers: [PaytrClient, PaytrService],
  exports: [PaytrClient, PaytrService],
})
export class PaytrModule {}
