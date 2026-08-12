import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginCustomerDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;
}
