import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  CreatePostingDto,
  FundWalletDto,
  ReversePostingDto,
} from './dto/ledger-commands.dto.js';
import { LedgerPostingResponseDto } from './dto/ledger-responses.dto.js';
import { LedgerMetricsService } from './ledger-metrics.service.js';

interface ResolvedEntry {
  ledgerAccountId: string;
  direction: 'DEBIT' | 'CREDIT';
  amount: Prisma.Decimal;
  currency: string;
  fxQuoteId?: string;
  lockedFxRate?: Prisma.Decimal;
}

interface ResolvedPosting {
  externalReference: string;
  requestId: string;
  postingType: 'TRANSFER' | 'FX_TRANSFER' | 'FEE' | 'REVERSAL' | 'FUNDING';
  sourceCurrency: string;
  targetCurrency: string;
  sourceAmount: Prisma.Decimal;
  targetAmount: Prisma.Decimal;
  fxQuoteId?: string;
  lockedFxRate?: Prisma.Decimal;
  reversesTransactionId?: string;
  entries: ResolvedEntry[];
}

interface LockedBalance {
  ledgerAccountId: string;
  availableBalance: unknown;
  version: bigint;
}

export interface PostOptions {
  failBeforeCommit?: boolean;
}

@Injectable()
export class PostingService {
  private readonly logger = new Logger(PostingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: LedgerMetricsService,
  ) {}

  async post(command: CreatePostingDto, options: PostOptions = {}) {
    validateFxShape(command);
    const commandHash = hashValue(normalizeCommand(command));
    const prior = await this.findIdempotent(command.externalReference, commandHash);
    if (prior) {
      return prior;
    }

    try {
      const walletIds = [...new Set(command.entries.map((entry) => entry.walletId))];
      const accounts = await this.prisma.db.ledgerAccount.findMany({
        where: { walletId: { in: walletIds } },
      });
      const byWallet = new Map(accounts.map((account) => [account.walletId, account]));
      if (accounts.length !== walletIds.length) {
        throw new NotFoundException({
          code: 'LEDGER_ACCOUNT_NOT_FOUND',
          message: 'One or more ledger accounts were not found.',
        });
      }

      const resolved: ResolvedPosting = {
        externalReference: command.externalReference,
        requestId: command.requestId,
        postingType: command.postingType,
        sourceCurrency: command.sourceCurrency,
        targetCurrency: command.targetCurrency,
        sourceAmount: decimal(command.sourceAmount),
        targetAmount: decimal(command.targetAmount),
        fxQuoteId: command.fxQuoteId,
        lockedFxRate: command.lockedFxRate ? decimal(command.lockedFxRate) : undefined,
        entries: command.entries.map((entry) => {
          const account = byWallet.get(entry.walletId)!;
          if (account.currency !== entry.currency || account.status !== 'ACTIVE') {
            throw new ConflictException({
              code: 'LEDGER_ACCOUNT_UNAVAILABLE',
              message: 'A ledger account is unavailable or uses another currency.',
            });
          }
          return {
            ledgerAccountId: account.id,
            direction: entry.direction,
            amount: decimal(entry.amount),
            currency: entry.currency,
            fxQuoteId: command.fxQuoteId,
            lockedFxRate: command.lockedFxRate
              ? decimal(command.lockedFxRate)
              : undefined,
          };
        }),
      };
      return await this.postResolved(resolved, commandHash, options);
    } catch (error) {
      return this.handlePostingFailure(error, command.externalReference, commandHash);
    }
  }

  async reverse(transactionId: string, command: ReversePostingDto) {
    const original = await this.prisma.db.ledgerTransaction.findUnique({
      where: { id: transactionId },
      include: {
        entries: { orderBy: { sequence: 'asc' } },
        reversedBy: true,
      },
    });
    if (!original) {
      throw new NotFoundException({
        code: 'POSTING_NOT_FOUND',
        message: 'Ledger posting not found.',
      });
    }
    if (original.postingType === 'REVERSAL') {
      throw new ConflictException({
        code: 'REVERSAL_OF_REVERSAL_NOT_ALLOWED',
        message: 'A reversal cannot itself be reversed.',
      });
    }

    const commandHash = hashValue({
      kind: 'REVERSAL',
      originalTransactionId: original.id,
      externalReference: command.externalReference,
    });
    const prior = await this.findIdempotent(command.externalReference, commandHash);
    if (prior) {
      return prior;
    }
    if (original.reversedBy) {
      throw new ConflictException({
        code: 'POSTING_ALREADY_REVERSED',
        message: 'The ledger posting has already been reversed.',
      });
    }
    const resolved: ResolvedPosting = {
      externalReference: command.externalReference,
      requestId: command.requestId,
      postingType: 'REVERSAL',
      sourceCurrency: original.sourceCurrency,
      targetCurrency: original.targetCurrency,
      sourceAmount: original.sourceAmount,
      targetAmount: original.targetAmount,
      fxQuoteId: original.fxQuoteId ?? undefined,
      lockedFxRate: original.lockedFxRate ?? undefined,
      reversesTransactionId: original.id,
      entries: original.entries.map((entry) => ({
        ledgerAccountId: entry.ledgerAccountId,
        direction: entry.direction === 'DEBIT' ? 'CREDIT' : 'DEBIT',
        amount: entry.amount,
        currency: entry.currency,
        fxQuoteId: entry.fxQuoteId ?? undefined,
        lockedFxRate: entry.lockedFxRate ?? undefined,
      })),
    };
    try {
      return await this.postResolved(resolved, commandHash);
    } catch (error) {
      return this.handlePostingFailure(error, command.externalReference, commandHash);
    }
  }

