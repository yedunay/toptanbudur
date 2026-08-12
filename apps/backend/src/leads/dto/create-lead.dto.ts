import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { IsTrPhone } from '../../common/decorators/is-tr-phone.decorator';

export class CreateLeadDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  ad!: string;

  @IsTrPhone()
  telefon!: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  eposta?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  mesaj?: string;
}
