import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  CustomerJwtGuard,
  type RequestWithCustomer,
} from '../customer-auth/customer-jwt.guard';
import { OrdersService } from './orders.service';

@UseGuards(CustomerJwtGuard)
@Controller('customer/orders')
export class CustomerOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get()
  list(@Req() req: RequestWithCustomer) {
    return this.orders.listForCustomer(req.customer!.id);
  }
}
