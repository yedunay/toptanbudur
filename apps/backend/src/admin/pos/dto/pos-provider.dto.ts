import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class PosProviderCreateDto {
  /** Makine adı — küçük harf/rakam/tire ('paytr', 'garanti-bbva', 'param'). */
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{1,39}$/, {
    message:
      'key küçük harf, rakam ve tire içerebilir (2-40 karakter, harf/rakam ile başlar)',
  })
  key!: string;

  @IsString()
  @Length(2, 60)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class PosProviderUpdateDto {
  @IsOptional()
  @IsString()
  @Length(2, 60)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  /** true gönderilirse activate ile aynı işi yapar (tek aktif garantisi korunur). */
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  /** GERÇEK komisyon — POS'un bizden kestiği % (kâr hesapları için). */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  commissionRate?: number | null;

  /** SİTE komisyonu — müşteriye yansıtılan % (sepet + cari yükleme bununla). */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  customerCommissionRate?: number | null;

  /** Valör (gün) — tahsilatın hesaba geçme süresi. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  valorDays?: number | null;

  /** Canlı mağazada test işlemi (PayTR test_mode=1). */
  @IsOptional()
  @IsBoolean()
  testMode?: boolean;

  /** Taksit seçenekleri gizlensin (PayTR no_installment=1). */
  @IsOptional()
  @IsBoolean()
  noInstallment?: boolean;

  /** En fazla taksit (0 → yürürlükteki azami). */
  @IsOptional()
  @IsInt()
  @IsIn([0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  maxInstallment?: number;
}

export class PaytrStatusQueryDto {
  /** PayTR'a giden sipariş referansı (merchant_oid) ya da sipariş no. */
  @IsString()
  @Length(2, 64)
  merchantOid!: string;
}

export class ToslaStatusQueryDto {
  /** TOSLA'ya giden sipariş referansı (merchantOid = orderId). */
  @IsString()
  @Length(2, 64)
  merchantOid!: string;
}

export class PosTestPaymentDto {
  /** Test çekim tutarı (TL). 1–1000 arası; varsayılan 1 TL. */
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(1000)
  amount?: number;
}

export class PaytrReportDto {
  /** İşlem dökümü: "YYYY-MM-DD HH:mm:ss" · Ödeme dökümü: "YYYY-MM-DD" */
  @IsString()
  @Length(10, 19)
  startDate!: string;

  @IsString()
  @Length(10, 19)
  endDate!: string;
}
