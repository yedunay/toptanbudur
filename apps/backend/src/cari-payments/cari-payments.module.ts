import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CariPaymentsService } from './cari-payments.service';
import { AdminCariPaymentsController } from './admin-cari-payments.controller';
import { CustomerCariPaymentsController } from './customer-cari-payments.controller';
import { MailModule } from '../mail/mail.module';
import { AppSettingsModule } from '../app-settings/app-settings.module';

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
    AppSettingsModule,
  ],
  controllers: [AdminCariPaymentsController, CustomerCariPaymentsController],
  providers: [CariPaymentsService],
  exports: [CariPaymentsService],
})
export class CariPaymentsModule {}
