import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  CustomerJwtGuard,
  type RequestWithCustomer,
} from '../../customer-auth/customer-jwt.guard';
import { CustomerProfileService } from './customer-profile.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { CreateAddressDto, UpdateAddressDto } from './dto/address.dto';
import { SetVacationModeDto } from './dto/vacation-mode.dto';

@UseGuards(CustomerJwtGuard)
@Controller('me')
export class CustomerProfileController {
  constructor(private readonly service: CustomerProfileService) {}

  @Get()
  getProfile(@Req() req: RequestWithCustomer) {
    return this.service.getProfile(req.customer!.id);
  }

  @Patch()
  updateProfile(
    @Body() dto: UpdateProfileDto,
    @Req() req: RequestWithCustomer,
  ) {
    return this.service.updateProfile(req.customer!.id, dto, req);
  }

  @Patch('password')
  @HttpCode(200)
  changePassword(
    @Body() dto: ChangePasswordDto,
    @Req() req: RequestWithCustomer,
  ) {
    return this.service.changePassword(req.customer!.id, dto, req);
  }

  @Get('addresses')
  listAddresses(@Req() req: RequestWithCustomer) {
    return this.service.listAddresses(req.customer!.id);
  }

  @Post('addresses')
  createAddress(
    @Body() dto: CreateAddressDto,
    @Req() req: RequestWithCustomer,
  ) {
    return this.service.createAddress(req.customer!.id, dto, req);
  }

  @Patch('addresses/:id')
  updateAddress(
    @Param('id') id: string,
    @Body() dto: UpdateAddressDto,
    @Req() req: RequestWithCustomer,
  ) {
    return this.service.updateAddress(req.customer!.id, id, dto, req);
  }

  @Delete('addresses/:id')
  deleteAddress(
    @Param('id') id: string,
    @Req() req: RequestWithCustomer,
  ) {
    return this.service.deleteAddress(req.customer!.id, id, req);
  }

  @Put('addresses/:id/default')
  @HttpCode(200)
  setDefaultAddress(
    @Param('id') id: string,
    @Req() req: RequestWithCustomer,
  ) {
    return this.service.setDefaultAddress(req.customer!.id, id, req);
  }

  /**
   * PATCH /api/me/vacation
   * Body: `{ enabled: boolean }` — müşteri kendi tatil modunu açar/kapatır.
   * Tatil modu bayinin geçici olarak siparişe kapalı olduğunu işaretler.
   */
  @Patch('vacation')
  @HttpCode(200)
  setVacation(
    @Body() dto: SetVacationModeDto,
    @Req() req: RequestWithCustomer,
  ) {
    return this.service.setVacationMode(req.customer!.id, dto.enabled, req);
  }
}
