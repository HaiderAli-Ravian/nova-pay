import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsUUID,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const CURRENCY = /^[A-Z]{3}$/;
const MONEY = /^(?:0|[1-9]\d{0,19})\.\d{1,8}$/;
const RATE = /^(?:0|[1-9]\d{0,19})\.\d{1,12}$/;

export class ProvisionLedgerAccountDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  walletId!: string;

  @ApiProperty({ example: 'USD' })
  @Matches(CURRENCY)
  currency!: string;
}

export class BalanceQueryDto {
  @ApiProperty({ type: String, isArray: true, maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID(undefined, { each: true })
  walletIds!: string[];
}

export enum PostingDirectionDto {
  DEBIT = 'DEBIT',
  CREDIT = 'CREDIT',
}

export class PostingEntryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  walletId!: string;

  @ApiProperty({ enum: PostingDirectionDto })
  @IsEnum(PostingDirectionDto)
  direction!: PostingDirectionDto;

  @ApiProperty({ example: '25.00000000' })
  @Matches(MONEY)
  amount!: string;

  @ApiProperty({ example: 'USD' })
  @Matches(CURRENCY)
  currency!: string;
}

export enum PostingTypeDto {
  TRANSFER = 'TRANSFER',
  FX_TRANSFER = 'FX_TRANSFER',
  FEE = 'FEE',
}

export class CreatePostingDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  externalReference!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  requestId!: string;

  @ApiProperty({ enum: PostingTypeDto })
  @IsEnum(PostingTypeDto)
  postingType!: PostingTypeDto;

  @ApiProperty({ example: 'USD' })
  @Matches(CURRENCY)
  sourceCurrency!: string;

  @ApiProperty({ example: 'USD' })
  @Matches(CURRENCY)
  targetCurrency!: string;

  @ApiProperty({ example: '25.00000000' })
  @Matches(MONEY)
  sourceAmount!: string;

  @ApiProperty({ example: '25.00000000' })
  @Matches(MONEY)
  targetAmount!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  fxQuoteId?: string;

  @ApiPropertyOptional({ example: '1.250000000000' })
  @IsOptional()
  @Matches(RATE)
  lockedFxRate?: string;

  @ApiProperty({ type: PostingEntryDto, isArray: true, minItems: 2, maxItems: 8 })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => PostingEntryDto)
  entries!: PostingEntryDto[];
}

export class ReversePostingDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  externalReference!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  requestId!: string;
}

export class FundWalletDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  externalReference!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  requestId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  walletId!: string;

  @ApiProperty({ example: '100.00000000' })
  @Matches(MONEY)
  amount!: string;

  @ApiProperty({ example: 'USD' })
  @Matches(CURRENCY)
  currency!: string;
}
