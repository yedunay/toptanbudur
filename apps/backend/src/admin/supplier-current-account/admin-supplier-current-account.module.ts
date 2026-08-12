import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditModule } from '../../audit/audit.module';
import { AdminProfitabilityModule } from '../profitability/admin-profitability.module';
import { AdminSupplierCurrentAccountController } from './admin-supplier-current-account.controller';
import { AdminSupplierCurrentAccountService } from './admin-supplier-current-account.service';

@Module({
  imports: [PrismaModule, AuditModule, AdminProfitabilityModule],
  controllers: [AdminSupplierCurrentAccountController],
  providers: [AdminSupplierCurrentAccountService],
})
export class AdminSupplierCurrentAccountModule {}
