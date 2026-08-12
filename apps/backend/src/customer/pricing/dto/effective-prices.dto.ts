import { ArrayMaxSize, ArrayUnique, IsArray, IsString, MaxLength, MinLength } from 'class-validator';

export class EffectivePricesDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  tenantSlug!: string;

  @IsArray()
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsString({ each: true })
  slugs!: string[];
}
