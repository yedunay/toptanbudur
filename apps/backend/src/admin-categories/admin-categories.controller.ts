import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { RequestUser } from '../auth/jwt.strategy';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { RequirePage } from '../permissions/require-page.decorator';
import { PagePermissionGuard } from '../permissions/page-permission.guard';
import { AdminCategoriesService } from './admin-categories.service';
import { CreateCategoryDto, UpdateCategoryDto } from './dto';

@UseGuards(JwtAuthGuard, RolesGuard, PagePermissionGuard)
@RequirePage('products')
@Roles('OWNER', 'ADMIN', 'MEMBER')
@Controller('admin/categories')
export class AdminCategoriesController {
  constructor(private readonly categories: AdminCategoriesService) {}

  @Get()
  tree(@Req() req: Request & { user: RequestUser }) {
    return this.categories.tree(req.user.tenantId);
  }

  @Post()
  @HttpCode(201)
  create(
    @Body() dto: CreateCategoryDto,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.categories.create(req.user.tenantId, req.user.id, dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.categories.update(req.user.tenantId, req.user.id, id, dto);
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.categories.remove(req.user.tenantId, req.user.id, id);
  }
}
