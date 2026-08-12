import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { FormsService } from './forms.service';
import { CreateFormDto } from './dto/create-form.dto';
import { UpdateFormDto } from './dto/update-form.dto';
import { ListFormsDto } from './dto/list-forms.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { RequirePage } from '../permissions/require-page.decorator';
import { PagePermissionGuard } from '../permissions/page-permission.guard';
import type { RequestUser } from '../auth/jwt.strategy';

@Controller('forms')
export class FormsController {
  constructor(private readonly service: FormsService) {}

  // Throttle gevşetildi: 5/10dk → 20/5dk. Geliştirme sırasında eski 5-istek
  // kotası dolup gerçek formlar 429 alıyordu. ThrottlerModule global olarak
  // route bazlı uygulanıyor; tek IP'den makul kullanım için 20 yeter.
  @Throttle({ default: { limit: 20, ttl: 300_000 } })
  @Post()
  @HttpCode(201)
  create(@Body() dto: CreateFormDto, @Req() req: Request) {
    return this.service.create(dto, req);
  }
}

// #15: Form (başvuru/iletişim) yönetimi frontend'de "mesajlar" sayfası altında
// gösteriliyor → aynı sayfa izniyle korunur.
@UseGuards(JwtAuthGuard, RolesGuard, PagePermissionGuard)
@Roles('OWNER', 'ADMIN', 'MEMBER')
@RequirePage('mesajlar')
@Controller('admin/forms')
export class AdminFormsController {
  constructor(private readonly service: FormsService) {}

  @Get()
  list(@Query() query: ListFormsDto) {
    return this.service.list(query);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateFormDto,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.service.update(
      id,
      dto,
      { id: req.user.id, tenantId: req.user.tenantId, email: req.user.email },
      req,
    );
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.service.remove(
      id,
      { id: req.user.id, tenantId: req.user.tenantId, email: req.user.email },
      req,
    );
  }
}
