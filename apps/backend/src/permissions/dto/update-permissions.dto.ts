import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class PermissionUpdateItem {
  @IsString()
  pageKey!: string;

  /**
   * `true`  → override: zorunlu AÇIK
   * `false` → override: zorunlu KAPALI
   * `null`  → override sil (role default'üne dön)
   */
  @IsOptional()
  @IsBoolean()
  granted!: boolean | null;
}

export class UpdatePermissionsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(64)
  @ValidateNested({ each: true })
  @Type(() => PermissionUpdateItem)
  updates!: PermissionUpdateItem[];
}
