import { Module } from '@nestjs/common';
import { AdminFinanceModule } from '../admin/finance/finance.module';
import { AdminMuhasebeModule } from '../admin/muhasebe/admin-muhasebe.module';
import { ReceiptsModule } from '../receipts/receipts.module';
import { PartnerFinanceApiKeyService } from './partner-finance-api-key.service';
import { PartnerFinanceDataService } from './partner-finance-data.service';
import { PartnerAccountingService } from './partner-accounting.service';
import { PartnerFinanceApiGuard } from './partner-finance-api.guard';
import { PartnerFinanceApiController } from './partner-finance-api.controller';
import { PartnerAccountingController } from './partner-accounting.controller';
import { PartnerFinanceAdminController } from './partner-finance-admin.controller';

/**
 * Ortak Finans API modülü.
 *  • PartnerFinanceApiController   → dış (token) GET uçları: /api/partner-finance/*
 *  • PartnerAccountingController   → dış (token) Muhasebe uçları: /api/partner-finance/muhasebe/*
 *  • PartnerFinanceAdminController → admin (JWT) anahtar yönetimi: /api/admin/finance-api/*
 *
 * AdminFinanceModule + AdminMuhasebeModule TEK doğru kaynağı (finans/muhasebe
 * motorlarını) sağlar — API panelle kuruşu kuruşuna aynı. Prisma & Vault @Global.
 */
@Module({
  imports: [AdminFinanceModule, AdminMuhasebeModule, ReceiptsModule],
  controllers: [
    PartnerFinanceApiController,
    PartnerAccountingController,
    PartnerFinanceAdminController,
  ],
  providers: [
    PartnerFinanceApiKeyService,
    PartnerFinanceDataService,
    PartnerAccountingService,
    PartnerFinanceApiGuard,
  ],
})
export class PartnerFinanceApiModule {}
