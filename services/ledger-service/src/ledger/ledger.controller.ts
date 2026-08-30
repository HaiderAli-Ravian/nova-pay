import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { InternalServiceGuard } from '../common/internal-service.guard.js';
import {
  BalanceQueryDto,
  CreatePostingDto,
  FundWalletDto,
  ProvisionLedgerAccountDto,
  ReversePostingDto,
} from './dto/ledger-commands.dto.js';
import {
  LedgerBalanceResponseDto,
  LedgerPostingResponseDto,
} from './dto/ledger-responses.dto.js';
import { LedgerAccountService } from './ledger-account.service.js';
import { LedgerMetricsService } from './ledger-metrics.service.js';
import { LedgerInvariantService } from './ledger-invariant.service.js';
import { PostingService } from './posting.service.js';

@ApiTags('internal-ledger')
@ApiSecurity('internal-service')
@UseGuards(InternalServiceGuard)
@Controller('internal/ledger')
export class LedgerController {
  constructor(
    private readonly accounts: LedgerAccountService,
    private readonly postings: PostingService,
    private readonly metrics: LedgerMetricsService,
    private readonly invariants: LedgerInvariantService,
  ) {}

  @Post('accounts')
  @ApiOperation({ summary: 'Idempotently provision a customer ledger account' })
  @ApiCreatedResponse({ type: LedgerBalanceResponseDto })
  provision(@Body() body: ProvisionLedgerAccountDto) {
    return this.accounts.provision(body.walletId, body.currency);
  }

  @Get('wallets/:walletId/balance')
  @ApiOkResponse({ type: LedgerBalanceResponseDto })
  balance(@Param('walletId', new ParseUUIDPipe()) walletId: string) {
    return this.accounts.balance(walletId);
  }

  @Post('balances/query')
  queryBalances(@Body() body: BalanceQueryDto) {
    return this.accounts.balances(body.walletIds).then((balances) => ({ balances }));
  }

  @Post('postings')
  @ApiCreatedResponse({ type: LedgerPostingResponseDto })
  post(@Body() body: CreatePostingDto) {
    return this.postings.post(body);
  }

  @Get('postings/by-reference/:externalReference')
  @ApiOkResponse({ type: LedgerPostingResponseDto })
  byReference(
    @Param('externalReference', new ParseUUIDPipe()) externalReference: string,
  ) {
    return this.postings.byReference(externalReference);
  }

  @Post('postings/:transactionId/reversal')
  @ApiCreatedResponse({ type: LedgerPostingResponseDto })
  reverse(
    @Param('transactionId', new ParseUUIDPipe()) transactionId: string,
    @Body() body: ReversePostingDto,
  ) {
    return this.postings.reverse(transactionId, body);
  }

  @Post('test-funding')
  @ApiCreatedResponse({ type: LedgerPostingResponseDto })
  fund(@Body() body: FundWalletDto) {
    return this.postings.fund(body);
  }

  @Get('metrics')
  metricsSnapshot() {
    return this.metrics.snapshot();
  }

  @Post('invariants/verify')
  @ApiOperation({ summary: 'Verify the persisted double-entry invariant' })
  verifyInvariants() {
    return this.invariants.verify();
  }
}