  async fund(command: FundWalletDto) {
    if (process.env.NODE_ENV === 'production' || process.env.ENABLE_TEST_FUNDING !== 'true') {
      throw new ForbiddenException({
        code: 'TEST_FUNDING_DISABLED',
        message: 'Controlled test funding is disabled.',
      });
    }
    const customer = await this.prisma.db.ledgerAccount.findFirst({
      where: { walletId: command.walletId },
    });
    if (!customer || customer.currency !== command.currency || customer.status !== 'ACTIVE') {
      throw new NotFoundException({
        code: 'LEDGER_ACCOUNT_NOT_FOUND',
        message: 'Ledger account not found.',
      });
    }
    const clearing = await this.ensureClearingAccount(command.currency);
    const commandHash = hashValue({
      kind: 'FUNDING',
      externalReference: command.externalReference,
      walletId: command.walletId,
      amount: money(command.amount),
      currency: command.currency,
    });
    const prior = await this.findIdempotent(command.externalReference, commandHash);
    if (prior) {
      return prior;
    }
    const amount = decimal(command.amount);
    try {
      return await this.postResolved(
        {
          externalReference: command.externalReference,
          requestId: command.requestId,
          postingType: 'FUNDING',
          sourceCurrency: command.currency,
          targetCurrency: command.currency,
          sourceAmount: amount,
          targetAmount: amount,
          entries: [
            {
              ledgerAccountId: clearing.id,
              direction: 'DEBIT',
              amount,
              currency: command.currency,
            },
            {
              ledgerAccountId: customer.id,
              direction: 'CREDIT',
              amount,
              currency: command.currency,
            },
          ],
        },
        commandHash,
      );
    } catch (error) {
      return this.handlePostingFailure(error, command.externalReference, commandHash);
    }
  }

  async byReference(externalReference: string) {
    const posting = await this.prisma.db.ledgerTransaction.findUnique({
      where: { externalReference },
      include: { entries: { orderBy: { sequence: 'asc' } } },
    });
    if (!posting) {
      throw new NotFoundException({ code: 'POSTING_NOT_FOUND', message: 'Ledger posting not found.' });
    }
    return toResponse(posting);
  }

