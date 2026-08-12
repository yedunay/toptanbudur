import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Admin iade kararı gövdesi. approve → iade adresi (address) zorunlu;
 * reject/finalize → address gerekmez. note her aksiyonda opsiyonel ek mesaj.
 */
export class DecideReturnDto {
  @IsIn(['approve', 'reject', 'finalize'])
  action!: 'approve' | 'reject' | 'finalize';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
