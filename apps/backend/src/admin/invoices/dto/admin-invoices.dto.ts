import {
  IsBoolean,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

/**
 * Faz 7 admin fatura DTO'ları (birfatura.md §9).
 *
 * Global ValidationPipe `whitelist: true, forbidNonWhitelisted: true` ile çalışır;
 * DTO'da tanımlı OLMAYAN her alan reddedilir. Bu yüzden tüm istek alanları burada.
 */

/** Tekli (customerId verili) veya toplu (customerId yok) kesim tetiği. */
export class FreezeInvoicesDto {
  /** Sadece bu bayiyi kes; yoksa tüm uygun bayiler (25'i toplu). */
  @IsOptional()
  @IsString()
  customerId?: string;

  /**
   * Kesim anı (cutoff) — ISO / YYYY-MM-DD tarih. Yoksa "şimdi".
   * Uygunluk üst sınırı `shippedAt <= asOf` ve `periodEnd` buradan türetilir
   * (önizlemedeki `asOf` ile birebir aynı semantik). Alt tarih sınırı YOKTUR.
   */
  @IsOptional()
  @IsString()
  asOf?: string;
}

/** Önizleme tetiği — DB'ye hiçbir şey yazmaz. */
export class PreviewInvoicesDto {
  /** Sadece bu bayi (tekli önizleme); yoksa tüm uygun bayiler. */
  @IsOptional()
  @IsString()
  customerId?: string;

  /** Önizleme anı (cutoff) — ISO tarih. Yoksa "şimdi". */
  @IsOptional()
  @IsString()
  asOf?: string;
}

/**
 * Fatura ayarları (kısmi güncelleme). Verilen alanlar tek tek AppSetting'e yazılır;
 * her biri AppSettingsService içinde tip/min/max'a karşı ayrıca doğrulanır.
 */
export class UpdateInvoiceSettingsDto {
  /** `birfatura.consolidationCutoffDay` — ayın kaçında kesim donar (her ay güvenli: 1..28). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  cutoffDay?: number;

  /** `pricing.packagingUnitFee` — "Kargo Bedeli" birim ücreti (KDV dahil), decimal string. */
  @IsOptional()
  @IsNumberString()
  packagingUnitFee?: string;

  /** `birfatura.consolidationEnabled` — otomatik (cron) konsolidasyon açık mı. */
  @IsOptional()
  @IsBoolean()
  consolidationEnabled?: boolean;

  /** `birfatura.ordersEnabled` — BirFatura'ya canlı sipariş push kill-switch'i. */
  @IsOptional()
  @IsBoolean()
  ordersEnabled?: boolean;
}
