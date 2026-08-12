import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { ConversationType, ConversationSenderType } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { RequirePage } from '../permissions/require-page.decorator';
import { PagePermissionGuard } from '../permissions/page-permission.guard';
import type { RequestUser } from '../auth/jwt.strategy';
import {
  ConversationsService,
  type UploadedFile,
} from './conversations.service';
import { PostMessageDto } from './dto/post-message.dto';

const MAX_FILES = 5;
// Foto + video kabulü (2026-08-02): video için 100 MB/dosya.
const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100 MB per file
const MAX_TOTAL_BYTES = 150 * 1024 * 1024; // 150 MB combined

interface MulterFile {
  fieldname: string;
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * Admin tarafı sohbet uçları.
 *
 * #40: Bu uçların DEDIKE FE sayfası `/konusmalar` (KonusmalarPage) olup admin
 * SPA'da `mesajlar` page-key'i ile korunur (App.tsx). Eskiden burada `iadeler`
 * isteniyordu → `/konusmalar` sayfası `mesajlar` izinli sub-admin'lerde 403
 * veriyordu. Backend anahtarı FE'nin dedike sayfa key'iyle hizalandı.
 *
 * NOT (kalan risk): Aynı uçlar SupportTickets (`orders`) sayfasına gömülü
 * ConversationChat tarafından da çağrılıyor. PagePermissionGuard çok-anahtarı
 * AND olarak değerlendirdiği için tek key ile OR ifade edilemiyor; OWNER
 * (`['*']`) tüm sayfalarda sorunsuz, yalnız SADECE `orders` izinli
 * sub-admin'lerde gömülü sohbet etkilenebilir.
 */
@UseGuards(JwtAuthGuard, RolesGuard, PagePermissionGuard)
@RequirePage('mesajlar')
@Roles('OWNER', 'ADMIN', 'MEMBER')
@Controller('admin/conversations')
export class AdminConversationsController {
  constructor(private readonly service: ConversationsService) {}

  @Get()
  list(@Query('type') type?: string) {
    const parsed =
      type === 'SUPPORT' || type === 'DEALER_RETURN_ORDER'
        ? (type as ConversationType)
        : undefined;
    return this.service.listForAdmin({ type: parsed });
  }

  @Get(':id/messages')
  listMessages(@Param('id') id: string) {
    return this.service.listMessages({
      conversationId: id,
      viewer: { kind: 'admin' },
    });
  }

  @Post(':id/messages')
  @HttpCode(201)
  @UseInterceptors(
    FilesInterceptor('files', MAX_FILES, {
      limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES },
    }),
  )
  async postMessage(
    @Param('id') id: string,
    @Body() dto: PostMessageDto,
    @UploadedFiles() files: MulterFile[] | undefined,
    @Req() req: Request & { user: RequestUser },
  ) {
    const list = Array.isArray(files) ? files : [];
    if (list.length > MAX_FILES) {
      throw new BadRequestException(
        `En fazla ${MAX_FILES} adet görsel yükleyebilirsiniz.`,
      );
    }
    const totalBytes = list.reduce((sum, f) => sum + (f.size ?? 0), 0);
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new BadRequestException('Toplam dosya boyutu sınırı aşıldı (25 MB).');
    }
    const attachments: UploadedFile[] = list.map((f) => ({
      buffer: f.buffer,
      originalname: f.originalname,
      size: f.size,
      mimetype: f.mimetype,
    }));

    try {
      const message = await this.service.postMessage({
        conversationId: id,
        senderType: ConversationSenderType.ADMIN,
        senderUserId: req.user.id,
        body: dto.body,
        files: attachments,
      });
      return { success: true, data: { id: message.id } };
    } catch (err) {
      const message = (err as Error)?.message ?? 'mesaj gönderilemedi';
      throw new BadRequestException(message);
    }
  }

  @Post(':id/read')
  @HttpCode(200)
  markRead(@Param('id') id: string) {
    return this.service.markRead({
      conversationId: id,
      viewer: { kind: 'admin' },
    });
  }
}
