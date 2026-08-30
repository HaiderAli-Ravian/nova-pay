import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/;

export class AppendAuditEventDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() eventId!: string;
  @ApiProperty({ example: 'transfer:9a459c61-392e-453f-a08d-3d684e6be503' })
  @IsString() @MaxLength(160) @Matches(SAFE_IDENTIFIER) streamKey!: string;
  @ApiProperty({ example: 'transfer.completed' })
  @IsString() @MaxLength(100) @Matches(SAFE_IDENTIFIER) action!: string;
  @ApiProperty({ example: 'transfer' })
  @IsString() @MaxLength(80) @Matches(SAFE_IDENTIFIER) entityType!: string;
  @ApiProperty() @IsString() @MaxLength(128) @Matches(SAFE_IDENTIFIER) entityId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(128) @Matches(SAFE_IDENTIFIER) actorId?: string;
  @ApiProperty({ format: 'date-time' }) @IsISO8601({ strict: true }) occurredAt!: string;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}

export class VerifyAuditStreamDto {
  @ApiProperty({ example: 'transfer:9a459c61-392e-453f-a08d-3d684e6be503' })
  @IsString() @MaxLength(160) @Matches(SAFE_IDENTIFIER) streamKey!: string;
}
