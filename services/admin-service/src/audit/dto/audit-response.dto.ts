import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AuditRecordResponseDto {
  @ApiProperty({ format: 'uuid' }) eventId!: string;
  @ApiProperty() streamKey!: string;
  @ApiProperty({ example: '1' }) sequence!: string;
  @ApiProperty() action!: string;
  @ApiProperty() entityType!: string;
  @ApiProperty() entityId!: string;
  @ApiPropertyOptional({ nullable: true }) actorId!: string | null;
  @ApiProperty({ format: 'date-time' }) occurredAt!: string;
  @ApiProperty({ type: 'object', additionalProperties: true }) metadata!: Record<string, unknown>;
  @ApiProperty() previousHash!: string;
  @ApiProperty() currentHash!: string;
}

export class AuditVerificationResponseDto {
  @ApiProperty() streamKey!: string;
  @ApiProperty() valid!: boolean;
  @ApiProperty() recordsChecked!: number;
  @ApiPropertyOptional({ nullable: true, example: '3' }) firstInvalidSequence!: string | null;
}
