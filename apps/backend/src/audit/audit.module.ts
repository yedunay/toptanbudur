import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { AuditDigestService } from './audit-digest.service';

@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService, AuditDigestService],
  exports: [AuditService, AuditDigestService],
})
export class AuditModule {}
