import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class WalletBalanceDto {
  @ApiProperty({ example: '0.00000000' })
  available!: string;

  @ApiProperty({ example: 'USD' })
  currency!: string;

  @ApiProperty({ example: '0' })
  version!: string;
}

export class WalletResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'USD' })
  currency!: string;

  @ApiPropertyOptional({ example: 'Everyday spending', nullable: true })
  label!: string | null;

  @ApiProperty({ enum: ['PENDING', 'ACTIVE', 'FROZEN', 'CLOSED'] })
  status!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  ledgerAccountId!: string | null;

  @ApiProperty({ type: WalletBalanceDto, nullable: true })
  balance!: WalletBalanceDto | null;
}
