import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiSecurity,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { PrincipalService } from '../auth/principal.service.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { InternalServiceGuard } from '../common/internal-service.guard.js';
import { CreateTransferDto } from './dto/create-transfer.dto.js';
import { HistoryPageDto, TransferResponseDto } from './dto/transfer-response.dto.js';
import { ReconciliationService } from './reconciliation.service.js';
import { TransferService } from './transfer.service.js';

@ApiTags('transfers')
@ApiBearerAuth()
@Controller()
export class TransferController {
  constructor(
    private readonly transfers: TransferService,
    private readonly principal: PrincipalService,
  ) {}

  @Post('transfers')
  @ApiOperation({ summary: 'Create an idempotent domestic transfer' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: TransferResponseDto })
  @ApiAcceptedResponse({ type: TransferResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: TransferResponseDto })
  @ApiNotFoundResponse({ type: TransferResponseDto })
  @ApiConflictResponse({ type: TransferResponseDto })
  @ApiUnprocessableEntityResponse({ type: TransferResponseDto })
  @ApiServiceUnavailableResponse({ type: TransferResponseDto })
  async create(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Headers('idempotency-key') idempotencyKey: string = '',
    @Body() body: CreateTransferDto,
  ): Promise<TransferResponseDto> {
    const result = await this.transfers.createDomestic(
      this.principal.fromRequest(request),
      idempotencyKey,
      body,
    );
    response.status(result.httpStatus);
    return result.body;
  }

  @Get('transfers/:transferId')
  @ApiOkResponse({ type: TransferResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  get(
    @Req() request: Request,
    @Param('transferId', new ParseUUIDPipe()) transferId: string,
  ) {
    return this.transfers.getForPrincipal(
      this.principal.fromRequest(request),
      transferId,
    );
  }

  @Get('wallets/:walletId/transactions')
  @ApiOkResponse({ type: HistoryPageDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiServiceUnavailableResponse({ type: ErrorResponseDto })
  @ApiQuery({ name: 'limit', required: false, example: 50 })
  @ApiQuery({ name: 'cursor', required: false })
  history(
    @Req() request: Request,
    @Param('walletId', new ParseUUIDPipe()) walletId: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('cursor') cursor?: string,
  ) {
    return this.transfers.history(
      this.principal.fromRequest(request),
      walletId,
      limit,
      cursor,
    );
  }
}

@ApiTags('internal-transfers')
@ApiSecurity('internal-service')
@UseGuards(InternalServiceGuard)
@Controller('internal/transfers')
export class InternalTransferController {
  constructor(
    private readonly transfers: TransferService,
    private readonly reconciliation: ReconciliationService,
  ) {}

  @Get(':transferId')
  get(@Param('transferId', new ParseUUIDPipe()) transferId: string) {
    return this.transfers.getInternal(transferId);
  }

  @Post('reconciliation/run')
  runReconciliation() {
    return this.reconciliation.runOnce();
  }

  @Post(':transferId/reconcile')
  async reconcile(
    @Res({ passthrough: true }) response: Response,
    @Param('transferId', new ParseUUIDPipe()) transferId: string,
  ): Promise<TransferResponseDto> {
    const result = await this.transfers.reconcile(transferId, true);
    response.status(result.httpStatus);
    return result.body;
  }

}
