import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

const ORDER_STATUSES = [
  'paid',
  'preparing',
  'shipped',
  'cancelled',
  'refunded',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

// Admin panelinden atanabilen satış kanalı. 'self' ("Kendim İçin") BİLEREK
// yok — self siparişi bayi kendisi oluşturur, admin elle self'e çeviremez
// (mevcut kural aynen korundu).
const ORDER_MARKETPLACES = ['other'] as const;

export type OrderMarketplace = (typeof ORDER_MARKETPLACES)[number];

/**
 * Admin/tedarikçi panelinden sipariş alanlarını güncellerken kullanılan DTO.
 *
 * `null` gönderilen alanlar ilgili sütunu temizler (`null` olarak kaydedilir);
 * tanımsız bırakılan alanlar dokunulmaz.
 */
export class UpdateOrderDto {
  @IsOptional()
  @IsIn(ORDER_STATUSES)
  status?: OrderStatus;

  /**
   * Riskli statü geçişini (iptal/iade'den "diriltme" veya depodan gönderilmiş
   * siparişi 'paid'e geri çekme) admin onay popup'ında onaylayınca FE true
   * gönderir. Bu bayrak olmadan backend riskli geçişi 409 ile reddeder; true
   * ise geçişe izin verilir (stok/cari OTOMATİK düzeltilmez — popup uyarır).
   */
  @IsOptional()
  @IsBoolean()
  confirmReactivation?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  trackingNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsIn(ORDER_MARKETPLACES)
  marketplace?: OrderMarketplace | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(60)
  cargoCompany?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(120)
  cargoBarcode?: string | null;

  /**
   * Müşteri ismi — Bayi'nin kendi son müşterisinin adı. Serbest metin
   * (boşluk + Türkçe karakter içerebilir). `null` gönderilirse temizlenir.
   */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(200)
  endCustomerName?: string | null;

  /**
   * Müşteriye status değişim mail'i gönderilsin mi? Varsayılan true.
   * Admin checkbox'ı ile false yapabilir (sessiz güncelleme).
   */
  @IsOptional()
  @IsBoolean()
  notify?: boolean;
}
