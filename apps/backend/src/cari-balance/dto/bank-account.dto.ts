import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class BankAccountUpsertDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  bankName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  accountName!: string;

  @IsString()
  @MinLength(15)
  @MaxLength(34)
  iban!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  branchCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  accountNo?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  position?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class BankAccountUpdateDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  bankName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  accountName?: string;

  @IsOptional()
  @IsString()
  @MinLength(15)
  @MaxLength(34)
  iban?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  branchCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  accountNo?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  position?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
