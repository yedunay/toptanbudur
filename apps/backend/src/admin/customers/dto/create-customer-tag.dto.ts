import { IsHexColor, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Yeni müşteri etiketi (YALNIZ ADMIN) — ad + hex renk. */
export class CreateCustomerTagDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  name!: string;

  /** "#RRGGBB" / "#RGB" — class-validator IsHexColor doğrular. */
  @IsString()
  @IsHexColor()
  color!: string;
}

/** Etiket güncelleme — ad ve/veya renk. */
export class UpdateCustomerTagDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  name?: string;

  @IsOptional()
  @IsString()
  @IsHexColor()
  color?: string;
}
