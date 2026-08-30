import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '../generated/prisma/client.js';
import { AccountClient, type WalletValidation } from '../clients/account.client.js';
import { FxClient, type ConsumedQuote } from '../clients/fx.client.js';
import { LedgerClient, type LedgerPosting } from '../clients/ledger.client.js';
import { UpstreamHttpError, UpstreamUnavailableError } from '../clients/upstream-error.js';
import { RequestContextService } from '../common/request-context.service.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  decodeHistoryCursor,
  encodeHistoryCursor,
} from '../history/history-cursor.js';
import { CreateInternationalTransferDto, CreateTransferDto } from './dto/create-transfer.dto.js';
import {
  HistoryPageDto,
  TransferResponseDto,
} from './dto/transfer-response.dto.js';

const REPLAY_WINDOW_MS = 24 * 60 * 60 * 1_000;
const RETENTION_WINDOW_MS = 7 * 365 * 24 * 60 * 60 * 1_000;

export interface TransferExecutionResult {
  httpStatus: number;
  body: TransferResponseDto;
}

type TransferWithIdempotency = Prisma.TransferGetPayload<{
  include: { idempotencyRecord: true };
}>;

@Injectable()
export class TransferService {
  private readonly logger = new Logger(TransferService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly account: AccountClient,
    private readonly ledger: LedgerClient,
    private readonly fx: FxClient,
    private readonly requestContext: RequestContextService,
  ) {}

  async createDomestic(
    clientId: string,
    idempotencyKey: string,
    command: CreateTransferDto,
  ): Promise<TransferExecutionResult> {
    validateIdempotencyKey(idempotencyKey);
    validateCommand(command);
    const requestHash = canonicalTransferHash(command);
    const claim = await this.claim(clientId, idempotencyKey, requestHash, command);
    this.requestContext.setTransactionId(claim.transfer.id);

    if (!claim.created) {
      return this.handleExisting(claim.transfer, requestHash);
    }

    await this.transition(claim.transfer.id, 'PENDING', 'PROCESSING');
    return this.process(claim.transfer.id);
  }

  async createInternational(
    clientId: string,
    idempotencyKey: string,
    command: CreateInternationalTransferDto,
  ): Promise<TransferExecutionResult> {
    validateIdempotencyKey(idempotencyKey);
    validateInternationalCommand(command);
    const requestHash = canonicalInternationalTransferHash(command);
    const claim = await this.claimInternational(
      clientId,
      idempotencyKey,
      requestHash,
      command,
    );
    this.requestContext.setTransactionId(claim.transfer.id);
    if (!claim.created) {
      return this.handleExisting(claim.transfer, requestHash);
    }
    return this.prepareInternational(claim.transfer);
  }

  async getForPrincipal(clientId: string, transferId: string): Promise<TransferResponseDto> {
    this.requestContext.setTransactionId(transferId);
    const transfer = await this.findTransfer(transferId);
    if (transfer.clientId !== clientId) {
      const recipient = await this.readWallet(transfer.recipientWalletId);
      if (recipient.ownerExternalRef !== clientId) {
        throw new ForbiddenException({
          code: 'TRANSFER_ACCESS_DENIED',
          message: 'The transfer is not accessible to this principal.',
        });
      }
    }
    return toResponse(transfer);
  }

  async getInternal(transferId: string): Promise<TransferResponseDto> {
    this.requestContext.setTransactionId(transferId);
    return toResponse(await this.findTransfer(transferId));
  }

