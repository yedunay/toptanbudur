import {
  Controller,
  Get,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PartnerFinanceApiGuard, type RequestWithPartner } from './partner-finance-api.guard';
import { PartnerAccountingService } from './partner-accounting.service';
import type { PartnerContext } from './partner-finance-api-key.service';

/**
 * Dış Finans API — Muhasebe uçları. Admin "Muhasebe" bölümündeki sayfaların
 * (Cari Hareketler / Tedarikçi Hesabı / Bayi Hesabı) verisini YALNIZ GET ile,
 * API-anahtarı korumalı olarak servis eder. Uçlar: `/api/partner-finance/muhasebe/*`.
 * Throttle: 60 istek/dk. Şirket geneli veridir (iki ortak için de aynı).
 */
@Controller('partner-finance/muhasebe')
@UseGuards(PartnerFinanceApiGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class PartnerAccountingController {
  constructor(private readonly acc: PartnerAccountingService) {}

  private partner(req: RequestWithPartner): PartnerContext {
    const p = req.partnerAuth?.partner;
    if (!p) throw new UnauthorizedException('Ortak çözümlenemedi.');
    return p;
  }

  /** Sayfalanmış tedarikçi listesi (id keşfi için). */
  @Get('suppliers')
  suppliers(
    @Req() req: RequestWithPartner,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.acc.listSuppliers(this.partner(req).tenantId, q, page, pageSize);
  }

  /** Sayfalanmış bayi/müşteri listesi (id + cari bakiye). */
  @Get('customers')
  customers(
    @Req() req: RequestWithPartner,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    // customers global (tenant'sız); ama yalnız yetkili token buraya gelebilir.
    this.partner(req);
    return this.acc.listCustomers(q, page, pageSize);
  }

  /** Birleşik cari hareket dökümü. type=supplier|dealer, id zorunlu. */
  @Get('ledger')
  ledger(
    @Req() req: RequestWithPartner,
    @Query('type') type?: string,
    @Query('id') id?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.acc.ledger(this.partner(req).tenantId, type, id, {
      from,
      to,
      page,
      pageSize,
    });
  }

  /** Tedarikçi hesabı raporu. supplierId zorunlu. */
  @Get('tedarikci-hesap')
  supplierAccount(
    @Req() req: RequestWithPartner,
    @Query('supplierId') supplierId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.acc.supplierAccount(this.partner(req).tenantId, supplierId, {
      from,
      to,
    });
  }

  /** Bayi hesabı raporu. customerId zorunlu. */
  @Get('bayi-hesap')
  dealerAccount(
    @Req() req: RequestWithPartner,
    @Query('customerId') customerId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.acc.dealerAccount(this.partner(req).tenantId, customerId, {
      from,
      to,
    });
  }

  /** Tahsilat makbuzları (kredi kartı) — filtreli + sayfalı. */
  @Get('makbuzlar')
  receipts(
    @Req() req: RequestWithPartner,
    @Query('kind') kind?: string,
    @Query('customerId') customerId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.acc.listReceipts(this.partner(req).tenantId, {
      kind,
      customerId,
      from,
      to,
      page,
      pageSize,
    });
  }

  /** Makbuzu olan bayilerin listesi (filtre için). */
  @Get('makbuzlar/dealers')
  receiptDealers(@Req() req: RequestWithPartner) {
    return this.acc.receiptDealers(this.partner(req).tenantId);
  }
}
