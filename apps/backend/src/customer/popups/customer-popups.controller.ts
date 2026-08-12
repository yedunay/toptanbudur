import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { CustomerJwtGuard } from '../../customer-auth/customer-jwt.guard';
import type { RequestWithCustomer } from '../../customer-auth/customer-jwt.guard';
import { CustomerPopupsService } from './customer-popups.service';

@UseGuards(CustomerJwtGuard)
@Controller('me/popups')
export class CustomerPopupsController {
  constructor(private readonly service: CustomerPopupsService) {}

  @Get()
  active(@Req() req: RequestWithCustomer) {
    return this.service.getActive(req.customer!.id);
  }

  @Post(':id/seen')
  seen(@Param('id') id: string, @Req() req: RequestWithCustomer) {
    return this.service.markSeen(req.customer!.id, id);
  }

  @Post(':id/dismiss')
  dismiss(@Param('id') id: string, @Req() req: RequestWithCustomer) {
    return this.service.markDismissed(req.customer!.id, id);
  }

  @Post(':id/click')
  click(@Param('id') id: string, @Req() req: RequestWithCustomer) {
    return this.service.markClicked(req.customer!.id, id);
  }
}
