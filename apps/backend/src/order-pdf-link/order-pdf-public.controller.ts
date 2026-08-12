import {
  Controller,
  Get,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { STORAGE_SERVICE } from '../storage/storage.constants';
import type { IFileStorage } from '../storage/storage.interface';
import { OrderPdfLinkService } from './order-pdf-link.service';

/**
 * Kalıcı, TOKEN-korumalı sipariş-PDF servisi. URL şekli:
 *   /api/order-pdf/<orderId>/<token>
 *
 * StoragePublicController ile AYNI streaming yaklaşımı (objenin byte'larını
 * doğrudan akıtır — imza/exp YOK, o yüzden link hiç eskimez). Farkı: genel
 * public whitelist'i GENİŞLETMEZ; her istek OrderPdfLinkService HMAC token'ı ile
 * doğrulanır, böylece sipariş PDF'leri enumerate edilemez. Bu, storage-public
 * whitelist'inin sipariş PDF'lerini bilerek dışarıda tutan güvenlik kararını
 * ([[storage-public.controller]]) korur.
 *
 * Auth: route bilinçli olarak KİMLİKSİZDİR — tedarikçi (Ulu) sunucusu linki
 * kendi tarafından, bizim oturumumuz olmadan çeker. Backend'de global auth guard
 * yoktur (yalnız ThrottlerGuard rate-limit); güvenlik token'ın kendisidir.
 */
@Controller('order-pdf')
export class OrderPdfPublicController {
  private readonly logger = new Logger(OrderPdfPublicController.name);

  constructor(
    private readonly links: OrderPdfLinkService,
    private readonly prisma: PrismaService,
    @Inject(STORAGE_SERVICE) private readonly storage: IFileStorage,
  ) {}

  @Get(':orderId/:token')
  async serve(
    @Param('orderId') orderId: string,
    @Param('token') token: string,
    @Res() res: Response,
  ): Promise<void> {
    // Geçersiz/bozuk token → 404 (403 değil: siparişin var olup olmadığını
    // sızdırmayalım). Enumerate girişimleri broken-file ile karşılaşır.
    if (!this.links.verify(orderId, token)) throw new NotFoundException();

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { pdfKey: true, pdfPurgedAt: true },
    });
    // PDF yoksa / 30 günlük saklama süresi dolduysa (pdfPurgedAt) 404.
    if (!order || order.pdfPurgedAt !== null || !order.pdfKey) {
      throw new NotFoundException();
    }

    let body: Buffer;
    try {
      body = await this.storage.read(order.pdfKey);
    } catch (err) {
      this.logger.warn(
        `order-pdf read failed order=${orderId} key=${order.pdfKey}: ${(err as Error).message}`,
      );
      throw new NotFoundException();
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', body.length);
    res.setHeader('Content-Disposition', 'inline; filename="siparis.pdf"');
    // Key content-addressed (dosya adı upload başına uuid) → byte'lar değişmez,
    // immutable cache güvenli. Süresiz link + immutable cache = kalıcı erişim.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    // helmet default CORP same-origin; tedarikçi/başka origin çekebilsin diye
    // gevşetiyoruz (StorageController ile aynı). Auth token ile sağlanıyor.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.status(200).end(body);
  }
}
