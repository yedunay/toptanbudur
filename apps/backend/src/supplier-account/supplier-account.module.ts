import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SupplierAccountService } from './supplier-account.service';
import { AdminSupplierAccountController } from './admin-supplier-account.controller';
import { MailModule } from '../mail/mail.module';

// ──────────────────────────────────────────────────────────────────────────
//  TEDARİKÇİ BAKİYE SENKRONU modülü
//  PrismaModule + NotificationsModule @Global olduğundan tekrar import gerekmez.
//  MailModule (MailService + AdminNotifierService) explicit import edilir.
// ──────────────────────────────────────────────────────────────────────────

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
  ],
  controllers: [AdminSupplierAccountController],
  providers: [SupplierAccountService],
  exports: [SupplierAccountService],
})
export class SupplierAccountModule {}
