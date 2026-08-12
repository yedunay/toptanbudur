import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  CustomerJwtGuard,
  type RequestWithCustomer,
} from '../customer-auth/customer-jwt.guard';
import { CariBalanceService } from './cari-balance.service';
import { TopupRequestDto } from './dto/topup-request.dto';
import { CariStatementQueryDto } from './dto/cari-statement.dto';

@UseGuards(CustomerJwtGuard)
@Controller('me/cari-balance')
export class CustomerCariBalanceController {
  constructor(private readonly service: CariBalanceService) {}

  @Get()
  getBalance(@Req() req: RequestWithCustomer) {
    return this.service.getBalanceForCustomer(req.customer!.id);
  }

  @Get('summary')
  getSummary(@Req() req: RequestWithCustomer) {
    return this.service.getSummaryForCustomer(req.customer!.id);
  }

  @Get('ledger')
  getLedger(
    @Req() req: RequestWithCustomer,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.listLedgerForCustomer(req.customer!.id, {
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize, 10) : 20,
      type,
      status,
      from,
      to,
    });
  }

  @Get('topups')
  getTopups(
    @Req() req: RequestWithCustomer,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.listTopupsForCustomer(
      req.customer!.id,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 20,
    );
  }

  @Get('bank-accounts')
  getBankAccounts() {
    return this.service.listActiveBankAccounts();
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('topups')
  createTopup(
    @Body() dto: TopupRequestDto,
    @Req() req: RequestWithCustomer,
  ) {
    return this.service.createTopupRequest({
      customerId: req.customer!.id,
      amount: dto.amount,
      customerNote: dto.customerNote,
      bankAccountId: dto.bankAccountId,
      req,
    });
  }

  /**
   * KART ile cari yükleme talebi — komisyon hesaplanır, PENDING topup açılır.
   * Ardından frontend /payments/paytr/topup-token ile ödeme ekranını açar;
   * tahsilat success olunca sistem otomatik onaylar (admin onayı yok).
   */
  @Throttle({ medium: { limit: 5, ttl: 60_000 } })
  @Post('topups/card')
  createCardTopup(
    @Body() dto: TopupRequestDto,
    @Req() req: RequestWithCustomer,
  ) {
    return this.service.createCardTopupRequest({
      customerId: req.customer!.id,
      amount: dto.amount,
    });
  }

  /** Tek yükleme talebinin durumu — kart ödeme sonuç sayfası bunu poll eder. */
  @Get('topups/status')
  getTopupStatus(@Req() req: RequestWithCustomer, @Query('id') id: string) {
    return this.service.getTopupStatusForCustomer(req.customer!.id, id ?? '');
  }

  /**
   * Kart yüklemesine ait tahsilat makbuzu (PDF signed URL). Yalnızca kart ile
   * yapılmış yüklemelerde makbuz vardır; havale yüklemelerinde 404 döner.
   */
  @Get('topups/:topupId/receipt')
  getTopupReceipt(
    @Req() req: RequestWithCustomer,
    @Param('topupId') topupId: string,
  ) {
    return this.service.getTopupReceiptForCustomer(req.customer!.id, topupId);
  }

  @Get('statement')
  getStatement(@Req() req: RequestWithCustomer, @Query() q: CariStatementQueryDto) {
    return this.service.getStatementForCustomer(req.customer!.id, q);
  }

  @Get('statement/summary')
  getStatementSummary(@Req() req: RequestWithCustomer) {
    return this.service.getStatementSummaryForCustomer(req.customer!.id);
  }

  @Get('statement/export')
  async exportStatement(
    @Req() req: RequestWithCustomer,
    @Query() q: CariStatementQueryDto,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.service.exportStatementForCustomer(
      req.customer!.id,
      q,
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(buffer);
  }
}
