import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, Matches } from 'class-validator';

export class CreateTransferDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  senderWalletId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  recipientWalletId!: string;

  @ApiProperty({ example: '100.00000000' })
  @Matches(/^(?:0|[1-9]\d{0,19})\.\d{1,8}$/)
  amount!: string;

  @ApiProperty({ example: 'USD', pattern: '^[A-Z]{3}$' })
  @Matches(/^[A-Z]{3}$/)
  currency!: string;
}
