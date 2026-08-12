import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { MARKETPLACE_VALUES } from '../admin/suppliers/dto/create-supplier.dto';

export const ORDER_CARGO_VALUES = ['ARAS', 'SURAT', 'PTT', 'DHL', 'YURTICI'] as const;
export type OrderCargoCompany = (typeof ORDER_CARGO_VALUES)[number];

export class OrderItemInputDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  productSlug!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(999, { message: 'tek satırda maksimum 999 adet sipariş edilebilir' })
  qty!: number;
}

export class OrderAddressDto {
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  line1!: string;

  // city/postalCode "Kendim İçin" (marketplace='self') siparişlerde gönderilmez
  // — tek serbest-metin adres yalnızca line1'e yazılır. Bu yüzden DTO seviyesinde
  // OPSİYONEL; self-DIŞI siparişlerde zorunluluk orders.service.create()'te
  // tekrar uygulanır (mevcut katı davranış korunur).
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  city?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(20)
  postalCode?: string;

  // İlçe — "Kendim İçin" (self) siparişte Basit Kargo `client.town` alanına
  // gider; self'te zorunluluk orders.service.create()'te uygulanır. self-DIŞI'nda
  // opsiyonel (mevcut akış district göndermez, davranış değişmez).
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  district?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(2)
  country?: string;
}

export class OrderCustomerDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @Matches(/^[+0-9 ()-]{7,20}$/, {
    message: 'telefon 7-20 karakter arasında olmalı ve yalnızca rakam, +, boşluk, () veya - içermelidir',
  })
  phone!: string;

  @ValidateNested()
  @Type(() => OrderAddressDto)
  address!: OrderAddressDto;
}

export class CreateOrderDto {
  @IsString()
  @MinLength(1)
  tenantSlug!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => OrderItemInputDto)
  items!: OrderItemInputDto[];

  @ValidateNested()
  @Type(() => OrderCustomerDto)
  customer!: OrderCustomerDto;

  /**
   * Ödeme yöntemi:
   *   - 'card'         → online kart akışı (varsayılan)
   *   - 'cari_balance' → müşterinin cari bakiyesinden anında düşüm (login zorunlu)
   */
  @IsOptional()
  @IsIn(['card', 'cari_balance'])
  paymentMethod?: 'card' | 'cari_balance';

  /**
   * Kargo şirketi. Kabul edilen değerler: ORDER_CARGO_VALUES
   * (ARAS, SURAT, PTT, DHL, YURTICI). Sepetteki tedarikçilerin
   * `mandatoryCarriers` array'leri intersect edilir ve sonuç boş değilse
   * bu alan o küme içinde olmak zorundadır (ör. bir tedarikçi yalnız YURTICI destekler).
   */
  // "Kendim İçin" (self) siparişlerde kargo şirketi sorulmaz (tedarikçiye
  // gönderim yok). self-DIŞI'nda mevcut katı kural aynen geçerli.
  @ValidateIf((o: CreateOrderDto) => o.marketplace !== 'self')
  @IsString()
  @IsIn(ORDER_CARGO_VALUES)
  cargoCompany?: OrderCargoCompany;

  /**
   * Tedarikçi tarafından imzalı sipariş PDF'inin signed URL'i (7 günlük).
   * Sepetteki herhangi bir ürünün tedarikçisi `requiresPdf=true` ise bu alan
   * zorunludur (boşsa 400). PDF yüklemek için önce `POST /api/orders/upload-pdf`
   * — endpoint hem `pdfUrl` hem kalıcı `key` döner; ikisi de DB'ye yazılır.
   */
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  pdfUrl?: string;

  /**
   * `POST /api/orders/upload-pdf` cevabından dönen kalıcı object key. Admin
   * paneli süresi dolmuş URL yerine bu key'i taze imzalamak için kullanır.
   */
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  pdfKey?: string;

  /**
   * Kargo barkodu (gönderim takip numarası). Zorunlu — bayi tedarikçiye
   * gönderim yaparken kullanır; sadece alfanumerik (- ve _ izinli).
   */
  // "Kendim İçin" (self) siparişlerde kargo barkodu sorulmaz. self-DIŞI'nda
  // mevcut katı kural (4-64, alfanumerik) aynen geçerli.
  @ValidateIf((o: CreateOrderDto) => o.marketplace !== 'self')
  @IsString()
  @MinLength(4)
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'kargo barkodu yalnızca harf, rakam, - veya _ içerebilir',
  })
  cargoBarcode?: string;

  /**
   * Satış kanalı seçimi (zorunlu). Sabit liste (MARKETPLACE_VALUES):
   * 'self' = "Kendim İçin", 'other' = "Diğer Satış Kanalı".
   */
  @IsString()
  @IsIn(MARKETPLACE_VALUES)
  marketplace!: (typeof MARKETPLACE_VALUES)[number];

  /**
   * Müşterinin siparişe eklediği opsiyonel not (maks 200 karakter).
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  orderNote?: string;

  /**
   * Müşteri ismi — Bayi'nin KENDİ son müşterisinin adı. `customer.name`
   * (teslimat/bayi adı) ile karıştırılmaz; her siparişte farklı olabilir.
   * Serbest metin (boşluk + Türkçe karakter içerebilir), maks 200 karakter.
   * Zorunlu alan — sipariş oluştururken boş bırakılamaz.
   */
  // "Kendim İçin" (self) siparişlerde son-müşteri ismi sorulmaz (bayi kendisi
  // için alır). self-DIŞI'nda zorunlu (mevcut davranış korunur).
  @ValidateIf((o: CreateOrderDto) => o.marketplace !== 'self')
  @IsString()
  @MinLength(1, { message: 'Müşteri ismi zorunludur' })
  @MaxLength(200)
  endCustomerName?: string;
}
