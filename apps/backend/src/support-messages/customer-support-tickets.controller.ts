import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  FileFieldsInterceptor,
  FilesInterceptor,
} from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import {
  CustomerJwtGuard,
  type RequestWithCustomer,
} from '../customer-auth/customer-jwt.guard';
import { PrismaService } from '../prisma/prisma.service';
import {
  SupportMessagesService,
  type UploadedAttachment,
} from './support-messages.service';
import { CreateCustomerSupportTicketDto } from './dto/create-customer-support-ticket.dto';
import type { CreateSupportMessageDto } from './dto/create-support-message.dto';
import { extractClientIp, extractUserAgent } from '../common/utils/request-meta';

const MAX_FILES = 5;
const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100 MB per file (foto+video)
const MAX_TOTAL_BYTES = 25 * 1024 * 1024; // 25 MB combined
// İADE FATURASI (PDF): görsellerden ayrı 'returnInvoice' alanı, 10 MB'a kadar.
const MAX_RETURN_INVOICE_BYTES = 10 * 1024 * 1024; // 10 MB

interface MulterFile {
  fieldname: string;
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * Customer-side endpoints for support tickets (incl. order-bound tickets
 * with optional cargo tracking metadata). Mounted at /me/support-tickets so
 * we reuse the CustomerJwtGuard pattern already used by CustomerProfileController.
 *
 * The base POST / accepts multipart/form-data so customers can attach up to
 * 5 images (jpeg/png/webp, 5 MB each) when describing the issue. Magic-byte
 * verification + persistence happens inside the service via the
 * driver-agnostic IFileStorage abstraction (local disk now, R2 later).
 */
@UseGuards(CustomerJwtGuard)
@Controller('me/support-tickets')
export class CustomerSupportTicketsController {
  constructor(
    private readonly service: SupportMessagesService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Create a ticket on behalf of the logged-in customer. If `orderId` is
   * provided we verify ownership before persisting; orderNumber is filled in
   * from the actual order so it can be displayed in admin without a join.
   * Accepts multipart/form-data with optional `files[]` field carrying up
   * to 5 images.
   */
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @Post()
  @HttpCode(201)
  @UseInterceptors(
    // İki alan: 'files' (görseller, ≤5) + 'returnInvoice' (iade faturası PDF, 1).
    // Multer üst sınırı 10 MB (PDF için); görsel 5 MB sınırı serviste zorlanır.
    FileFieldsInterceptor(
      [
        { name: 'files', maxCount: MAX_FILES },
        { name: 'returnInvoice', maxCount: 1 },
      ],
      // Üst sınır medya dosyaları için; PDF'in 10 MB sınırı serviste zorlanır.
      { limits: { fileSize: MAX_FILE_BYTES } },
    ),
  )
  async create(
    @Body() dto: CreateCustomerSupportTicketDto,
    @UploadedFiles()
    fileMap:
      | { files?: MulterFile[]; returnInvoice?: MulterFile[] }
      | undefined,
    @Req() req: RequestWithCustomer,
  ) {
    const customerId = req.customer!.id;
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, name: true, email: true },
    });
    if (!customer) throw new NotFoundException('customer not found');

    let resolvedOrderId: string | null = null;
    let resolvedOrderNumber: string | null = dto.orderNumber ?? null;
    if (dto.orderId) {
      const order = await this.prisma.order.findFirst({
        where: { id: dto.orderId, customerId },
        select: { id: true, humanOrderNo: true },
      });
      if (!order) {
        throw new NotFoundException('order not found for this customer');
      }
      resolvedOrderId = order.id;
      resolvedOrderNumber = order.humanOrderNo ?? resolvedOrderNumber;
    }

    const safeDto: CreateSupportMessageDto = {
      // Force name/email to come from the authenticated customer record so
      // anonymous body fields cannot be spoofed.
      name: customer.name,
      email: customer.email,
      subject: dto.subject,
      body: dto.body,
      orderId: resolvedOrderId ?? undefined,
      orderNumber: resolvedOrderNumber ?? undefined,
      kind: resolvedOrderId ? 'order' : 'general',
      category: dto.category,
      marketplace: dto.marketplace,
      carrier: dto.carrier,
      trackingCode: dto.trackingCode,
    };