  async history(
    clientId: string,
    walletId: string,
    limit: number,
    cursor?: string,
  ): Promise<HistoryPageDto> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new BadRequestException({
        code: 'INVALID_PAGE_LIMIT',
        message: 'History limit must be between 1 and 100.',
      });
    }
    const wallet = await this.readWallet(walletId);
    if (wallet.ownerExternalRef !== clientId) {
      throw new ForbiddenException({
        code: 'WALLET_ACCESS_DENIED',
        message: 'The wallet is not owned by this principal.',
      });
    }
    const after = cursor ? decodeHistoryCursor(walletId, cursor) : undefined;
    const pageSize = limit + 1;
    const rows = await this.prisma.db.$queryRaw<HistoryQueryRow[]>(Prisma.sql`
      SELECT
        "id",
        "transfer_id" AS "transferId",
        "role"::text AS "role",
        "status"::text AS "status",
        "amount"::text AS "amount",
        "currency",
        "occurred_at" AS "occurredAt"
      FROM "transaction_history"
      WHERE "wallet_id" = ${walletId}::uuid
      ${after
        ? Prisma.sql`AND ("occurred_at", "id") < (${after.occurredAt}, ${after.id}::uuid)`
        : Prisma.empty}
      ORDER BY "occurred_at" DESC, "id" DESC
      LIMIT ${pageSize}
    `);
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => ({
        transferId: row.transferId,
        direction: row.role === 'SENDER' ? 'OUTGOING' : 'INCOMING',
        amount: new Prisma.Decimal(row.amount).toFixed(8),
        currency: row.currency,
        status: row.status,
        occurredAt: row.occurredAt.toISOString(),
      })),
      nextCursor:
        hasMore && last
          ? encodeHistoryCursor(walletId, { occurredAt: last.occurredAt, id: last.id })
          : null,
    };
  }

  async reconcile(transferId: string, force = false): Promise<TransferExecutionResult> {
    this.requestContext.setTransactionId(transferId);
    const transfer = await this.findTransfer(transferId);
    if (transfer.status === 'PENDING' && transfer.type === 'INTERNATIONAL') {
      const withIdempotency = await this.prisma.db.transfer.findUniqueOrThrow({
        where: { id: transfer.id },
        include: { idempotencyRecord: true },
      });
      return this.prepareInternational(withIdempotency);
    }
    if (transfer.status !== 'PROCESSING') {
      return resultForTransfer(transfer);
    }

    let posting: LedgerPosting | null;
    try {
      posting = await this.ledger.byReference(transfer.id);
    } catch (error) {
      if (error instanceof UpstreamUnavailableError) {
        return processingResult(transfer);
      }
      throw error;
    }
    if (posting) {
      return this.complete(transfer.id, posting.id);
    }

    const staleBefore = Date.now() - staleProcessingMs();
    if (!force && transfer.updatedAt.getTime() > staleBefore) {
      return processingResult(transfer);
    }
    if (!(await this.claimProcessingRetry(transfer, force ? undefined : new Date(staleBefore)))) {
      return resultForTransfer(await this.findTransfer(transfer.id));
    }
    return this.process(transfer.id);
  }

  async findStale(limit = 50): Promise<string[]> {
    const staleBefore = new Date(Date.now() - staleProcessingMs());
    const transfers = await this.prisma.db.transfer.findMany({
      where: {
        updatedAt: { lte: staleBefore },
        OR: [
          { status: 'PROCESSING' },
          { status: 'PENDING', type: 'INTERNATIONAL' },
        ],
      },
      select: { id: true },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    return transfers.map((transfer) => transfer.id);
  }

  private async handleExisting(
    transfer: TransferWithIdempotency,
    requestHash: string,
  ): Promise<TransferExecutionResult> {
    const record = transfer.idempotencyRecord!;
    if (record.requestHash !== requestHash) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_PAYLOAD_MISMATCH',
        message: 'The idempotency key was already used with a different request.',
      });
    }
    if (record.replayExpiresAt.getTime() <= (await this.databaseNow()).getTime()) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_KEY_EXPIRED',
        message: 'The idempotency replay window has expired; use a new key.',
      });
    }
    if (record.state !== 'PROCESSING' && record.responseStatus && record.responseBody) {
      return {
        httpStatus: record.responseStatus,
        body: record.responseBody as unknown as TransferResponseDto,
      };
    }
    return this.reconcile(transfer.id);
  }

  private async claim(
    clientId: string,
    key: string,
    requestHash: string,
    command: CreateTransferDto,
  ): Promise<{ created: boolean; transfer: TransferWithIdempotency }> {
    const existing = await this.findByKey(clientId, key);
    if (existing) return { created: false, transfer: existing };

    const transferId = randomUUID();
    const amount = new Prisma.Decimal(command.amount);
    try {
      const transfer = await this.prisma.db.$transaction(async (transaction) => {
        const [{ now }] = await transaction.$queryRaw<Array<{ now: Date }>>`
          SELECT CURRENT_TIMESTAMP AS "now"
        `;
        await transaction.transfer.create({
          data: {
            id: transferId,
            clientId,
            type: 'DOMESTIC',
            status: 'PENDING',
            senderWalletId: command.senderWalletId,
            recipientWalletId: command.recipientWalletId,
            sourceCurrency: command.currency,
            sourceAmount: amount,
            targetCurrency: command.currency,
            targetAmount: amount,
            createdAt: now,
            history: {
              create: [
                {
                  walletId: command.senderWalletId,
                  role: 'SENDER',
                  counterpartyWalletId: command.recipientWalletId,
                  status: 'PENDING',
                  amount,
                  currency: command.currency,
                  occurredAt: now,
                },
                {
                  walletId: command.recipientWalletId,
                  role: 'RECIPIENT',
                  counterpartyWalletId: command.senderWalletId,
                  status: 'PENDING',
                  amount,
                  currency: command.currency,
                  occurredAt: now,
                },
              ],
            },
          },
        });
        await transaction.idempotencyRecord.create({
          data: {
            clientId,
            key,
            requestHash,
            transferId,
            replayExpiresAt: new Date(now.getTime() + REPLAY_WINDOW_MS),
            retentionUntil: new Date(now.getTime() + RETENTION_WINDOW_MS),
          },
        });
        return transaction.transfer.findUniqueOrThrow({
          where: { id: transferId },
          include: { idempotencyRecord: true },
        });
      });
      return { created: true, transfer };
    } catch (error) {
      if (isUniqueViolation(error)) {
        const winner = await this.findByKey(clientId, key);
        if (winner) return { created: false, transfer: winner };
      }
      throw error;
    }
  }

  private async claimInternational(
    clientId: string,
    key: string,
    requestHash: string,
    command: CreateInternationalTransferDto,
  ): Promise<{ created: boolean; transfer: TransferWithIdempotency }> {
    const existing = await this.findByKey(clientId, key);
    if (existing) return { created: false, transfer: existing };

    const transferId = randomUUID();
    try {
      const transfer = await this.prisma.db.$transaction(async (transaction) => {
        const [{ now }] = await transaction.$queryRaw<Array<{ now: Date }>>`
          SELECT CURRENT_TIMESTAMP AS "now"
        `;
        await transaction.transfer.create({
          data: {
            id: transferId,
            clientId,
            type: 'INTERNATIONAL',
            status: 'PENDING',
            senderWalletId: command.senderWalletId,
            recipientWalletId: command.recipientWalletId,
            sourceCurrency: command.sourceCurrency,
            sourceAmount: new Prisma.Decimal(command.sourceAmount),
            targetCurrency: command.targetCurrency,
            targetAmount: null,
            fxQuoteId: command.quoteId,
            lockedFxRate: null,
            createdAt: now,
          },
        });
        await transaction.idempotencyRecord.create({
          data: {
            clientId,
            key,
            requestHash,
            transferId,
            replayExpiresAt: new Date(now.getTime() + REPLAY_WINDOW_MS),
            retentionUntil: new Date(now.getTime() + RETENTION_WINDOW_MS),
          },
        });
        return transaction.transfer.findUniqueOrThrow({
          where: { id: transferId },
          include: { idempotencyRecord: true },
        });
      });
      return { created: true, transfer };
    } catch (error) {
      if (isUniqueViolation(error)) {
        const winner = await this.findByKey(clientId, key);
        if (winner) return { created: false, transfer: winner };
        const quoteWinner = await this.prisma.db.transfer.findFirst({
          where: { fxQuoteId: command.quoteId },
        });
        if (quoteWinner) {
          throw new ConflictException({
            code: 'QUOTE_ALREADY_USED',
            message: 'The quote is already bound to another transfer.',
          });
        }
      }
      throw error;
    }
  }

  private async prepareInternational(
    transfer: TransferWithIdempotency,
  ): Promise<TransferExecutionResult> {
    if (transfer.status !== 'PENDING' || transfer.type !== 'INTERNATIONAL' || !transfer.fxQuoteId) {
      return resultForTransfer(transfer);
    }
    let quote: ConsumedQuote;
    try {
      quote = await this.fx.consume(transfer.fxQuoteId, {
        transferId: transfer.id,
        clientId: transfer.clientId,
        sourceCurrency: transfer.sourceCurrency,
        targetCurrency: transfer.targetCurrency,
        sourceAmount: transfer.sourceAmount.toFixed(8),
      });
    } catch (error) {
      return this.handleFxFailure(transfer, error);
    }

    const prepared = await this.prisma.db.$transaction(async (transaction) => {
      const updated = await transaction.transfer.updateMany({
        where: {
          id: transfer.id,
          status: 'PENDING',
          targetAmount: null,
          lockedFxRate: null,
        },
        data: {
          targetAmount: new Prisma.Decimal(quote.targetAmount),
          lockedFxRate: new Prisma.Decimal(quote.rate),
          status: 'PROCESSING',
          version: { increment: 1n },
        },
      });
      if (updated.count === 1) {
        await transaction.transactionHistory.createMany({
          data: [
            {
              transferId: transfer.id,
              walletId: transfer.senderWalletId,
              role: 'SENDER',
              counterpartyWalletId: transfer.recipientWalletId,
              status: 'PROCESSING',
              amount: transfer.sourceAmount,
              currency: transfer.sourceCurrency,
              fxQuoteId: transfer.fxQuoteId,
              occurredAt: transfer.createdAt,
            },
            {
              transferId: transfer.id,
              walletId: transfer.recipientWalletId,
              role: 'RECIPIENT',
              counterpartyWalletId: transfer.senderWalletId,
              status: 'PROCESSING',
              amount: new Prisma.Decimal(quote.targetAmount),
              currency: transfer.targetCurrency,
              fxQuoteId: transfer.fxQuoteId,
              occurredAt: transfer.createdAt,
            },
          ],
        });
      }
      return updated.count === 1;
    });
    if (!prepared) {
      return resultForTransfer(await this.findTransfer(transfer.id));
    }
    return this.process(transfer.id);
  }

  private async process(transferId: string): Promise<TransferExecutionResult> {
    const transfer = await this.findTransfer(transferId);
    if (transfer.status !== 'PROCESSING') return resultForTransfer(transfer);

    let sender: WalletValidation;
    let recipient: WalletValidation;
    try {
      [sender, recipient] = await Promise.all([
        this.account.validation(transfer.senderWalletId),
        this.account.validation(transfer.recipientWalletId),
      ]);
      validateWallets(transfer, sender, recipient);
    } catch (error) {
      return this.handleAccountFailure(transfer.id, error);
    }

    try {
      const amount = transfer.sourceAmount.toFixed(8);
      const contextualRequestId = this.requestContext.getRequestId();
      const posting = await this.ledger.post({
        externalReference: transfer.id,
        requestId: isUuid(contextualRequestId) ? contextualRequestId : randomUUID(),
        postingType: transfer.type === 'INTERNATIONAL' ? 'FX_TRANSFER' : 'TRANSFER',
        sourceCurrency: transfer.sourceCurrency,
        targetCurrency: transfer.targetCurrency,
        sourceAmount: amount,
        targetAmount: transfer.targetAmount!.toFixed(8),
        ...(transfer.type === 'INTERNATIONAL'
          ? {
              fxQuoteId: transfer.fxQuoteId!,
              lockedFxRate: transfer.lockedFxRate!.toFixed(12),
            }
          : {}),
        entries: [
          {
            walletId: transfer.senderWalletId,
            direction: 'DEBIT',
            amount,
            currency: transfer.sourceCurrency,
          },
          {
            walletId: transfer.recipientWalletId,
            direction: 'CREDIT',
            amount: transfer.targetAmount!.toFixed(8),
            currency: transfer.targetCurrency,
          },
        ],
      });
      return this.complete(transfer.id, posting.id);
    } catch (error) {
      return this.handleLedgerFailure(transfer, error);
    }
  }

  private async handleAccountFailure(
    transferId: string,
    error: unknown,
  ): Promise<TransferExecutionResult> {
    if (error instanceof UpstreamUnavailableError) {
      return this.fail(
        transferId,
        503,
        'ACCOUNT_UNAVAILABLE',
        'Account service is temporarily unavailable.',
      );
    }
    if (error instanceof UpstreamHttpError) {
      if (error.status === 404) {
        return this.fail(transferId, 404, error.code, error.message);
      }
      if (error.status === 401 || error.status === 403 || error.status >= 500) {
        return this.fail(
          transferId,
          503,
          'ACCOUNT_UNAVAILABLE',
          'Account service is temporarily unavailable.',
        );
      }
      return this.fail(transferId, error.status, error.code, error.message);
    }
    if (error instanceof HttpException) {
      const descriptor = describeHttpException(error);
      return this.fail(transferId, error.getStatus(), descriptor.code, descriptor.message);
    }
    throw error;
  }

  private async handleFxFailure(
    transfer: Prisma.TransferModel,
    error: unknown,
  ): Promise<TransferExecutionResult> {
    if (error instanceof UpstreamUnavailableError) {
      return processingResult(transfer);
    }
    if (error instanceof UpstreamHttpError) {
      if (error.status === 401 || error.status === 403 || error.status >= 500) {
        return processingResult(transfer);
      }
      const status = error.status === 404 ? 404 : 409;
      return this.fail(transfer.id, status, error.code, error.message);
    }
    throw error;
  }

  private async handleLedgerFailure(
    transfer: Prisma.TransferModel,
    error: unknown,
  ): Promise<TransferExecutionResult> {
    if (error instanceof UpstreamUnavailableError) {
      return processingResult(transfer);
    }
    if (error instanceof UpstreamHttpError) {
      if (error.status === 401 || error.status === 403 || error.status >= 500) {
        return processingResult(transfer);
      }
      const status = error.code === 'INSUFFICIENT_FUNDS' ? 422 : error.status;
      return this.fail(transfer.id, status, error.code, error.message);
    }
    throw error;
  }

  private async complete(
    transferId: string,
    ledgerTransactionId: string,
  ): Promise<TransferExecutionResult> {
    const result = await this.prisma.db.$transaction(async (transaction) => {
      const [{ now: completedAt }] = await transaction.$queryRaw<Array<{ now: Date }>>`
        SELECT CURRENT_TIMESTAMP AS "now"
      `;
      const updated = await transaction.transfer.updateMany({
        where: { id: transferId, status: 'PROCESSING' },
        data: {
          status: 'COMPLETED',
          ledgerTransactionId,
          completedAt,
          version: { increment: 1n },
        },
      });
      if (updated.count === 0) {
        return {
          transfer: await transaction.transfer.findUniqueOrThrow({
            where: { id: transferId },
          }),
          transitioned: false,
        };
      }
      await transaction.transactionHistory.updateMany({
        where: { transferId },
        data: { status: 'COMPLETED' },
      });
      const transfer = await transaction.transfer.findUniqueOrThrow({
        where: { id: transferId },
      });
      const body = toResponse(transfer);
      await transaction.idempotencyRecord.update({
        where: { transferId },
        data: {
          state: 'COMPLETED',
          responseStatus: 201,
          responseBody: body as unknown as Prisma.InputJsonValue,
        },
      });
      return { transfer, transitioned: true };
    });
    if (result.transitioned) {
      this.logger.log(
        JSON.stringify({ event: 'transfer.completed', transferId, ledgerTransactionId }),
      );
    }
    return result.transfer.status === 'COMPLETED'
      ? { httpStatus: 201, body: toResponse(result.transfer) }
      : resultForTransfer(result.transfer);
  }

  private async fail(
    transferId: string,
    httpStatus: number,
    code: string,
    message: string,
  ): Promise<TransferExecutionResult> {
    const result = await this.prisma.db.$transaction(async (transaction) => {
      const updated = await transaction.transfer.updateMany({
        where: { id: transferId, status: { in: ['PENDING', 'PROCESSING'] } },
        data: {
          status: 'FAILED',
          failureCode: code,
          failureMessage: message,
          version: { increment: 1n },
        },
      });
      if (updated.count === 1) {
        await transaction.transactionHistory.updateMany({
          where: { transferId },
          data: { status: 'FAILED' },
        });
      }
      const transfer = await transaction.transfer.findUniqueOrThrow({
        where: { id: transferId },
      });
      const body = toResponse(transfer);
      if (updated.count === 1) {
        await transaction.idempotencyRecord.updateMany({
          where: { transferId, state: 'PROCESSING' },
          data: {
            state: 'FAILED',
            responseStatus: httpStatus,
            responseBody: body as unknown as Prisma.InputJsonValue,
          },
        });
      }
      return { transfer, transitioned: updated.count === 1 };
    });
    if (result.transitioned) {
      this.logger.warn(JSON.stringify({ event: 'transfer.failed', transferId, code }));
      return { httpStatus, body: toResponse(result.transfer) };
    }
    return resultForTransfer(result.transfer);
  }

  private async transition(
    transferId: string,
    from: 'PENDING',
    to: 'PROCESSING',
  ): Promise<void> {
    await this.prisma.db.$transaction(async (transaction) => {
      const updated = await transaction.transfer.updateMany({
        where: { id: transferId, status: from },
        data: { status: to, version: { increment: 1n } },
      });
      if (updated.count === 1) {
        await transaction.transactionHistory.updateMany({
          where: { transferId, status: from },
          data: { status: to },
        });
      }
    });
  }

  private async claimProcessingRetry(
    transfer: Prisma.TransferModel,
    staleBefore?: Date,
  ): Promise<boolean> {
    const claimed = await this.prisma.db.transfer.updateMany({
      where: {
        id: transfer.id,
        status: 'PROCESSING',
        version: transfer.version,
        ...(staleBefore ? { updatedAt: { lte: staleBefore } } : {}),
      },
      data: { version: { increment: 1n } },
    });
    return claimed.count === 1;
  }

  private findByKey(clientId: string, key: string) {
    return this.prisma.db.transfer.findFirst({
      where: { idempotencyRecord: { clientId, key } },
      include: { idempotencyRecord: true },
    });
  }

  private async findTransfer(transferId: string) {
    const transfer = await this.prisma.db.transfer.findUnique({ where: { id: transferId } });
    if (!transfer) {
      throw new NotFoundException({
        code: 'TRANSFER_NOT_FOUND',
        message: 'Transfer not found.',
      });
    }
    return transfer;
  }

  private async readWallet(walletId: string): Promise<WalletValidation> {
    try {
      return await this.account.validation(walletId);
    } catch (error) {
      if (error instanceof UpstreamUnavailableError) {
        throw new ServiceUnavailableException({
          code: 'ACCOUNT_UNAVAILABLE',
          message: 'Account service is temporarily unavailable.',
        });
      }
      if (error instanceof UpstreamHttpError) {
        if (error.status === 404) {
          throw new NotFoundException({ code: 'WALLET_NOT_FOUND', message: 'Wallet not found.' });
        }
        throw new ServiceUnavailableException({
          code: 'ACCOUNT_UNAVAILABLE',
          message: 'Account service is temporarily unavailable.',
        });
      }
      throw error;
    }
  }

  private async databaseNow(): Promise<Date> {
    const [{ now }] = await this.prisma.db.$queryRaw<Array<{ now: Date }>>`
      SELECT CURRENT_TIMESTAMP AS "now"
    `;
    return now;
  }
}

