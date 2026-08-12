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
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { SupportMessagesService } from './support-messages.service';
import { CreateSupportMessageDto } from './dto/create-support-message.dto';
import { UpdateSupportMessageDto } from './dto/update-support-message.dto';
import { ListSupportMessagesDto } from './dto/list-support-messages.dto';
import { DecideReturnDto } from './dto/decide-return.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { RequirePage } from '../permissions/require-page.decorator';
import { PagePermissionGuard } from '../permissions/page-permission.guard';
import { extractClientIp, extractUserAgent } from '../common/utils/request-meta';
import type { RequestUser } from '../auth/jwt.strategy';

/**
 * Public route — site contact form posts here:
 *   POST /api/forms/contact
 *
 * Mounted under `forms/contact` (NOT `forms`) so it does NOT collide with
 * the existing FormsController @Controller('forms') multi-purpose endpoint.
 */
@Controller('forms/contact')
export class PublicSupportMessagesController {
  constructor(private readonly service: SupportMessagesService) {}

  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  @Post()
  @HttpCode(201)
  create(@Body() dto: CreateSupportMessageDto, @Req() req: Request) {
    const ip = extractClientIp(req);
    const userAgent = extractUserAgent(req);
    return this.service.create(dto, { ip, userAgent }, req);
  }
}

// #40 NOT: Bu uç hem `/mesajlar` (MesajlarPage, page-key `mesajlar`) hem
// `/orders/talepler` (SupportTicketsPage, page-key `orders`) tarafından
// kullanılıyor. PagePermissionGuard çok-anahtarı AND olarak değerlendirir; tek
// controller'da iki key'i OR ile ifade etmek mümkün değil. `mesajlar`, uca ait
// KANONİK sayfa (`/mesajlar` mesaj merkezi) ile uyumlu bırakıldı — `orders`'a
// çevirmek mesaj merkezinden destek mesajlarını SESSİZCE düşürürdü (fetchAll
// support 403'ü catch'liyor). `/orders/talepler` 403'ünün temiz çözümü guard'a
// OR-of-keys desteği eklemek (bu oturumun dosyaları dışında) veya App.tsx'te o
// rotayı `mesajlar` ile guard'lamak (C-ADMIN alanı).
@UseGuards(JwtAuthGuard, RolesGuard, PagePermissionGuard)
@RequirePage('mesajlar')
@Roles('OWNER', 'ADMIN', 'MEMBER')
@Controller('admin/support-messages')
export class AdminSupportMessagesController {
  constructor(private readonly service: SupportMessagesService) {}

  @Get()
  list(@Query() query: ListSupportMessagesDto) {
    return this.service.list(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSupportMessageDto,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.service.update(
      id,
      dto,
      { id: req.user.id, tenantId: req.user.tenantId, email: req.user.email },
      req,
    );
  }

  /**
   * İADE KARARI — approve (adres iletilir) | reject (aksiyon yok) | finalize
   * (sipariş 'İade Edildi' + cari iade). Sadece category='iade' + returnStatus
   * dolu taleplerde anlamlı; servis doğrular.
   */
  @Patch(':id/return')
  decideReturn(
    @Param('id') id: string,
    @Body() dto: DecideReturnDto,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.service.decideReturn(
      id,
      dto,
      { id: req.user.id, tenantId: req.user.tenantId, email: req.user.email },
      req,
    );
  }

  /**
   * Default = soft-delete (status -> ARCHIVED). Pass ?hard=true for purge.
   */
  @Delete(':id')
  remove(
    @Param('id') id: string,
    @Req() req: Request & { user: RequestUser },
    @Query('hard') hard?: string,
  ) {
    return this.service.remove(
      id,
      hard === 'true',
      { id: req.user.id, tenantId: req.user.tenantId, email: req.user.email },
      req,
    );
  }
}
