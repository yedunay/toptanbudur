import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import {
  CustomerJwtGuard,
  type RequestWithCustomer,
} from '../customer-auth/customer-jwt.guard';
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
 * Müşteri (bayi) tarafı sohbet uçları. /me/conversations altında, support
 * controller'ı ile aynı CustomerJwtGuard desenini kullanır.
 */
@UseGuards(CustomerJwtGuard)
@Controller('me/conversations')
export class ConversationsController {
  constructor(private readonly service: ConversationsService) {}

  @Get(':id/messages')
  async listMessages(
    @Param('id') id: string,
    @Req() req: RequestWithCustomer,
  ) {
    const customerId = req.customer!.id;
    return this.service.listMessages({
      conversationId: id,
      viewer: { kind: 'customer', customerId },
    });
  }

  @Throttle({ default: { limit: 30, ttl: 600_000 } })
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
    @Req() req: RequestWithCustomer,
  ) {
    const customerId = req.customer!.id;

    // Erişim kontrolü için katılımcı tipini belirle (alıcı/satıcı/support).
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

    const senderType = await this.service.resolveCustomerSenderType(
      id,
      customerId,
    );

    try {
      const message = await this.service.postMessage({
        conversationId: id,
        senderType,
        senderCustomerId: customerId,
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
  async markRead(@Param('id') id: string, @Req() req: RequestWithCustomer) {
    const customerId = req.customer!.id;
    return this.service.markRead({
      conversationId: id,
      viewer: { kind: 'customer', customerId },
    });
  }
}
