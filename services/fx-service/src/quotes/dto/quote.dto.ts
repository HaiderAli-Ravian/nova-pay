import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, Matches } from 'class-validator';

const CURRENCY = /^[A-Z]{3}$/;
const MONEY = /^(?:0|[1-9]\d{0,19})\.\d{1,8}$/;

export class CreateQuoteDto {
  @ApiProperty({ example: 'USD' })
  @Matches(CURRENCY)
  sourceCurrency!: string;

  @ApiProperty({ example: 'EUR' })
  @Matches(CURRENCY)
  targetCurrency!: string;

  @ApiProperty({ example: '100.00000000' })
  @Matches(MONEY)
  sourceAmount!: string;
}

export class ConsumeQuoteDto extends CreateQuoteDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  transferId!: string;

  @ApiProperty({ example: 'alice' })
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,99}$/)
  clientId!: string;
}

export class QuoteResponseDto {
  @ApiProperty({ format: 'uuid' }) quoteId!: string;
  @ApiProperty({ example: 'USD' }) sourceCurrency!: string;
  @ApiProperty({ example: 'EUR' }) targetCurrency!: string;
  @ApiProperty({ example: '100.00000000' }) sourceAmount!: string;
  @ApiProperty({ example: '92.00000000' }) targetAmount!: string;
  @ApiProperty({ example: '0.920000000000' }) rate!: string;
  @ApiProperty({ enum: ['ACTIVE', 'CONSUMED', 'EXPIRED'] }) status!: string;
  @ApiProperty({ format: 'date-time' }) issuedAt!: string;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
  @ApiProperty() valid!: boolean;
  @ApiProperty({ example: 41 }) remainingSeconds!: number;
}
