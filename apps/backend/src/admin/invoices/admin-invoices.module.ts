import { Module } from '@nestjs/common';
import { BirfaturaModule } from '../../birfatura/birfatura.module';
import { AdminInvoicesController } from './admin-invoices.controller';
import { AdminInvoicesService } from './admin-invoices.service';

/**
 * Faz 7 — Admin konsolide fatura paneli modülü (birfatura.md §9).
 *
 * `BirfaturaModule` import edilir → `FreezeService` + `PreviewService` enjekte
 * edilebilir (oradan export'lu). `AppSettingsService` global; `PrismaService`
 * global olarak sağlanır.
 */
@Module({
  imports: [BirfaturaModule],
  controllers: [AdminInvoicesController],
  providers: [AdminInvoicesService],
})
export class AdminInvoicesModule {}
