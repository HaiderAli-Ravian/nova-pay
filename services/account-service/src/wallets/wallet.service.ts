import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../database/prisma.service.js';
import { CreateWalletDto } from './dto/create-wallet.dto.js';
import { WalletResponseDto } from './dto/wallet-response.dto.js';
import { LedgerClient } from './ledger.client.js';

@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerClient,
  ) {}

  async create(
    externalRef: string,
    idempotencyKey: string,
    command: CreateWalletDto,
  ): Promise<WalletResponseDto> {
    validateIdempotencyKey(idempotencyKey);
    const requestHash = hashCommand(command);
    const user = await this.ensureUser(externalRef);

    const existingRecord = await this.prisma.db.walletIdempotencyRecord.findUnique({
      where: { userId_key: { userId: user.id, key: idempotencyKey } },
      include: { wallet: true },
    });
    if (existingRecord && existingRecord.requestHash !== requestHash) {
      throw idempotencyMismatch();
    }

    let wallet = existingRecord?.wallet;
    if (!wallet) {
      const sameCurrency = await this.prisma.db.wallet.findUnique({
        where: { userId_currency: { userId: user.id, currency: command.currency } },
      });
      if (sameCurrency) {
        throw new ConflictException({
          code: 'WALLET_ALREADY_EXISTS',
          message: 'A wallet already exists for this currency.',
        });
      }

      try {
        wallet = await this.prisma.db.$transaction(async (transaction) => {
          const created = await transaction.wallet.create({
            data: {
              userId: user.id,
              currency: command.currency,
              label: command.label?.trim(),
              status: 'PENDING',
            },
          });
          await transaction.walletIdempotencyRecord.create({
            data: {
              userId: user.id,
              key: idempotencyKey,
              requestHash,
              walletId: created.id,
            },
          });
          return created;
        });
      } catch (error) {
        if (!isUniqueViolation(error)) {
          throw error;
        }
        const winner = await this.prisma.db.walletIdempotencyRecord.findUnique({
          where: { userId_key: { userId: user.id, key: idempotencyKey } },
          include: { wallet: true },
        });
        if (!winner) {
          throw new ConflictException({
            code: 'WALLET_ALREADY_EXISTS',
            message: 'A wallet already exists for this currency.',
          });
        }
        if (winner.requestHash !== requestHash) {
          throw idempotencyMismatch();
        }
        wallet = winner.wallet;
      }
    }

    const provisioned = await this.ledger.provision(wallet.id, wallet.currency);
    const active = await this.prisma.db.wallet.update({
      where: { id: wallet.id },
      data: { ledgerAccountId: provisioned.ledgerAccountId, status: 'ACTIVE' },
    });
    return toWallet(active, provisioned);
  }

  async list(externalRef: string): Promise<WalletResponseDto[]> {
    const user = await this.ensureUser(externalRef);
    const wallets = await this.prisma.db.wallet.findMany({
      where: { userId: user.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const activeIds = wallets
      .filter((wallet) => wallet.ledgerAccountId !== null)
      .map((wallet) => wallet.id);
    const balances = await this.ledger.getBalances(activeIds);
    return wallets.map((wallet) => toWallet(wallet, balances.get(wallet.id) ?? null));
  }

  async balance(externalRef: string, walletId: string) {
    const user = await this.ensureUser(externalRef);
    const wallet = await this.prisma.db.wallet.findFirst({
      where: { id: walletId, userId: user.id },
    });
    if (!wallet || !wallet.ledgerAccountId) {
      throw walletNotFound();
    }
    return this.ledger.getBalance(wallet.id);
  }

  async validation(walletId: string) {
    const wallet = await this.prisma.db.wallet.findUnique({ where: { id: walletId } });
    if (!wallet) {
      throw walletNotFound();
    }
    return {
      walletId: wallet.id,
      userId: wallet.userId,
      currency: wallet.currency,
      status: wallet.status,
      ledgerAccountId: wallet.ledgerAccountId,
    };
  }

  async reconcile(walletId: string): Promise<WalletResponseDto> {
    const wallet = await this.prisma.db.wallet.findUnique({ where: { id: walletId } });
    if (!wallet) {
      throw walletNotFound();
    }
    const provisioned = await this.ledger.provision(wallet.id, wallet.currency);
    const active = await this.prisma.db.wallet.update({
      where: { id: wallet.id },
      data: { ledgerAccountId: provisioned.ledgerAccountId, status: 'ACTIVE' },
    });
    return toWallet(active, provisioned);
  }

  private ensureUser(externalRef: string) {
    const empty = Buffer.alloc(0);
    return this.prisma.db.user.upsert({
      where: { externalRef },
      update: {},
      create: {
        externalRef,
        identityCiphertext: empty,
        identityIv: empty,
        identityAuthTag: empty,
        encryptedDek: empty,
        dekIv: empty,
        dekAuthTag: empty,
        keyVersion: 'external-principal-v1',
        status: 'ACTIVE',
      },
    });
  }
}

function hashCommand(command: CreateWalletDto): string {
  return createHash('sha256')
    .update(JSON.stringify({ currency: command.currency, label: command.label?.trim() ?? null }))
    .digest('hex');
}

function validateIdempotencyKey(value: string): void {
  if (!/^[\x21-\x7E]{1,128}$/.test(value)) {
    throw new ConflictException({
      code: 'INVALID_IDEMPOTENCY_KEY',
      message: 'Idempotency-Key must contain 1 to 128 visible ASCII characters.',
    });
  }
}

function idempotencyMismatch(): ConflictException {
  return new ConflictException({
    code: 'IDEMPOTENCY_KEY_REUSED',
    message: 'The idempotency key was already used with a different request.',
  });
}

function walletNotFound(): NotFoundException {
  return new NotFoundException({ code: 'WALLET_NOT_FOUND', message: 'Wallet not found.' });
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}

function toWallet(
  wallet: {
    id: string;
    currency: string;
    label: string | null;
    status: string;
    ledgerAccountId: string | null;
  },
  balance: { available: string; currency: string; version: string } | null,
): WalletResponseDto {
  return {
    id: wallet.id,
    currency: wallet.currency,
    label: wallet.label,
    status: wallet.status,
    ledgerAccountId: wallet.ledgerAccountId,
    balance: balance
      ? { available: balance.available, currency: balance.currency, version: balance.version }
      : null,
  };
}
