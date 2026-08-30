import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsString,
  IsUUID,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';

export class PayrollItemInputDto {
  @ApiProperty({ example: 'employee-001-2026-08' })
  @IsString()
  @Length(1, 128)
  externalItemId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  recipientWalletId!: string;

  @ApiProperty({ example: '2500.00000000' })
  @Matches(/^(?:0|[1-9]\d{0,19})\.\d{1,8}$/)
  amount!: string;
}

export class CreatePayrollJobDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  sourceWalletId!: string;

  @ApiProperty({ example: 'USD', pattern: '^[A-Z]{3}$' })
  @Matches(/^[A-Z]{3}$/)
  currency!: string;

  @ApiProperty({ type: PayrollItemInputDto, isArray: true, maxItems: 15000 })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PayrollItemInputDto)
  items!: PayrollItemInputDto[];
}
