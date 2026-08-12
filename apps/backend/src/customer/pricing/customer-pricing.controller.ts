import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import {
  CustomerJwtGuard,
  type RequestWithCustomer,
} from '../../customer-auth/customer-jwt.guard';
import { CustomerPricingService } from './customer-pricing.service';
import { EffectivePricesDto } from './dto/effective-prices.dto';

@UseGuards(CustomerJwtGuard)
@Controller('me/pricing')
export class CustomerPricingController {
  constructor(private readonly service: CustomerPricingService) {}

  @Post('effective')
  @HttpCode(200)
  effective(
    @Body() dto: EffectivePricesDto,
    @Req() req: RequestWithCustomer,
  ) {
    return this.service.getEffectivePrices(
      req.customer!.id,
      dto.tenantSlug,
      dto.slugs,
    );
  }
}
