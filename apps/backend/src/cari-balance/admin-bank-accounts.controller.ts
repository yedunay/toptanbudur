import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { RequirePage } from '../permissions/require-page.decorator';
import { PagePermissionGuard } from '../permissions/page-permission.guard';
import type { RequestUser } from '../auth/jwt.strategy';
import { CariBalanceService } from './cari-balance.service';
import {
  BankAccountUpdateDto,
  BankAccountUpsertDto,
} from './dto/bank-account.dto';

@UseGuards(JwtAuthGuard, RolesGuard, PagePermissionGuard)
@RequirePage('banka_bilgileri')
@Roles('OWNER', 'ADMIN', 'MEMBER')
@Controller('admin/bank-accounts')
export class AdminBankAccountsController {
  constructor(private readonly service: CariBalanceService) {}

  @Get()
  list() {
    return this.service.listBankAccountsForAdmin();
  }

  @Post()
  create(
    @Body() dto: BankAccountUpsertDto,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.service.createBankAccount(
      dto,
      { id: req.user.id, email: req.user.email, tenantId: req.user.tenantId },
      req,
    );
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: BankAccountUpdateDto,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.service.updateBankAccount(
      id,
      dto,
      { id: req.user.id, email: req.user.email, tenantId: req.user.tenantId },
      req,
    );
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.service.deleteBankAccount(
      id,
      { id: req.user.id, email: req.user.email, tenantId: req.user.tenantId },
      req,
    );
  }
}
