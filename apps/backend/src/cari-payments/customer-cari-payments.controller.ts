import {
  Body,
  Controller,
  GoneException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  CustomerJwtGuard,
  type RequestWithCustomer,
} from '../customer-auth/customer-jwt.guard';
import { CariPaymentsService } from './cari-payments.service';
import { CariRequestDto } from './dto/cari-request.dto';

@UseGuards(CustomerJwtGuard)
@Controller('customer/orders')
export class CustomerCariPaymentsController {
  constructor(private readonly service: CariPaymentsService) {}

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':orderId/cari-payment')
  request(
    @Param('orderId') _orderId: string,
    @Body() _dto: CariRequestDto,
    @Req() _req: RequestWithCustomer,
  ) {
    // §2.1 — VADELİ (açık-hesap) AKIŞI KALDIRILDI (2026-06-24 kararı).
    // Vadeli sipariş onayı cariBalance/CariLedger'a hiç yazmadığı için
    // mutabakatta ve Cari Hareketler'de görünmüyor, ama "Toplam Sipariş"te
    // görünüyordu → açıklanamayan iş hacmi farkı. Artık her sipariş cari
    // bakiyeden veya kart ile ödenir. Yeni vadeli talep AÇILAMAZ (410 Gone).
    // (Servisteki requestForOrder gövdesi geriye dönük kalır ama çağrılmaz;
    // admin tarafı `decide` mevcut PENDING talepleri reddedebilmek için durur.)
    throw new GoneException(
      'Vadeli (açık hesap) ödeme akışı kullanımdan kaldırıldı. Lütfen cari bakiye veya kart ile ödeyin.',
    );
  }
}
