import {
  Controller,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PagePermissionGuard } from '../permissions/page-permission.guard';
import { RequirePage } from '../permissions/require-page.decorator';
import type { RequestUser } from '../auth/jwt.strategy';
import { IngestService } from './ingest.service';

/**
 * IngestController artık tek bir senkron-tetikleme rotası tutuyor:
 *   POST /api/admin/suppliers/:id/sync-now (synchronous)
 *
 * Asenkron BullMQ enqueue rotası (`POST :id/sync`) AdminSuppliersController
 * tarafında yaşıyor — orası audit log + yetki kontrolünü zaten içeriyor.
 * Eski `:id/sync` route'u burada tanımlıydı ve aynı path'i çift-handler'a
 * götürüyordu. Bu method silindi.
 */
@UseGuards(JwtAuthGuard, RolesGuard, PagePermissionGuard)
@RequirePage('suppliers')
@Roles('OWNER', 'ADMIN', 'MEMBER')
@Controller('admin/suppliers')
export class IngestController {
  constructor(private readonly ingest: IngestService) {}

  @Post(':id/sync-now')
  async syncNow(
    @Param('id') id: string,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.ingest.syncSupplier(id, req.user.tenantId);
  }
}
