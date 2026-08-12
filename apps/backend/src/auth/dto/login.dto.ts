import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Admin login DTO.
 *
 * NOTE: `email` accepts either an email address or a plain username (e.g. the
 * seeded "omer" admin). The schema's User.email column is unique String, so a
 * username works as long as the seed populates it.
 */
export class LoginDto {
  @IsString()
  @MinLength(2)
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(128)
  password!: string;
}
