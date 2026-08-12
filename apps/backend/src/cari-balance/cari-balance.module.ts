import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CariBalanceService } from './cari-balance.service';
import { CariTopupNumberService } from './cari-topup-number.service';
import { CustomerCariBalanceController } from './customer-cari-balance.controller';
import { AdminCariTopupsController } from './admin-cari-topups.controller';
import { AdminCariLedgerController } from './admin-cari-ledger.controller';
import { AdminBankAccountsController } from './admin-bank-accounts.controller';
import { MailModule } from '../mail/mail.module';
import { ReceiptsModule } from '../receipts/receipts.module';

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
    ReceiptsModule,
  ],
  controllers: [
    CustomerCariBalanceController,
    AdminCariTopupsController,
    AdminCariLedgerController,
    AdminBankAccountsController,
  ],
  providers: [CariBalanceService, CariTopupNumberService],
  exports: [CariBalanceService, CariTopupNumberService],
})
export class CariBalanceModule {}
