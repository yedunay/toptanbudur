import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

const ALLOWED_ROLES = ['OWNER', 'ADMIN', 'MEMBER'] as const;
export type AdminUserRole = (typeof ALLOWED_ROLES)[number];

export class CreateUserDto {
  @IsEmail()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(200)
  password!: string;

  @IsEnum(ALLOWED_ROLES)
  role!: AdminUserRole;
}