  private async postResolved(
    command: ResolvedPosting,
    commandHash: string,
    options: PostOptions = {},
  ): Promise<LedgerPostingResponseDto> {
    validateResolved(command);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const result = await this.prisma.db.$transaction(
          async (transaction) => {
            const accountIds = [...new Set(command.entries.map((entry) => entry.ledgerAccountId))].sort();
            const accounts = await transaction.ledgerAccount.findMany({
              where: { id: { in: accountIds } },
            });
            if (accounts.length !== accountIds.length) {
              throw new NotFoundException({
                code: 'LEDGER_ACCOUNT_NOT_FOUND',
                message: 'One or more ledger accounts were not found.',
              });
            }
            const accountById = new Map(accounts.map((account) => [account.id, account]));
            for (const entry of command.entries) {
              const account = accountById.get(entry.ledgerAccountId)!;
              const statusAllowed =
                account.status === 'ACTIVE' ||
                (command.postingType === 'REVERSAL' && account.status === 'FROZEN');
              if (account.currency !== entry.currency || !statusAllowed) {
                throw new ConflictException({
                  code: 'LEDGER_ACCOUNT_UNAVAILABLE',
                  message: 'A ledger account is unavailable or uses another currency.',
                });
              }
            }

            const locked = await transaction.$queryRaw<LockedBalance[]>(Prisma.sql`
              SELECT
                "ledger_account_id" AS "ledgerAccountId",
                "available_balance" AS "availableBalance",
                "version"
              FROM "wallet_balances"
              WHERE "ledger_account_id" IN (${Prisma.join(
                accountIds.map((id) => Prisma.sql`${id}::uuid`),
              )})
              ORDER BY "ledger_account_id"
              FOR UPDATE
            `);
            if (locked.length !== accountIds.length) {
              throw new Error('A ledger balance projection is missing.');
            }

            const next = new Map(
              locked.map((balance) => [
                balance.ledgerAccountId,
                {
                  value: decimal(String(balance.availableBalance)),
                  version: balance.version,
                },
              ]),
            );
            for (const entry of command.entries) {
              const account = accountById.get(entry.ledgerAccountId)!;
              const balance = next.get(entry.ledgerAccountId)!;
              const increases = entry.direction === account.normalSide;
              balance.value = increases
                ? balance.value.plus(entry.amount)
                : balance.value.minus(entry.amount);
            }
            for (const [ledgerAccountId, balance] of next) {
              const account = accountById.get(ledgerAccountId)!;
              if (account.accountType === 'CUSTOMER' && balance.value.isNegative()) {
                throw new UnprocessableEntityException({
                  code: 'INSUFFICIENT_FUNDS',
                  message: 'The wallet has insufficient available funds.',
                });
              }
            }

            const created = await transaction.ledgerTransaction.create({
              data: {
                externalReference: command.externalReference,
                commandHash,
                postingType: command.postingType,
                sourceCurrency: command.sourceCurrency,
                targetCurrency: command.targetCurrency,
                sourceAmount: command.sourceAmount,
                targetAmount: command.targetAmount,
                fxQuoteId: command.fxQuoteId,
                lockedFxRate: command.lockedFxRate,
                reversesTransactionId: command.reversesTransactionId,
                requestId: command.requestId,
              },
            });
            await transaction.ledgerEntry.createMany({
              data: command.entries.map((entry, index) => ({
                ledgerTransactionId: created.id,
                ledgerAccountId: entry.ledgerAccountId,
                sequence: index + 1,
                direction: entry.direction,
                amount: entry.amount,
                currency: entry.currency,
                fxQuoteId: entry.fxQuoteId,
                lockedFxRate: entry.lockedFxRate,
              })),
            });
            for (const [ledgerAccountId, balance] of next) {
              await transaction.walletBalance.update({
                where: { ledgerAccountId },
                data: {
                  availableBalance: balance.value,
                  version: { increment: 1n },
                },
              });
            }
            if (options.failBeforeCommit) {
              throw new Error('Injected failure before commit.');
            }
            const complete = await transaction.ledgerTransaction.findUniqueOrThrow({
              where: { id: created.id },
              include: { entries: { orderBy: { sequence: 'asc' } } },
            });
            return toResponse(complete);
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        this.metrics.recordSuccess();
        this.logger.log(
          JSON.stringify({
            event: 'ledger.posting.succeeded',
            externalReference: command.externalReference,
            requestId: command.requestId,
          }),
        );
        return result;
      } catch (error) {
        if (isSerializationFailure(error) && attempt < 3) {
          continue;
        }
        throw error;
      }
    }
    throw new Error('Posting retry loop exited unexpectedly.');
  }

  private async findIdempotent(externalReference: string, commandHash: string) {
    const existing = await this.prisma.db.ledgerTransaction.findUnique({
      where: { externalReference },
      include: { entries: { orderBy: { sequence: 'asc' } } },
    });
    if (!existing) {
      return null;
    }
    if (existing.commandHash !== commandHash) {
      throw idempotencyMismatch();
    }
    return toResponse(existing);
  }

  private async handlePostingFailure(
    error: unknown,
    externalReference: string,
    commandHash: string,
  ): Promise<LedgerPostingResponseDto> {
    if (isUniqueViolation(error)) {
      const winner = await this.findIdempotent(externalReference, commandHash);
      if (winner) {
        return winner;
      }
      throw new ConflictException({
        code: 'POSTING_CONFLICT',
        message: 'The posting conflicts with an existing ledger operation.',
      });
    }
    this.metrics.recordFailure();
    this.logger.error(
      JSON.stringify({ event: 'ledger.posting.failed', externalReference }),
    );
    throw error;
  }

