import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

// "YYYY-MM" ay anahtarı doğrulaması (gün YOK — panel ay bazlı çalışır).
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Manuel gelir/gider satırı — oluştur. */
export class CreateIntegrationEntryDto {
  // ISO tarih ("2026-07-15" veya tam ISO). month sunucuda türetilir.
  @IsString()
  entryDate!: string;

  @IsIn(['INCOME', 'EXPENSE'])
  type!: 'INCOME' | 'EXPENSE';

  @IsString()
  @MaxLength(300)
  description!: string;

  @IsNumber()
  @Min(0)
  amount!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  kdvRate?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;
}

export class UpdateIntegrationEntryDto {
  @IsOptional()
  @IsString()
  entryDate?: string;

  @IsOptional()
  @IsIn(['INCOME', 'EXPENSE'])
  type?: 'INCOME' | 'EXPENSE';

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  kdvRate?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;
}

/** Aya özel (tek seferlik) gider — oluştur. */
export class CreateExpenseDto {
  @Matches(MONTH_RE, { message: 'month "YYYY-MM" olmalı' })
  month!: string;

  @IsString()
  @MaxLength(100)
  category!: string;

  @IsString()
  @MaxLength(300)
  description!: string;

  @IsNumber()
  @Min(0)
  amount!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  kdvRate?: number;

  @IsOptional()
  @IsIn(['PAID', 'UNPAID'])
  status?: 'PAID' | 'UNPAID';

  @IsOptional()
  @IsString()
  paidByPartnerId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** Aya düşen gider satırını (tek seferlik VEYA materyalize sürekli) güncelle. */
export class UpdateExpenseDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  kdvRate?: number;

  @IsOptional()
  @IsIn(['PAID', 'UNPAID'])
  status?: 'PAID' | 'UNPAID';

  @IsOptional()
  @IsString()
  paidByPartnerId?: string | null;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** Sürekli gider tanımı (template) — oluştur. */
export class CreateExpenseTemplateDto {
  @IsString()
  @MaxLength(100)
  category!: string;

  @IsString()
  @MaxLength(300)
  description!: string;

  @IsNumber()
  @Min(0)
  amount!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  kdvRate?: number;

  @IsOptional()
  @IsString()
  paidByPartnerId?: string | null;

  @Matches(MONTH_RE, { message: 'startMonth "YYYY-MM" olmalı' })
  startMonth!: string;

  @IsOptional()
  @Matches(MONTH_RE, { message: 'endMonth "YYYY-MM" olmalı' })
  endMonth?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateExpenseTemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  kdvRate?: number;

  @IsOptional()
  @IsString()
  paidByPartnerId?: string | null;

  @IsOptional()
  @Matches(MONTH_RE, { message: 'startMonth "YYYY-MM" olmalı' })
  startMonth?: string;

  @IsOptional()
  @Matches(MONTH_RE, { message: 'endMonth "YYYY-MM" olmalı' })
  endMonth?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** Kâr Avansı — ortağın işletmeden çektiği para (oluştur). */
export class CreatePartnerAdvanceDto {
  @IsString()
  partnerId!: string;

  // ISO tarih ("2026-06-30" veya tam ISO). month sunucuda TR takvimiyle türetilir.
  @IsString()
  advanceDate!: string;

  // KDV'li (fiziksel çekilen nakit) — KDV'li bakiyeden düşülür.
  @IsNumber()
  @Min(0)
  grossAmount!: number;

  // Net bakiyeden düşülecek tutar (varsayılan grossAmount ÷ 1,20).
  @IsNumber()
  @Min(0)
  netAmount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;
}

export class UpdatePartnerAdvanceDto {
  @IsOptional()
  @IsString()
  partnerId?: string;

  @IsOptional()
  @IsString()
  advanceDate?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  grossAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  netAmount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;
}

/** Ortak güncelle (pay yüzdesi vb.). */
export class UpdatePartnerDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4)
  initials?: string;

  @IsOptional()
  @IsString()
  @MaxLength(9)
  colorHex?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  sharePercent?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
