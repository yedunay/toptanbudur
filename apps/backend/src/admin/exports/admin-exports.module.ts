import { Module } from '@nestjs/common';
import { MailModule } from '../../mail/mail.module';
import { ProductCoreModule } from '../../product-core/product-core.module';
import { AdminExportsService } from './admin-exports.service';
import { AdminExportsController } from './admin-exports.controller';

@Module({
  imports: [MailModule, ProductCoreModule],
  providers: [AdminExportsService],
  controllers: [AdminExportsController],
})
export class AdminExportsModule {}
