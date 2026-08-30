import { ApiProperty } from '@nestjs/swagger';

export class LedgerBalanceResponseDto {
  @ApiProperty({ format: 'uuid' })
  walletId!: string;

  @ApiProperty({ format: 'uuid' })
  ledgerAccountId!: string;

  @ApiProperty({ example: '25.00000000' })
  available!: string;

  @ApiProperty({ example: 'USD' })
  currency!: string;

  @ApiProperty({ example: '1' })
  version!: string;
}

export class LedgerEntryResponseDto {
  @ApiProperty({ format: 'uuid' })
  ledgerAccountId!: string;

  @ApiProperty({ enum: ['DEBIT', 'CREDIT'] })
  direction!: string;

  @ApiProperty({ example: '25.00000000' })
  amount!: string;

  @ApiProperty({ example: 'USD' })
  currency!: string;
}

export class LedgerPostingResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  externalReference!: string;

  @ApiProperty({ enum: ['POSTED'] })
  status!: string;

  @ApiProperty({ enum: ['TRANSFER', 'FX_TRANSFER', 'FEE', 'REVERSAL', 'FUNDING'] })
  postingType!: string;

  @ApiProperty({ type: LedgerEntryResponseDto, isArray: true })
  entries!: LedgerEntryResponseDto[];
}
