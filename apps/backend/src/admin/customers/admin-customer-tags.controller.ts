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
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { RequirePage } from '../../permissions/require-page.decorator';
import { PagePermissionGuard } from '../../permissions/page-permission.guard';
import type { RequestUser } from '../../auth/jwt.strategy';
import { AdminCustomerTagsService } from './admin-customer-tags.service';
import {
  CreateCustomerTagDto,
  UpdateCustomerTagDto,
} from './dto/create-customer-tag.dto';

/**
 * Müşteri etiketleri CRUD — YALNIZ ADMIN ('customers' sayfa izni + OWNER/ADMIN).
 * `admin/customers/:id` ile route çakışmaması için ayrı prefix ('customer-tags').
 */
@UseGuards(JwtAuthGuard, RolesGuard, PagePermissionGuard)
@RequirePage('customers')
@Roles('OWNER', 'ADMIN', 'MEMBER')
@Controller('admin/customer-tags')
export class AdminCustomerTagsController {
  constructor(private readonly service: AdminCustomerTagsService) {}

  @Get()
  list(@Req() req: Request & { user: RequestUser }) {
    return this.service.list(req.user.tenantId);
  }

  @Post()
  create(
    @Req() req: Request & { user: RequestUser },
    @Body() dto: CreateCustomerTagDto,
  ) {
    return this.service.create(req.user.tenantId, dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Req() req: Request & { user: RequestUser },
    @Body() dto: UpdateCustomerTagDto,
  ) {
    return this.service.update(req.user.tenantId, id, dto);
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.service.remove(req.user.tenantId, id);
  }
}
