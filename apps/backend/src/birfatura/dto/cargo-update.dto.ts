import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CargoUpdateDto {
  @IsInt()
  @Min(1)
  orderId!: number;

  @IsInt()
  @Min(1)
  orderStatusId!: number;

  @IsString()
  cargoTrackingCode!: string;

  @IsOptional()
  @IsString()
  updateDateTime?: string;

  @IsOptional()
  @IsString()
  cargoTrackingCodeUrl?: string;

  @IsOptional()
  @IsString()
  cargoCompany?: string;
}
