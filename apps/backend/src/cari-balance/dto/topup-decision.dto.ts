import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class TopupDecisionDto {
  @IsIn(['approved', 'rejected'])
  decision!: 'approved' | 'rejected';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  adminNote?: string;
}
