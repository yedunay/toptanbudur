import {
  Controller,
  Get,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AdminMuhasebeService } from './admin-muhasebe.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import {
  RequireAnyPage,
  RequirePage,
} from '../../permissions/require-page.decorator';
import { PagePermissionGuard } from '../../permissions/page-permission.guard';
import type { RequestUser } from '../../auth/jwt.strategy';

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function toInt(v: unknown, fallback: number): number {
  const n = parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Muhasebe uçları — muhasebe.md Faz 3/4/5.
 *
 * Sınıf seviyesinde @RequirePage YOK (kasıtlı): arama uçları birden fazla
 * sayfanın ortak picker'ı olduğundan @RequireAnyPage (OR) ile korunur; veri
 * uçları metot seviyesinde ilgili sayfa anahtarını
 * (muhasebe_cari_hareketler / muhasebe_tedarikci_hesap / muhasebe_bayi_hesap)
 * talep eder. PagePermissionGuard metot metadata'sı sınıf metadata'sını TAMAMEN
 * geçersiz kıldığından, anahtar dağılımı metot seviyesinde yönetilir.
 */
@Controller('admin/muhasebe')
@UseGuards(JwtAuthGuard, RolesGuard, PagePermissionGuard)
@Roles('ADMIN', 'OWNER', 'MEMBER')
export class AdminMuhasebeController {
  constructor(private readonly svc: AdminMuhasebeService) {}

  // ── Arama — ortak picker'lar. Çağıran sayfalar: muhasebe_* üçlüsü +
  // Pazaryeri Entegratör (customers) + Karşılaştırmalar (comparisons).
  // Yalnız id+isim düzeyinde veri döner; OR-guard bu sayfalardan herhangi
  // birine izni olan kullanıcıya açar. ─────────────────────────────────────

  @Get('search/suppliers')
  @RequireAnyPage(
    'muhasebe_cari_hareketler',
    'muhasebe_tedarikci_hesap',
    'muhasebe_bayi_hesap',
    'customers',
    'comparisons',
  )
  searchSuppliers(
    @Req() req: Request & { user: RequestUser },
    @Query('q') q?: string,
  ) {
    return this.svc.searchSuppliers(req.user.tenantId, q ?? '');
  }

  @Get('search/customers')
  @RequireAnyPage(
    'muhasebe_cari_hareketler',
    'muhasebe_tedarikci_hesap',
    'muhasebe_bayi_hesap',
    'customers',
    'comparisons',
  )
  searchCustomers(
    @Req() req: Request & { user: RequestUser },
    @Query('q') q?: string,
  ) {
    return this.svc.searchCustomers(req.user.tenantId, q ?? '');
  }

  // ── Faz 3: Birleşik cari hareket dökümü ──────────────────────────────────

  @Get('ledger')
  @RequirePage('muhasebe_cari_hareketler')
  getLedger(
    @Req() req: Request & { user: RequestUser },
    @Query('type') type: 'supplier' | 'dealer',
    @Query('id') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const t = type === 'dealer' ? 'dealer' : 'supplier';
    return this.svc.getLedger(req.user.tenantId, t, id, {
      from,
      to,
      page: toInt(page, 1),
      pageSize: toInt(pageSize, 50),
    });
  }

  @Get('ledger/export')
  @RequirePage('muhasebe_cari_hareketler')
  async exportLedger(
    @Req() req: Request & { user: RequestUser },
    @Query('type') type: 'supplier' | 'dealer',
    @Query('id') id: string,
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const t = type === 'dealer' ? 'dealer' : 'supplier';
    const { buffer, filename } = await this.svc.exportLedger(
      req.user.tenantId,
      t,
      id,
      { from, to },
    );
    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.end(buffer);
  }

  // ── Faz 4: Tedarikçi hesabı ──────────────────────────────────────────────

  @Get('tedarikci-hesap')
  @RequirePage('muhasebe_tedarikci_hesap')
  getSupplierAccount(
    @Req() req: Request & { user: RequestUser },
    @Query('supplierId') supplierId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.svc.getSupplierAccountReport(req.user.tenantId, supplierId, {
      from,
      to,
    });
  }

  @Get('tedarikci-hesap/export')
  @RequirePage('muhasebe_tedarikci_hesap')
  async exportSupplierAccount(
    @Req() req: Request & { user: RequestUser },
    @Query('supplierId') supplierId: string,
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const { buffer, filename } = await this.svc.exportSupplierAccount(
      req.user.tenantId,
      supplierId,
      { from, to },
    );
    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.end(buffer);
  }

  // ── Faz 5: Bayi hesabı ───────────────────────────────────────────────────

  @Get('bayi-hesap')
  @RequirePage('muhasebe_bayi_hesap')
  getDealerAccount(
    @Req() req: Request & { user: RequestUser },
    @Query('customerId') customerId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.svc.getDealerAccountReport(req.user.tenantId, customerId, {
      from,
      to,
    });
  }

  @Get('bayi-hesap/export')
  @RequirePage('muhasebe_bayi_hesap')
  async exportDealerAccount(
    @Req() req: Request & { user: RequestUser },
    @Query('customerId') customerId: string,
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const { buffer, filename } = await this.svc.exportDealerAccount(
      req.user.tenantId,
      customerId,
      { from, to },
    );
    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.end(buffer);
  }
}