export function canonicalTransferHash(command: CreateTransferDto): string {
  const canonical = {
    method: 'POST',
    route: '/transfers',
    senderWalletId: command.senderWalletId,
    recipientWalletId: command.recipientWalletId,
    amount: new Prisma.Decimal(command.amount).toFixed(8),
    currency: command.currency,
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function canonicalInternationalTransferHash(
  command: CreateInternationalTransferDto,
): string {
  return createHash('sha256').update(JSON.stringify({
    method: 'POST',
    route: '/transfers/international',
    senderWalletId: command.senderWalletId,
    recipientWalletId: command.recipientWalletId,
    sourceAmount: new Prisma.Decimal(command.sourceAmount).toFixed(8),
    sourceCurrency: command.sourceCurrency,
    targetCurrency: command.targetCurrency,
    quoteId: command.quoteId,
  })).digest('hex');
}

function validateCommand(command: CreateTransferDto): void {
  if (command.senderWalletId === command.recipientWalletId) {
    throw new BadRequestException({
      code: 'SAME_WALLET_TRANSFER',
      message: 'Sender and recipient wallets must be different.',
    });
  }
  if (!new Prisma.Decimal(command.amount).isPositive()) {
    throw new BadRequestException({
      code: 'INVALID_TRANSFER_AMOUNT',
      message: 'Transfer amount must be positive.',
    });
  }
}

function validateInternationalCommand(command: CreateInternationalTransferDto): void {
  if (command.senderWalletId === command.recipientWalletId) {
    throw new BadRequestException({
      code: 'SAME_WALLET_TRANSFER',
      message: 'Sender and recipient wallets must be different.',
    });
  }
  if (command.sourceCurrency === command.targetCurrency) {
    throw new BadRequestException({
      code: 'SAME_CURRENCY_TRANSFER',
      message: 'International transfer currencies must differ.',
    });
  }
  if (!new Prisma.Decimal(command.sourceAmount).isPositive()) {
    throw new BadRequestException({
      code: 'INVALID_TRANSFER_AMOUNT',
      message: 'Transfer amount must be positive.',
    });
  }
}

function validateWallets(
  transfer: Prisma.TransferModel,
  sender: WalletValidation,
  recipient: WalletValidation,
): void {
  if (sender.ownerExternalRef !== transfer.clientId) {
    throw new ForbiddenException({
      code: 'WALLET_ACCESS_DENIED',
      message: 'The sender wallet is not owned by this principal.',
    });
  }
  if (
    sender.status !== 'ACTIVE' ||
    recipient.status !== 'ACTIVE' ||
    !sender.ledgerAccountId ||
    !recipient.ledgerAccountId
  ) {
    throw new ConflictException({
      code: 'WALLET_UNAVAILABLE',
      message: 'Both wallets must be active and provisioned.',
    });
  }
  if (
    sender.currency !== transfer.sourceCurrency ||
    recipient.currency !== transfer.targetCurrency
  ) {
    throw new ConflictException({
      code: 'CURRENCY_MISMATCH',
      message: 'Domestic transfer wallets and request currency must match.',
    });
  }
}

function validateIdempotencyKey(value: string): void {
  if (!/^[\x21-\x7E]{1,128}$/.test(value)) {
    throw new BadRequestException({
      code: 'INVALID_IDEMPOTENCY_KEY',
      message: 'Idempotency-Key must contain 1 to 128 visible ASCII characters.',
    });
  }
}

function toResponse(transfer: Prisma.TransferModel): TransferResponseDto {
  const response: TransferResponseDto = {
    transferId: transfer.id,
    status: transfer.status,
    sourceAmount: transfer.sourceAmount.toFixed(8),
    sourceCurrency: transfer.sourceCurrency,
    targetAmount: transfer.targetAmount?.toFixed(8) ?? null,
    targetCurrency: transfer.targetCurrency,
    ledgerTransactionId: transfer.ledgerTransactionId,
    completedAt: transfer.completedAt?.toISOString() ?? null,
  };
  if (transfer.fxQuoteId) response.quoteId = transfer.fxQuoteId;
  if (transfer.lockedFxRate) response.lockedRate = transfer.lockedFxRate.toFixed(12);
  if (transfer.status === 'PROCESSING' || transfer.status === 'PENDING') {
    response.statusUrl = `/transfers/${transfer.id}`;
  }
  if (transfer.status === 'FAILED' && transfer.failureCode && transfer.failureMessage) {
    response.failure = { code: transfer.failureCode, message: transfer.failureMessage };
  }
  return response;
}

function processingResult(transfer: Prisma.TransferModel): TransferExecutionResult {
  return { httpStatus: 202, body: toResponse(transfer) };
}

function resultForTransfer(transfer: Prisma.TransferModel): TransferExecutionResult {
  const status = transfer.status === 'PROCESSING' || transfer.status === 'PENDING'
    ? 202
    : transfer.status === 'FAILED'
      ? 422
      : 201;
  return { httpStatus: status, body: toResponse(transfer) };
}

function describeHttpException(error: HttpException): { code: string; message: string } {
  const response = error.getResponse();
  if (typeof response === 'object' && response !== null) {
    const value = response as Record<string, unknown>;
    if (typeof value.code === 'string' && typeof value.message === 'string') {
      return { code: value.code, message: value.message };
    }
  }
  return { code: `HTTP_${error.getStatus()}`, message: error.message };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function staleProcessingMs(): number {
  const value = Number(process.env.STALE_PROCESSING_MS ?? 30_000);
  return Number.isInteger(value) && value > 0 ? value : 30_000;
}

interface HistoryQueryRow {
  id: string;
  transferId: string;
  role: 'SENDER' | 'RECIPIENT';
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'REVERSED';
  amount: string;
  currency: string;
  occurredAt: Date;
}
