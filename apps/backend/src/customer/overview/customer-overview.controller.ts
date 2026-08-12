import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import {
  CustomerJwtGuard,
  type RequestWithCustomer,
} from '../../customer-auth/customer-jwt.guard';
import { CustomerOverviewService } from './customer-overview.service';

@UseGuards(CustomerJwtGuard)
@Controller('me/overview')
export class CustomerOverviewController {
  constructor(private readonly service: CustomerOverviewService) {}

  @Get()
  overview(@Req() req: RequestWithCustomer) {
    return this.service.overview(req.customer!.id);
  }
}
