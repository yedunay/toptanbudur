import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class InvoiceLinkDto {
  @IsString()
  faturaUrl!: string;

  @IsInt()
  @Min(1)
  orderId!: number;

  @IsOptional()
  @IsString()
  faturaTarihi?: string;

  @IsOptional()
  @IsString()
  faturaNo?: string;
}
