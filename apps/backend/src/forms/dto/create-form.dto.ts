import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { FormType } from '@prisma/client';
import { IsTrPhone } from '../../common/decorators/is-tr-phone.decorator';

// Bayilik başvurusu (type=APPLICATION) sırasında 3 sözleşmenin de tikli olması
// zorunludur. Service tarafında ayrıca all-three guard yapılır (BadRequest);
// burada şekil/tip doğrulaması yapılır.
export class ContractsAcceptedDto {
  @IsBoolean()
  dealership!: boolean;

  @IsBoolean()
  privacy!: boolean;

  @IsBoolean()
  distance!: boolean;
}

export class CreateFormDto {
  @IsEnum(FormType)
  type!: FormType;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  // BeniAra / CALLBACK formunda kullanıcı email girmeden de gönderebilsin.
  // Geri arama için zorunlu değil, iletişim için var.
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  // Esnek validation: parantez/boşluk/tire kabul, +90 normalizasyonu service
  // tarafında uygulanır (forms.service.ts -> normalizeTrPhone).
  @IsTrPhone()
  phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string;

  // CALLBACK tipi formlarında kullanıcı uzun mesaj yazmak zorunda olmasın diye
  // alt sınır 0 — service tarafı boşluğu dolduracak (örn. "Geri arama talebi").
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  message?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  integrationSoftware?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  hasIntegration?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  package?: string;

  // Firma adı — bayilik başvurusunda alınır. Artık message'a birleştirilmez;
  // Form.company kolonuna yapısal yazılır, onayda Customer.companyTitle'a eşlenir.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  company?: string;

  // Vergi numarası — bayilik başvurusunda alınır. Form.vergiNo kolonuna yapısal
  // yazılır, onayda Customer.vergiNo'ya eşlenir.
  @IsOptional()
  @IsString()
  @MaxLength(20)
  vergiNo?: string;

  // Bayilik başvurularında (type=APPLICATION) vergi dairesi zorunlu.
  // CONTACT/CALLBACK formlarında alan kullanılmaz, gönderilmez.
  // INTEGRATION (entegrasyon başvurusu) tarafında zorunluluk client'ta
  // uygulanır; burada APPLICATION dışında doğrulama atlanır (gönderilirse
  // yine yapısal kolona yazılır).
  // Artık Form.vergiDairesi kolonuna yapısal yazılır (message'a katlanmaz).
  @ValidateIf((o: CreateFormDto) => o.type === FormType.APPLICATION)
  @IsString({ message: 'Vergi dairesi zorunludur.' })
  @IsNotEmpty({ message: 'Vergi dairesi zorunludur.' })
  @MaxLength(200)
  vergiDairesi?: string;

  // Sözleşme onayları — yalnızca APPLICATION (bayilik başvurusu) için zorunlu;
  // CONTACT/CALLBACK/INTEGRATION'da gönderilmez ve doğrulanmaz. Şekil burada
  // doğrulanır, "üçü de true" guard'ı service tarafında atılır (kullanıcı yalnız
  // bir kısmını işaretleyemez). NOT: Entegrasyon başvurusu (INTEGRATION) bayilik
  // sözleşmesi imzalamaz — bu yüzden burada zorunlu DEĞİLDİR.
  @ValidateIf((o: CreateFormDto) => o.type === FormType.APPLICATION)
  @IsObject()
  @ValidateNested()
  @Type(() => ContractsAcceptedDto)
  contractsAccepted?: ContractsAcceptedDto;

  // ---- Reklam atıf alanları (Google Ads URL son eki + gclid) ----
  // Tamamı opsiyonel ve istemci kontrollü: sıkı MaxLength şart. Landing
  // 250'ye kırpar (lib/attribution.ts); burada da aynı sınır doğrulanır.
  // forbidNonWhitelisted:true olduğundan bu alanlar DTO'da tanımlı OLMADAN
  // landing'e eklenirse tüm form 400 alır — deploy sırası: önce backend.
  @IsOptional()
  @IsString()
  @MaxLength(250)
  utmSource?: string;

  @IsOptional()
  @IsString()
  @MaxLength(250)
  utmMedium?: string;

  @IsOptional()
  @IsString()
  @MaxLength(250)
  utmCampaign?: string;

  @IsOptional()
  @IsString()
  @MaxLength(250)
  utmTerm?: string;

  @IsOptional()
  @IsString()
  @MaxLength(250)
  utmContent?: string;

  @IsOptional()
  @IsString()
  @MaxLength(250)
  gclid?: string;

  @IsOptional()
  @IsString()
  @MaxLength(250)
  referrer?: string;

  @IsOptional()
  @IsString()
  @MaxLength(250)
  landingPage?: string;
}
