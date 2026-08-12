import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { MARKETPLACE_VALUES } from '../../suppliers/dto/create-supplier.dto';

// Admin liste filtresinin kabul ettiği statüler. awaiting_payment bilinçli
// olarak HARİÇ — iç kart-ödeme ara durumu, admin listesinde gösterilmez
// (service zaten { not: 'awaiting_payment' } uygular). Geçersiz status değeri
// 500 yerine 400 döner.
const QUERYABLE_ORDER_STATUSES = [
  'paid',
  'preparing',
  'shipped',
  'cancelled',
  'refunded',
] as const;

export class AdminOrderQueryDto {
  // Universal serbest metin arama: humanOrderNo, cargoBarcode, customerName,
  // customerEmail ve OrderItem.product (externalCode/barcode/publicBarcode).
  // Tek input — UI tarafında tek arama kutusu kullanır.
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsIn(QUERYABLE_ORDER_STATUSES)
  status?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  // Frontend bazı sayfalarda `customer` adıyla gönderiyor (id veya serbest metin).
  // forbidNonWhitelisted patlamasın diye whitelist'e ekledik; service `q`/`customerId`
  // dışında bu alanı kullanmıyor.
  @IsOptional()
  @IsString()
  customer?: string;

  // Pazaryerine göre filtre — Order.marketplace exact eşleşme. Kanonik lowercase
  // değerlerden biri (self/other). Geçersiz değer 400 döner.
  @IsOptional()
  @IsIn(MARKETPLACE_VALUES)
  marketplace?: string;

  // Tedarikçiye göre filtre — OrderItem -> Product.supplierId ile some filter.
  @IsOptional()
  @IsString()
  supplierId?: string;

  // Çoklu tedarikçi seçimi (admin liste multi-select). Virgülle ayrılmış ID
  // listesi. Tanımlı ama BOŞ string = "hiçbiri seçili değil" → hiçbir sipariş
  // dönmez. Hiç gönderilmezse (undefined) tedarikçi filtresi uygulanmaz =
  // "tümü". `supplierIds` verildiğinde `supplierId` (tekil) yok sayılır.
  @IsOptional()
  @IsString()
  supplierIds?: string;

  // Sözde-durum filtresi (gerçek OrderStatus DEĞİL, durum filtresinden bağımsız):
  //  - 'manual_pending' = ödenmiş ama tedarikçiden henüz alınmamış
  @IsOptional()
  @IsIn(['manual_pending'])
  special?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}
