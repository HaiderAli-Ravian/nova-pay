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
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { PrincipalService } from '../auth/principal.service.js';
import { InternalServiceGuard } from '../common/internal-service.guard.js';
import { CreateWalletDto } from './dto/create-wallet.dto.js';
import { WalletBalanceDto, WalletResponseDto } from './dto/wallet-response.dto.js';
import { WalletService } from './wallet.service.js';

@ApiTags('wallets')
@ApiBearerAuth()
@Controller('wallets')
export class WalletController {
  constructor(
    private readonly wallets: WalletService,
    private readonly principal: PrincipalService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create and provision a wallet' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: WalletResponseDto })
  create(
    @Req() request: Request,
    @Headers('idempotency-key') idempotencyKey: string = '',
    @Body() body: CreateWalletDto,
  ) {
    return this.wallets.create(this.principal.fromRequest(request), idempotencyKey, body);
  }

  @Get()
  @ApiOperation({ summary: 'List wallets with authoritative ledger balances' })
  @ApiOkResponse({ type: WalletResponseDto, isArray: true })
  list(@Req() request: Request) {
    return this.wallets.list(this.principal.fromRequest(request));
  }

  @Get(':walletId/balance')
  @ApiOperation({ summary: 'Read the authoritative wallet balance' })
  @ApiOkResponse({ type: WalletBalanceDto })
  balance(
    @Req() request: Request,
    @Param('walletId', new ParseUUIDPipe()) walletId: string,
  ) {
    return this.wallets.balance(this.principal.fromRequest(request), walletId);
  }
}

@ApiTags('internal')
@ApiSecurity('internal-service')
@UseGuards(InternalServiceGuard)
@Controller('internal/wallets')
export class InternalWalletController {
  constructor(private readonly wallets: WalletService) {}

  @Get(':walletId/validation')
  validation(@Param('walletId', new ParseUUIDPipe()) walletId: string) {
    return this.wallets.validation(walletId);
  }

  @Post(':walletId/reconcile')
  reconcile(@Param('walletId', new ParseUUIDPipe()) walletId: string) {
    return this.wallets.reconcile(walletId);
  }
}
