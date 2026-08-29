import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ErrorResponseDto {
  @ApiProperty({ example: 'NOT_FOUND' })
  code!: string;

  @ApiProperty({ example: 'Resource not found.' })
  message!: string;

  @ApiProperty({ example: '4e0043d7-9306-4e15-9469-2ab8344aa5f1' })
  requestId!: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    example: { violations: ['name must be a string'] },
  })
  details?: Record<string, unknown>;
}

