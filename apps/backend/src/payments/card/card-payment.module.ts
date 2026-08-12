import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PaytrModule } from '../paytr/paytr.module';
import { ToslaModule } from '../tosla/tosla.module';
import { CardPaymentController } from './card-payment.controller';
import { CardPaymentService } from './card-payment.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
    PaytrModule,
    ToslaModule,
  ],
  controllers: [CardPaymentController],
  providers: [CardPaymentService],
})
export class CardPaymentModule {}
