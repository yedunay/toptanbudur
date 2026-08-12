import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { IsTrPhone } from '../../common/decorators/is-tr-phone.decorator';

export class DealerApplyDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsTrPhone()
  phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  company?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;

  // Vergi numarası — onayda Customer.vergiNo'ya kopyalanır.
  @IsOptional()
  @IsString()
  @MaxLength(20)
  vergiNo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  package?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  hasIntegration?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  integrationSoftware?: string;

  // Vergi dairesi başvurularda zorunlu — onay sırasında Customer'a kopyalanır.
  // TODO: schema migration once existing DealerApplication rows backfilled
  // (current column nullable for safe rollout).
  @IsString({ message: 'Vergi dairesi zorunludur.' })
  @IsNotEmpty({ message: 'Vergi dairesi zorunludur.' })
  @MaxLength(200)
  vergiDairesi!: string;
}
