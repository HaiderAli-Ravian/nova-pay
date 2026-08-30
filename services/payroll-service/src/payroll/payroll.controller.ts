import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiPayloadTooLargeResponse,
  ApiSecurity,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { PrincipalService } from '../auth/principal.service.js';
import { InternalServiceGuard } from '../common/internal-service.guard.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { CreatePayrollJobDto } from './dto/create-payroll-job.dto.js';
import { PayrollJobResponseDto } from './dto/payroll-job-response.dto.js';
import { PayrollService } from './payroll.service.js';

@ApiTags('payroll')
@ApiBearerAuth()
@Controller('payroll/jobs')
export class PayrollController {
  constructor(
    private readonly payroll: PayrollService,
    private readonly principal: PrincipalService,
  ) {}

  @Post()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiAcceptedResponse({ type: PayrollJobResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto })
  @ApiPayloadTooLargeResponse({ type: ErrorResponseDto })
  @ApiServiceUnavailableResponse({ type: ErrorResponseDto })
  submit(
    @Req() request: Request,
    @Headers('idempotency-key') idempotencyKey: string = '',
    @Body() body: CreatePayrollJobDto,
  ): Promise<PayrollJobResponseDto> {
    return this.payroll.submit(
      this.principal.fromRequest(request),
      idempotencyKey,
      body,
    );
  }

  @Get(':jobId')
  @ApiOkResponse({ type: PayrollJobResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  get(
    @Req() request: Request,
    @Param('jobId', new ParseUUIDPipe()) jobId: string,
  ): Promise<PayrollJobResponseDto> {
    return this.payroll.getForEmployer(this.principal.fromRequest(request), jobId);
  }
}

@ApiTags('internal-payroll')
@ApiSecurity('internal-service')
@UseGuards(InternalServiceGuard)
@Controller('internal/payroll')
export class InternalPayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Get(':jobId')
  @ApiOkResponse({ type: PayrollJobResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  get(@Param('jobId', new ParseUUIDPipe()) jobId: string) {
    return this.payroll.getInternal(jobId);
  }
}