    const list = Array.isArray(fileMap?.files) ? fileMap!.files! : [];
    if (list.length > MAX_FILES) {
      throw new BadRequestException(
        `En fazla ${MAX_FILES} adet dosya yükleyebilirsiniz.`,
      );
    }
    const totalBytes = list.reduce((sum, f) => sum + (f.size ?? 0), 0);
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new BadRequestException(
        'Toplam dosya boyutu sınırı aşıldı (25 MB).',
      );
    }
    const attachments: UploadedAttachment[] = list.map((f) => ({
      buffer: f.buffer,
      originalname: f.originalname,
      size: f.size,
      mimetype: f.mimetype,
    }));

    // İade faturası (PDF) — yalnız 'iade' kategorisinde ve sipariş faturalıysa
    // zorunlu; doğrulama (magic-byte + boyut + kapı) serviste yapılır.
    const invoiceFile = fileMap?.returnInvoice?.[0];
    const returnInvoice: UploadedAttachment | null = invoiceFile
      ? {
          buffer: invoiceFile.buffer,
          originalname: invoiceFile.originalname,
          size: invoiceFile.size,
          mimetype: invoiceFile.mimetype,
        }
      : null;

    const ip = extractClientIp(req);
    const userAgent = extractUserAgent(req);
    try {
      return await this.service.create(
        safeDto,
        {
          ip,
          userAgent,
          customerId,
          attachments,
          returnInvoice,
        },
        req,
      );
    } catch (err) {
      const message = (err as Error)?.message ?? 'destek talebi oluşturulamadı';
      throw new BadRequestException(message);
    }
  }

  @Get()
  async list(
    @Req() req: RequestWithCustomer,
    @Query('orderId') orderId?: string,
  ) {
    const customerId = req.customer!.id;
    return this.service.listForCustomer(customerId, orderId ?? null);
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @Req() req: RequestWithCustomer,
  ) {
    const customerId = req.customer!.id;
    return this.service.findOneForCustomer(id, customerId);
  }

  /**
   * Müşterinin kendi talebini kapatması (soft-archive → ARCHIVED). Sahiplik
   * service içinde customerId ile doğrulanır; başkasının talebine erişilemez.
   * Idempotent: zaten kapalıysa yine 200 döner.
   */
  @Throttle({ default: { limit: 30, ttl: 600_000 } })
  @Post(':id/close')
  @HttpCode(200)
  async close(
    @Param('id') id: string,
    @Req() req: RequestWithCustomer,
  ) {
    const customerId = req.customer!.id;
    return this.service.closeForCustomer(id, customerId);
  }

  /**
   * MÜŞTERİ İADE ADIMI — "Ürünü Kargoya Verdim". Onaylanmış (adres iletilmiş)
   * bir iade talebinde müşteri ürünü kargoladıktan sonra en az bir FOTOĞRAF
   * (kargo fişi/koli, ≤5 MB, jpeg/png/webp) yükler. Foto sohbete düşer + talep
   * SHIPPED_BACK'e geçer. PARA HAREKET ETMEZ; iade admin tarafında ürün teslim
   * alınıp incelendikten sonra tamamlanır. Sahiplik service'te customerId ile
   * doğrulanır.
   */
  @Throttle({ default: { limit: 20, ttl: 600_000 } })
  @Post(':id/return-shipped')
  @HttpCode(200)
  @UseInterceptors(
    FilesInterceptor('files', MAX_FILES, {
      limits: { fileSize: MAX_FILE_BYTES },
    }),
  )
  async returnShipped(
    @Param('id') id: string,
    @UploadedFiles() files: MulterFile[] | undefined,
    @Req() req: RequestWithCustomer,
  ) {
    const customerId = req.customer!.id;
    const list = Array.isArray(files) ? files : [];
    const photos: UploadedAttachment[] = list.map((f) => ({
      buffer: f.buffer,
      originalname: f.originalname,
      size: f.size,
      mimetype: f.mimetype,
    }));
    // markReturnShipped düzgün HttpException'lar fırlatır (Conflict/NotFound/
    // BadRequest) — olduğu gibi geçsin; durum kodu + mesaj korunur.
    return this.service.markReturnShipped(id, customerId, photos, req);
  }
}
