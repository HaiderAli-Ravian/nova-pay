import { ApiProperty } from '@nestjs/swagger';

export class HealthResponseDto {
  @ApiProperty({ example: 'ok', enum: ['ok'] })
  status!: 'ok';

  @ApiProperty({ example: 'ledger-service' })
  service!: string;

  @ApiProperty({ example: '2026-08-29T10:00:00.000Z' })
  timestamp!: string;

  @ApiProperty({ example: 42, minimum: 0 })
  uptimeSeconds!: number;

  @ApiProperty({
    required: false,
    type: Object,
    additionalProperties: { type: 'string', enum: ['up'] },
    example: { database: 'up' },
  })
  dependencies?: Record<string, 'up'>;
}
