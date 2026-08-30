import { randomUUID } from 'node:crypto';
import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { LedgerClient, type LedgerBalance } from './ledger.client.js';
import { WalletService } from './wallet.service.js';

const describeWithDatabase = process.env.ACCOUNT_TEST_DATABASE_URL
  ? describe
  : describe.skip;

describeWithDatabase('WalletService database integration', () => {
  let prisma: PrismaService;
  let ledger: FakeLedgerClient;
  let service: WalletService;

  beforeAll(() => {
    process.env.DATABASE_URL = process.env.ACCOUNT_TEST_DATABASE_URL;
    prisma = new PrismaService();
    ledger = new FakeLedgerClient();
    service = new WalletService(prisma, ledger as unknown as LedgerClient);
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('keeps a wallet pending after provisioning failure and safely reconciles on retry', async () => {
    const principal = `customer-${randomUUID()}`;
    const key = randomUUID();
    ledger.failNextProvision = true;

    await expect(
      service.create(principal, key, { currency: 'USD', label: 'Primary' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    const pending = await prisma.db.wallet.findFirstOrThrow({
      where: { user: { externalRef: principal } },
    });
    expect(pending.status).toBe('PENDING');
    expect(pending.ledgerAccountId).toBeNull();

    const active = await service.create(principal, key, {
      currency: 'USD',
      label: 'Primary',
    });
    expect(active.id).toBe(pending.id);
    expect(active.status).toBe('ACTIVE');
    expect(active.balance?.available).toBe('0.00000000');
    expect(ledger.provisionCalls).toBe(2);
  });

  it('rejects idempotency-key reuse with a different command', async () => {
    const principal = `customer-${randomUUID()}`;
    const key = randomUUID();
    await service.create(principal, key, { currency: 'EUR' });

    await expect(
      service.create(principal, key, { currency: 'GBP' }),
    ).rejects.toMatchObject({
      response: { code: 'IDEMPOTENCY_KEY_REUSED' },
    } satisfies Partial<ConflictException>);
  });

  it('reads balances from the ledger and enforces wallet ownership', async () => {
    const owner = `customer-${randomUUID()}`;
    const stranger = `customer-${randomUUID()}`;
    const wallet = await service.create(owner, randomUUID(), { currency: 'GBP' });
    ledger.setBalance(wallet.id, '42.50000000', 'GBP', '3');

    const listed = await service.list(owner);
    expect(listed[0]?.balance).toEqual({
      available: '42.50000000',
      currency: 'GBP',
      version: '3',
    });
    await expect(service.balance(stranger, wallet.id)).rejects.toMatchObject({
      response: { code: 'WALLET_NOT_FOUND' },
    });
  });
});

class FakeLedgerClient {
  failNextProvision = false;
  provisionCalls = 0;
  private readonly balances = new Map<string, LedgerBalance>();

  async provision(walletId: string, currency: string): Promise<LedgerBalance> {
    this.provisionCalls += 1;
    if (this.failNextProvision) {
      this.failNextProvision = false;
      throw new ServiceUnavailableException();
    }
    const balance = this.balances.get(walletId) ?? {
      walletId,
      ledgerAccountId: randomUUID(),
      available: '0.00000000',
      currency,
      version: '0',
    };
    this.balances.set(walletId, balance);
    return balance;
  }

  async getBalance(walletId: string): Promise<LedgerBalance> {
    return this.balances.get(walletId)!;
  }

  async getBalances(walletIds: string[]): Promise<Map<string, LedgerBalance>> {
    return new Map(walletIds.map((walletId) => [walletId, this.balances.get(walletId)!]));
  }

  setBalance(walletId: string, available: string, currency: string, version: string) {
    const current = this.balances.get(walletId)!;
    this.balances.set(walletId, { ...current, available, currency, version });
  }
}
