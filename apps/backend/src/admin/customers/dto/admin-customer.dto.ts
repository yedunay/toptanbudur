import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

/**
 * Tüm admin-customers PATCH/POST gövdeleri global `ValidationPipe`
 * (`whitelist: true, forbidNonWhitelisted: true`) ile bu DTO'lardan geçer.
 * Buradaki `MinLength(8)` + harf/rakam zorunluluğu, müşteri tarafındaki
 * `customer-auth.service.ts` kuralları ile aynı kasada tutulmak için.
 */

export class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  @Matches(/^[+0-9 ()-]{7,20}$/, {
    message:
      'telefon 7-20 karakter arasında olmalı ve yalnızca rakam, +, boşluk, () veya - içermelidir',
  })
  phone?: string | null;

  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  @MaxLength(120)
  vergiDairesi?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @Matches(/^\d{10}$/, { message: 'Vergi no 10 haneli rakam olmalı.' })
  vergiNo?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @Matches(/^\d{11}$/, { message: 'TC kimlik 11 haneli rakam olmalı.' })
  tcKimlik?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(200)
  companyTitle?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(50)
  mersisNumber?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(500)
  companyAddress?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(200)
  contactName?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @Matches(/^[+0-9 ()-]{7,20}$/, { message: 'iletişim telefonu geçersiz' })
  contactPhone?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsEmail()
  @MaxLength(254)
  contactEmail?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(50)
  discountPercent?: number;

  // Global "Kâr İndirimi" (kardan indirim) — indirim ürünün kârından yapılır,
  // maliyetin altına inmez. 0-100; %100 ⇒ maliyet + paketleme. >0 iken legacy
  // discountPercent (off-list) yok sayılır.
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  profitDiscountPercent?: number;

  // Admin İndirimi statüsü — `ADMIN_DISCOUNT` seçildiğinde tüm ürünler
  // maliyet (costPrice) fiyatından satılır; mevcut discountPercent /
  // supplierDiscounts geçici olarak bypass edilir. Paketleme yine uygulanır.
  @IsOptional()
  @IsIn(['STANDARD', 'ADMIN_DISCOUNT'])
  customerStatus?: 'STANDARD' | 'ADMIN_DISCOUNT';

  // Fatura kesimi toggle'ı (birfatura.md §9) — KAPALI ise bu bayinin siparişleri
  // konsolide kesime (freeze) HİÇ girmez. Varsayılan AÇIK (schema default true).
  @IsOptional()
  @IsBoolean()
  invoicingEnabled?: boolean;
}

export class UpdateDiscountDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(50)
  discountPercent!: number;
}

export class SetCustomerPasswordDto {
  @IsString()
  @MinLength(8, { message: 'şifre en az 8 karakter olmalı' })
  @MaxLength(128)
  @Matches(/[A-Za-z]/, { message: 'şifre en az bir harf içermeli' })
  @Matches(/[0-9]/, { message: 'şifre en az bir rakam içermeli' })
  password!: string;
}

/**
 * Admin manuel cari bakiye düzeltmesi. `newBalance` yeni MUTLAK bakiye
 * değeridir (delta değil) — backend aradaki farkı hesaplayıp ADJUSTMENT
 * ledger kaydı yazar. Negatif değerler borç bakiyesi için kabul edilir.
 */
export class AdjustCustomerBalanceDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(-1_000_000)
  @Max(10_000_000)
  newBalance!: number;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  reason?: string;
}

/**
 * Admin HEDİYE BAKİYE tanımlaması. `amount` müşterinin cari bakiyesine
 * EKLENECEK pozitif hediye tutarıdır (mutlak bakiye değil). Backend
 * isGift+isPromo işaretli ADJUSTMENT ledger kaydı yazar ve müşteriye hediye
 * e-postası gönderir. `note` mailde ve harekette gösterilecek opsiyonel mesaj.
 */
export class GiftCustomerBalanceDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(1_000_000)
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  note?: string;
}

/**
 * Toplu müşteri operasyonu — action 'activate' | 'deactivate'.
 * Maks 200 id; her id ayrı geçerlilik kontrolünden geçer.
 */
export class BulkCustomerActionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  ids!: string[];

  @IsIn(['activate', 'deactivate'])
  action!: 'activate' | 'deactivate';
}

/**
 * Tatil modu toggle — admin tarafından bir müşteriyi tatil moduna alır/çıkarır.
 */
export class SetVacationModeDto {
  @IsBoolean()
  enabled!: boolean;
}

export class CreateTestCustomerDto {
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(128)
  password?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name?: string;
}

/** Müşterinin MANUEL etiketlerini verilen sete eşitler (set-all). */
export class SetCustomerTagsDto {
  @IsArray()
  @IsString({ each: true })
  tagIds!: string[];
}