  private async ensureClearingAccount(currency: string) {
    const existing = await this.prisma.db.ledgerAccount.findFirst({
      where: { accountType: 'FX_CLEARING', currency },
    });
    if (existing) return existing;
    try {
      return await this.prisma.db.ledgerAccount.create({
        data: {
          accountType: 'FX_CLEARING',
          currency,
          normalSide: 'DEBIT',
          balance: { create: { currency } },
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return this.prisma.db.ledgerAccount.findFirstOrThrow({
          where: { accountType: 'FX_CLEARING', currency },
        });
      }
      throw error;
    }
  }
}

function validateFxShape(command: CreatePostingDto): void {
  const isFx = command.postingType === 'FX_TRANSFER';
  const valid = isFx
    ? command.sourceCurrency !== command.targetCurrency &&
      Boolean(command.fxQuoteId) &&
      Boolean(command.lockedFxRate)
    : command.sourceCurrency === command.targetCurrency &&
      !command.fxQuoteId &&
      !command.lockedFxRate;
  if (!valid) {
    throw new UnprocessableEntityException({
      code: 'INVALID_FX_POSTING',
      message: 'Posting currencies and FX fields are inconsistent.',
    });
  }
}

function validateResolved(command: ResolvedPosting): void {
  if (!command.sourceAmount.isPositive() || !command.targetAmount.isPositive()) {
    throw new UnprocessableEntityException({
      code: 'INVALID_POSTING_AMOUNT',
      message: 'Posting amounts must be positive.',
    });
  }
  if (command.lockedFxRate && !command.lockedFxRate.isPositive()) {
    throw new UnprocessableEntityException({
      code: 'INVALID_FX_RATE',
      message: 'The locked FX rate must be positive.',
    });
  }
  const totals = new Map<string, { debit: Prisma.Decimal; credit: Prisma.Decimal }>();
  for (const entry of command.entries) {
    if (!entry.amount.isPositive()) {
      throw new UnprocessableEntityException({
        code: 'INVALID_POSTING_AMOUNT',
        message: 'Ledger entry amounts must be positive.',
      });
    }
    const total = totals.get(entry.currency) ?? {
      debit: decimal('0'),
      credit: decimal('0'),
    };
    total[entry.direction === 'DEBIT' ? 'debit' : 'credit'] =
      total[entry.direction === 'DEBIT' ? 'debit' : 'credit'].plus(entry.amount);
    totals.set(entry.currency, total);
  }
  for (const total of totals.values()) {
    if (!total.debit.equals(total.credit)) {
      throw new UnprocessableEntityException({
        code: 'UNBALANCED_POSTING',
        message: 'Debits and credits must balance independently per currency.',
      });
    }
  }
  const sourceTotal = totals.get(command.sourceCurrency);
  const targetTotal = totals.get(command.targetCurrency);
  if (
    !sourceTotal?.debit.equals(command.sourceAmount) ||
    !targetTotal?.credit.equals(command.targetAmount)
  ) {
    throw new UnprocessableEntityException({
      code: 'POSTING_TOTAL_MISMATCH',
      message: 'Posting metadata must match the balanced journal totals.',
    });
  }
}

function normalizeCommand(command: CreatePostingDto) {
  return {
    externalReference: command.externalReference,
    postingType: command.postingType,
    sourceCurrency: command.sourceCurrency,
    targetCurrency: command.targetCurrency,
    sourceAmount: money(command.sourceAmount),
    targetAmount: money(command.targetAmount),
    lockedFxRate: command.lockedFxRate ? rate(command.lockedFxRate) : null,
    fxQuoteId: command.fxQuoteId ?? null,
    entries: command.entries
      .map((entry) => ({ ...entry, amount: money(entry.amount) }))
      .sort((left, right) =>
        `${left.walletId}:${left.direction}:${left.currency}:${left.amount}`.localeCompare(
          `${right.walletId}:${right.direction}:${right.currency}:${right.amount}`,
        ),
      ),
  };
}

function decimal(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function money(value: string): string {
  return decimal(value).toFixed(8);
}

function rate(value: string): string {
  return decimal(value).toFixed(12);
}

function hashValue(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function idempotencyMismatch(): ConflictException {
  return new ConflictException({
    code: 'IDEMPOTENCY_KEY_REUSED',
    message: 'The external reference was already used with a different command.',
  });
}

function isUniqueViolation(error: unknown): boolean {
  return hasCode(error, 'P2002');
}

function isSerializationFailure(error: unknown): boolean {
  return hasCode(error, 'P2034');
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function toResponse(posting: {
  id: string;
  externalReference: string;
  status: string;
  postingType: string;
  entries: Array<{
    ledgerAccountId: string;
    direction: string;
    amount: { toFixed(value: number): string };
    currency: string;
  }>;
}): LedgerPostingResponseDto {
  return {
    id: posting.id,
    externalReference: posting.externalReference,
    status: posting.status,
    postingType: posting.postingType,
    entries: posting.entries.map((entry) => ({
      ledgerAccountId: entry.ledgerAccountId,
      direction: entry.direction,
      amount: entry.amount.toFixed(8),
      currency: entry.currency,
    })),
  };
}
