import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateCategoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  // Boş/undefined → kök kategori. Verilirse parent aynı tenant'ta olmak
  // zorunda; servis tarafı doğrular.
  @IsOptional()
  @IsString()
  @MaxLength(64)
  parentId?: string;
}

export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;
}
