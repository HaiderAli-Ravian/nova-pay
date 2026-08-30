import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PayrollFailureSummaryDto {
  @ApiProperty() externalItemId!: string;
  @ApiProperty() failureCode!: string;
}

export class PayrollJobResponseDto {
  @ApiProperty({ format: 'uuid' }) jobId!: string;
  @ApiProperty({ enum: ['PENDING', 'QUEUED', 'PROCESSING', 'COMPLETED', 'PARTIALLY_FAILED', 'FAILED'] })
  status!: string;
  @ApiProperty() totalItems!: number;
  @ApiProperty() pendingItems!: number;
  @ApiProperty() processingItems!: number;
  @ApiProperty() completedItems!: number;
  @ApiProperty() failedItems!: number;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
  @ApiPropertyOptional() statusUrl?: string;
  @ApiPropertyOptional({ type: PayrollFailureSummaryDto, isArray: true })
  failures?: PayrollFailureSummaryDto[];
  @ApiPropertyOptional() queueFailureCount?: number;
  @ApiPropertyOptional({ nullable: true }) lastQueueErrorCode?: string | null;
}
