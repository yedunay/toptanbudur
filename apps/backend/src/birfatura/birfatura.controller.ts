import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { BirfaturaService } from './birfatura.service';
import { BirfaturaTokenGuard } from './birfatura-token.guard';
import { OrdersRequestDto } from './dto/orders-request.dto';
import { CargoUpdateDto } from './dto/cargo-update.dto';
import { InvoiceLinkDto } from './dto/invoice-link.dto';

/**
 * BirFatura özel entegrasyon endpoint'leri.
 *
 * Tüm endpoint'ler BirfaturaTokenGuard altında — header `token: <GUID>`.
 *
 * ⚠️ ROUTE ÇAKIŞMASI FIX: Önceden `@Controller()` (boş) idi → route'lar
 * `/api/orders` gibi çıkıyordu ve MÜŞTERİ checkout'u ile ÇAKIŞIYORDU
 * (OrdersController `@Controller('orders')` → `POST /api/orders`). OrdersModule
 * app.module'de önce register edildiğinden BirFatura'nın `/api/orders` isteği
 * checkout handler'ına düşüyor, `CreateOrderDto`'ya takılıp **400** dönüyordu
 * (`orderStatus` tekil olduğu için çalışıyordu, `orders` çakışıyordu).
 *
 * Çözüm: controller'ı `birfatura/api` altında namespace'le → tüm yollar
 * `/api/birfatura/api/*` olur, hiçbir şeyle çakışmaz, müşteri akışı HİÇ
 * etkilenmez.
 *
 * BirFatura paneli → "Web Sitenizin Adresi" buna göre ayarlanmalı:
 *   https://toptanbudur.com/api/birfatura
 * BirFatura bu tabana kendi sabit yollarını ekler → gerçekte çağrılan:
 *   POST /api/birfatura/api/orderStatus/
 *   POST /api/birfatura/api/paymentMethods/
 *   POST /api/birfatura/api/orders/
 *   POST /api/birfatura/api/orderCargoUpdate/
 *   POST /api/birfatura/api/invoiceLinkUpdate/
 *
 * Throttle: 60 req/dk (spec 5-15 dk poll önerir; geniş margin).
 */
@UseGuards(BirfaturaTokenGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('birfatura/api')
export class BirfaturaController {
  constructor(private readonly service: BirfaturaService) {}

  @Post('orderStatus')
  orderStatus() {
    return { OrderStatus: this.service.statusDictionary() };
  }

  @Post('paymentMethods')
  paymentMethods() {
    return { PaymentMethods: this.service.paymentDictionary() };
  }

  @Post('orders')
  orders(@Body() dto: OrdersRequestDto) {
    return this.service.fetchOrders(dto);
  }

  @Post('orderCargoUpdate')
  orderCargoUpdate(@Body() dto: CargoUpdateDto) {
    return this.service.applyCargoUpdate(dto);
  }

  @Post('invoiceLinkUpdate')
  invoiceLinkUpdate(@Body() dto: InvoiceLinkDto) {
    return this.service.applyInvoiceLink(dto);
  }
}
