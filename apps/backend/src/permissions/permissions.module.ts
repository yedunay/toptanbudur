import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { PermissionsService } from './permissions.service';
import { PermissionsController } from './permissions.controller';
import { PagePermissionGuard } from './page-permission.guard';

// Global: PagePermissionGuard artık PermissionsService'e bağımlı (canlı izin
// kontrolü) ve ~50 modülde @UseGuards ile kullanılıyor — her birine import
// eklemek yerine servis global injector'dan çözülür.
@Global()
@Module({
  imports: [PrismaModule, AuditModule],
  providers: [PermissionsService, PagePermissionGuard],
  controllers: [PermissionsController],
  exports: [PermissionsService, PagePermissionGuard],
})
export class PermissionsModule {}
