import {
  Body,
  BadRequestException,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { createHash } from 'node:crypto';
import { OperatorService } from '../auth/operator.service.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { InternalServiceGuard } from '../common/internal-service.guard.js';
import { RequestContextService } from '../common/request-context.service.js';
import { AuditService } from './audit.service.js';
import { AppendAuditEventDto, VerifyAuditStreamDto } from './dto/audit-event.dto.js';
import { AuditRecordResponseDto, AuditVerificationResponseDto } from './dto/audit-response.dto.js';

@ApiTags('internal-audit')
@ApiSecurity('internal-service')
@UseGuards(InternalServiceGuard)
@Controller('internal/audit-events')
export class InternalAuditController {
  constructor(private readonly audit: AuditService) {}

  @Post()
  @ApiOkResponse({ type: AuditRecordResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto })
  append(@Body() body: AppendAuditEventDto) {
    return this.audit.append(body);
  }
}

@ApiTags('admin-audit')
@ApiBearerAuth()
@Controller('admin/audit')
export class AdminAuditController {
  constructor(
    private readonly audit: AuditService,
    private readonly operators: OperatorService,
    private readonly requestContext: RequestContextService,
  ) {}

  @Post('verify')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ type: AuditVerificationResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async verify(
    @Req() request: Request,
    @Headers('idempotency-key') idempotencyKey: string = '',
    @Body() body: VerifyAuditStreamDto,
  ): Promise<AuditVerificationResponseDto> {
    const operatorId = this.operators.fromRequest(request);
    validateIdempotencyKey(idempotencyKey);
    const result = await this.audit.verify(body.streamKey);
    await this.audit.appendOperatorAction({
      eventId: deterministicUuid(`audit.verify\0${operatorId}\0${idempotencyKey}`),
      streamKey: 'admin:operator-actions',
      action: 'audit.verified',
      entityType: 'audit-stream',
      entityId: body.streamKey,
      actorId: operatorId,
      occurredAt: new Date().toISOString(),
      metadata: { valid: result.valid, recordsChecked: result.recordsChecked },
    });
    return result;
  }

  @Get('streams/:streamKey/records')
  @ApiOkResponse({ type: AuditRecordResponseDto, isArray: true })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async records(
    @Req() request: Request,
    @Param('streamKey') streamKey: string,
  ): Promise<AuditRecordResponseDto[]> {
    const operatorId = this.operators.fromRequest(request);
    const records = await this.audit.records(streamKey);
    await this.audit.appendOperatorAction({
      eventId: deterministicUuid(`audit.read\0${this.requestContext.getRequestId()}`),
      streamKey: 'admin:operator-actions',
      action: 'audit.records.read',
      entityType: 'audit-stream',
      entityId: streamKey,
      actorId: operatorId,
      occurredAt: new Date().toISOString(),
      metadata: { recordsReturned: records.length },
    });
    return records;
  }
}

export function deterministicUuid(value: string): string {
  const bytes = createHash('sha256').update(value).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function validateIdempotencyKey(value: string): void {
  if (!/^[\x21-\x7E]{1,128}$/.test(value)) {
    throw new BadRequestException({
      code: 'INVALID_IDEMPOTENCY_KEY',
      message: 'Idempotency-Key must contain 1 to 128 visible ASCII characters.',
    });
  }
}
