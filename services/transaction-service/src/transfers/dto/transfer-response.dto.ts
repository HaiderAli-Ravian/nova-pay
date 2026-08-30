import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TransferResponseDto {
  @ApiProperty({ format: 'uuid' })
  transferId!: string;

  @ApiProperty({ enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REVERSED'] })
  status!: string;

  @ApiProperty({ example: '100.00000000' })
  sourceAmount!: string;

  @ApiProperty({ example: 'USD' })
  sourceCurrency!: string;

  @ApiProperty({ example: '100.00000000' })
  targetAmount!: string;

  @ApiProperty({ example: 'USD' })
  targetCurrency!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  ledgerTransactionId?: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  completedAt?: string | null;

  @ApiPropertyOptional({ example: '/transfers/9a459c61-392e-453f-a08d-3d684e6be503' })
  statusUrl?: string;

  @ApiPropertyOptional({
    example: { code: 'INSUFFICIENT_FUNDS', message: 'The wallet has insufficient available funds.' },
  })
  failure?: { code: string; message: string };
}

export class HistoryItemDto {
  @ApiProperty({ format: 'uuid' })
  transferId!: string;
  @ApiProperty({ enum: ['OUTGOING', 'INCOMING'] })
  direction!: 'OUTGOING' | 'INCOMING';
  @ApiProperty({ example: '100.00000000' })
  amount!: string;
  @ApiProperty({ example: 'USD' })
  currency!: string;
  @ApiProperty()
  status!: string;
  @ApiProperty({ format: 'date-time' })
  occurredAt!: string;
}

export class HistoryPageDto {
  @ApiProperty({ type: HistoryItemDto, isArray: true })
  items!: HistoryItemDto[];
  @ApiPropertyOptional({ nullable: true })
  nextCursor!: string | null;
}
