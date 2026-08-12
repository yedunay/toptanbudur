import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { PrismaModule } from '../prisma/prisma.module';
import { AdminNotifierService } from './admin-notifier.service';
import { MailService } from './mail.service';

@Module({
  imports: [ConfigModule, PrismaModule],
  providers: [MailService, AdminNotifierService],
  exports: [MailService, AdminNotifierService],
})
export class MailModule {}
