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
import {
  SupportQuickRepliesService,
  type QuickReplyIntent,
} from './support-quick-replies.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { RequirePage } from '../permissions/require-page.decorator';
import { PagePermissionGuard } from '../permissions/page-permission.guard';
import type { RequestUser } from '../auth/jwt.strategy';

interface UpsertQuickReplyBody {
  title?: string;
  body?: string;
  intent?: QuickReplyIntent | null;
  isActive?: boolean;
  sortOrder?: number;
}

/**
 * Admin sipariş-talebi hızlı yanıt (hazır cevap) yönetimi. Aynı 'mesajlar'
 * sayfa-izni + OWNER/ADMIN rol kapısıyla korunur (sipariş talepleri sayfasıyla
 * tutarlı). Servis tüm girdileri sanitize/clamp ettiği için ek validation
 * pipe'ına gerek yoktur.
 */
@UseGuards(JwtAuthGuard, RolesGuard, PagePermissionGuard)
@RequirePage('mesajlar')
@Roles('OWNER', 'ADMIN', 'MEMBER')
@Controller('admin/support-quick-replies')
export class SupportQuickRepliesController {
  constructor(private readonly service: SupportQuickRepliesService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post()
  create(
    @Body() body: UpsertQuickReplyBody,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.service.create(
      {
        title: body.title ?? '',
        body: body.body ?? '',
        intent: body.intent ?? null,
        isActive: body.isActive,
      },
      { id: req.user.id },
    );
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: UpsertQuickReplyBody,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.service.update(id, body, { id: req.user.id });
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.service.remove(id, { id: req.user.id });
  }
}
