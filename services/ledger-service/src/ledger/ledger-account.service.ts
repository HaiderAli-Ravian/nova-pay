import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { LedgerBalanceResponseDto } from './dto/ledger-responses.dto.js';

@Injectable()
export class LedgerAccountService {
  constructor(private readonly prisma: PrismaService) {}

  async provision(walletId: string, currency: string): Promise<LedgerBalanceResponseDto> {
    const existing = await this.prisma.db.ledgerAccount.findFirst({
      where: { walletId },
      include: { balance: true },
    });
    if (existing) {
      if (existing.currency !== currency) {
        throw new ConflictException({
          code: 'LEDGER_ACCOUNT_MISMATCH',
          message: 'The wallet is already provisioned with another currency.',
        });
      }
      return toBalance(existing);
    }

    try {
      const created = await this.prisma.db.ledgerAccount.create({
        data: {
          walletId,
          currency,
          accountType: 'CUSTOMER',
          normalSide: 'CREDIT',
          balance: { create: { currency } },
        },
        include: { balance: true },
      });
      return toBalance(created);
    } catch (error) {
      if (isUniqueViolation(error)) {
        const winner = await this.prisma.db.ledgerAccount.findFirst({
          where: { walletId },
          include: { balance: true },
        });
        if (winner?.currency === currency) {
          return toBalance(winner);
        }
      }
      throw error;
    }
  }

  async balance(walletId: string): Promise<LedgerBalanceResponseDto> {
    const account = await this.prisma.db.ledgerAccount.findFirst({
      where: { walletId },
      include: { balance: true },
    });
    if (!account) {
      throw accountNotFound();
    }
    return toBalance(account);
  }

  async balances(walletIds: string[]): Promise<LedgerBalanceResponseDto[]> {
    if (new Set(walletIds).size !== walletIds.length) {
      throw new ConflictException({
        code: 'DUPLICATE_WALLET_ID',
        message: 'Each wallet ID may appear only once.',
      });
    }
    const accounts = await this.prisma.db.ledgerAccount.findMany({
      where: { walletId: { in: walletIds } },
      include: { balance: true },
    });
    if (accounts.length !== walletIds.length) {
      throw accountNotFound();
    }
    const byWallet = new Map(accounts.map((account) => [account.walletId, account]));
    return walletIds.map((walletId) => toBalance(byWallet.get(walletId)!));
  }
}

function toBalance(account: {
  id: string;
  walletId: string | null;
  currency: string;
  balance: { availableBalance: { toFixed(value: number): string }; version: bigint } | null;
}): LedgerBalanceResponseDto {
  if (!account.walletId || !account.balance) {
    throw new Error('Ledger account is missing its balance projection.');
  }
  return {
    walletId: account.walletId,
    ledgerAccountId: account.id,
    available: account.balance.availableBalance.toFixed(8),
    currency: account.currency,
    version: account.balance.version.toString(),
  };
}

function accountNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'LEDGER_ACCOUNT_NOT_FOUND',
    message: 'Ledger account not found.',
  });
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}
