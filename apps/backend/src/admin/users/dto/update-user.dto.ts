import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

const ALLOWED_ROLES = ['OWNER', 'ADMIN', 'MEMBER'] as const;
export type AdminUserRole = (typeof ALLOWED_ROLES)[number];

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsEnum(ALLOWED_ROLES)
  role?: AdminUserRole;

  @IsOptional()
  @IsString()
  @MinLength(12)
  @MaxLength(200)
  password?: string;

  // Sadece OTP_MODE=optional iken anlamlı; aksi halde service 409 atar.
  @IsOptional()
  @IsBoolean()
  otpEnabled?: boolean;
}
