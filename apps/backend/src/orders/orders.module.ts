import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { OrdersController } from './orders.controller';
import { CustomerOrdersController } from './customer-orders.controller';
import { OrdersService } from './orders.service';
import { OrderNumberService } from './order-number.service';
import { MailModule } from '../mail/mail.module';
import { CariBalanceModule } from '../cari-balance/cari-balance.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { HouseStockModule } from '../house-stock/house-stock.module';
import { ReceiptsModule } from '../receipts/receipts.module';
import { BasitKargoModule } from '../basitkargo/basitkargo.module';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
    MailModule,
    CariBalanceModule,
    ConversationsModule,
    HouseStockModule,
    ReceiptsModule,
    BasitKargoModule,
  ],
  controllers: [OrdersController, CustomerOrdersController],
  providers: [OrdersService, OrderNumberService],
  exports: [OrdersService, OrderNumberService],
})
export class OrdersModule {}
