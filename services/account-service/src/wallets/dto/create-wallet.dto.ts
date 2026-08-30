import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

export class CreateWalletDto {
  @ApiProperty({ example: 'USD', pattern: '^[A-Z]{3}$' })
  @Matches(/^[A-Z]{3}$/)
  currency!: string;

  @ApiPropertyOptional({ example: 'Everyday spending', maxLength: 80 })
  @IsOptional()
  @IsString()
  @Length(1, 80)
  @MaxLength(80)
  label?: string;
}
