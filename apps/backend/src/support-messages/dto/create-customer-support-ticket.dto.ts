import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Müşteri panelinden gelen destek talebi DTO'su.
 *
 * `name` ve `email` alanları YOKTUR — controller bu değerleri JWT cookie'den
 * alınan müşteri kimliği üzerinden DB'den (Customer.name / Customer.email)
 * doldurur. Public iletişim formu (`/api/forms/contact`) hâlâ
 * `CreateSupportMessageDto`'yu kullanır; iki uç noktanın aynı DTO'yu
 * paylaşması durumunda public-form @IsEmail/@MinLength kuralları,
 * authenticated müşteri akışını da gereksiz yere reddediyordu (#bug:
 * müşteri panelinden talep açarken 400 dönüyordu çünkü frontend dummy
 * "x"/"x@x.x" gönderiyordu).
 */
export class CreateCustomerSupportTicketDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(8000)
  body!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  orderId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  orderNumber?: string;

  @IsOptional()
  @IsIn(['order', 'general'])
  kind?: 'order' | 'general';

  @IsOptional()
  @IsString()
  // UI artık yalnız kargo/iptal/iade/diger sunuyor (2026-08-01). Eski değerler
  // açık sekmelerden gelebilecek istekler 400 yemesin diye kabulde kalıyor.
  @IsIn(['kargo', 'iptal', 'iade', 'diger', 'siparis', 'fatura', 'teknik', 'odeme', 'urun', 'hesap'])
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  marketplace?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  carrier?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  trackingCode?: string;
}
