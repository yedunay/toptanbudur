import { Module } from '@nestjs/common';
import { CustomerAuthModule } from '../../customer-auth/customer-auth.module';
import { CustomerInvoicesController } from './customer-invoices.controller';
import { CustomerInvoicesService } from './customer-invoices.service';

/**
 * Faz 8 — Bayi "Faturalarım" modülü (birfatura.md §10).
 *
 * Yalnızca InvoiceBatch'i salt-okur; kesim/push motorlarına ihtiyaç duymaz, bu
 * yüzden BirfaturaModule import etmez. Guard için CustomerAuthModule yeter
 * (PrismaService global'dir).
 */
@Module({
  imports: [CustomerAuthModule],
  controllers: [CustomerInvoicesController],
  providers: [CustomerInvoicesService],
})
export class CustomerInvoicesModule {}
