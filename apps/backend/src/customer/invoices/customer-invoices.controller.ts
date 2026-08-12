import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import {
  CustomerJwtGuard,
  type RequestWithCustomer,
} from '../../customer-auth/customer-jwt.guard';
import { CustomerInvoicesService } from './customer-invoices.service';

/**
 * Faz 8 — Bayi "Faturalarım" controller'ı (birfatura.md §10).
 *
 * `CustomerJwtGuard` ile korunur; her uç `req.customer!.id` ile kapsamlanır →
 * bir bayi yalnızca kendi konsolide aylık toplu faturalarını görür. Tüm
 * yanıtlar `{ success, data }` zarfında döner (proje konvansiyonu).
 */
@UseGuards(CustomerJwtGuard)
@Controller('me/invoices')
export class CustomerInvoicesController {
  constructor(private readonly service: CustomerInvoicesService) {}

  /** Bayinin tüm faturaları, ay-ay gruplanmış. */
  @Get()
  async list(@Req() req: RequestWithCustomer) {
    return { success: true, data: await this.service.listMine(req.customer!.id) };
  }

  /** Tek faturanın tam detayı (sahiplik doğrulamalı). */
  @Get(':id')
  async detail(@Param('id') id: string, @Req() req: RequestWithCustomer) {
    return {
      success: true,
      data: await this.service.getMine(req.customer!.id, id),
    };
  }
}
