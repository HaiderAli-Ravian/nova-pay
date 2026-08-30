import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service.js';
import { RequestContextService } from '../common/request-context.service.js';
import { AccountClient, type WalletValidation } from '../clients/account.client.js';
import { LedgerClient, type DomesticPostingCommand, type LedgerPosting } from '../clients/ledger.client.js';
import { UpstreamHttpError, UpstreamUnavailableError } from '../clients/upstream-error.js';
import { TransferService } from './transfer.service.js';

const describeWithDatabase = process.env.TRANSFER_TEST_DATABASE_URL
  ? describe
  : describe.skip;

describeWithDatabase('TransferService database integration', () => {
  let prisma: PrismaService;
  let account: FakeAccountClient;
  let ledger: FakeLedgerClient;
  let service: TransferService;

  beforeAll(() => {
    process.env.DATABASE_URL = process.env.TRANSFER_TEST_DATABASE_URL;
    process.env.STALE_PROCESSING_MS = '30000';
    prisma = new PrismaService();
  });

  beforeEach(async () => {
    await prisma.db.transactionHistory.deleteMany();
    await prisma.db.idempotencyRecord.deleteMany();
    await prisma.db.transfer.deleteMany();
    account = new FakeAccountClient();
    ledger = new FakeLedgerClient();
    service = new TransferService(
      prisma,
      account as unknown as AccountClient,
      ledger as unknown as LedgerClient,
      new RequestContextService(),
    );
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('scenario A replays one completed transfer and builds both history projections', async () => {
    const setup = walletSetup(account);
    const key = randomUUID();
    const first = await service.createDomestic('alice', key, {
      ...setup.command,
      amount: '10.00000000',
    });
    const replay = await service.createDomestic('alice', key, {
      ...setup.command,
      amount: '10.0',
    });

    expect(first.httpStatus).toBe(201);
    expect(replay.body.transferId).toBe(first.body.transferId);
    expect(ledger.postCalls).toBe(1);
    expect(await prisma.db.transfer.count()).toBe(1);
    expect(await prisma.db.transactionHistory.count()).toBe(2);
    expect((await service.history('alice', setup.senderId, 50)).items[0]?.direction).toBe(
      'OUTGOING',
    );
    expect((await service.history('bob', setup.recipientId, 50)).items[0]?.direction).toBe(
      'INCOMING',
    );
    await expect(
      service.getForPrincipal('bob', first.body.transferId),
    ).resolves.toMatchObject({ status: 'COMPLETED' });
  });

  it('seeks wallet history with an opaque cursor and enforces ownership', async () => {
    const setup = walletSetup(account);
    for (const amount of ['1.00000000', '2.00000000', '3.00000000']) {
      await service.createDomestic('alice', randomUUID(), { ...setup.command, amount });
    }

    const first = await service.history('alice', setup.senderId, 2);
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toEqual(expect.any(String));

    const second = await service.history('alice', setup.senderId, 2, first.nextCursor!);
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map((item) => item.transferId)).size).toBe(3);

    await expect(service.history('mallory', setup.senderId, 2)).rejects.toMatchObject({
      response: { code: 'WALLET_ACCESS_DENIED' },
    });
    await expect(service.history('alice', setup.senderId, 2, 'tampered')).rejects.toMatchObject({
      response: { code: 'INVALID_CURSOR' },
    });
  });

  it('scenario B gives concurrent identical requests one database winner and one posting', async () => {
    const setup = walletSetup(account);
    ledger.delayMs = 30;
    const key = randomUUID();
    const results = await Promise.all([
      service.createDomestic('alice', key, setup.command),
      service.createDomestic('alice', key, setup.command),
      service.createDomestic('alice', key, setup.command),
    ]);

    expect(new Set(results.map((result) => result.body.transferId)).size).toBe(1);
    expect(ledger.postCalls).toBe(1);
    expect(await prisma.db.transfer.count()).toBe(1);
    expect(await prisma.db.idempotencyRecord.count()).toBe(1);
    await expect(service.getInternal(results[0]!.body.transferId)).resolves.toMatchObject({
      status: 'COMPLETED',
    });
  });

  it('scenario C reconciles a committed posting after its response is lost', async () => {
    const setup = walletSetup(account);
    ledger.mode = 'commit-then-unavailable';
    const key = randomUUID();
    const first = await service.createDomestic('alice', key, setup.command);
    expect(first.httpStatus).toBe(202);
    expect(first.body.status).toBe('PROCESSING');

    const replay = await service.createDomestic('alice', key, setup.command);
    expect(replay.httpStatus).toBe(201);
    expect(replay.body.status).toBe('COMPLETED');
    expect(ledger.postCalls).toBe(1);
  });

  it('scenario D retains an expired key tombstone and makes no new movement', async () => {
    const setup = walletSetup(account);
    const key = randomUUID();
    const first = await service.createDomestic('alice', key, setup.command);
    await prisma.db.idempotencyRecord.update({
      where: { transferId: first.body.transferId },
      data: { replayExpiresAt: new Date(Date.now() - 1_000) },
    });

    await expect(service.createDomestic('alice', key, setup.command)).rejects.toMatchObject({
      response: { code: 'IDEMPOTENCY_KEY_EXPIRED' },
    });
    expect(ledger.postCalls).toBe(1);
  });

  it('scenario E rejects a reused key with a different canonical payload', async () => {
    const setup = walletSetup(account);
    const key = randomUUID();
    await service.createDomestic('alice', key, setup.command);

    await expect(
      service.createDomestic('alice', key, { ...setup.command, amount: '11.00000000' }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' } });
    expect(ledger.postCalls).toBe(1);
  });

  it('stores and replays a definitive insufficient-funds failure', async () => {
    const setup = walletSetup(account);
    ledger.mode = 'insufficient-funds';
    const key = randomUUID();
    const first = await service.createDomestic('alice', key, setup.command);
    const replay = await service.createDomestic('alice', key, setup.command);

    expect(first).toMatchObject({
      httpStatus: 422,
      body: { status: 'FAILED', failure: { code: 'INSUFFICIENT_FUNDS' } },
    });
    expect(replay).toEqual(first);
    expect(ledger.postCalls).toBe(1);
  });

  it('retries a stale processing transfer only after confirming no posting exists', async () => {
    const setup = walletSetup(account);
    ledger.mode = 'unavailable-before-commit';
    const first = await service.createDomestic('alice', randomUUID(), setup.command);
    expect(first.body.status).toBe('PROCESSING');

    ledger.mode = 'normal';
    const reconciled = await service.reconcile(first.body.transferId, true);
    expect(reconciled.body.status).toBe('COMPLETED');
    expect(ledger.byReferenceCalls).toBe(1);
    expect(ledger.postCalls).toBe(2);
  });

  it('gives concurrent reconciliation retries one database winner', async () => {
    const setup = walletSetup(account);
    ledger.mode = 'unavailable-before-commit';
    const first = await service.createDomestic('alice', randomUUID(), setup.command);
    expect(first.body.status).toBe('PROCESSING');

    ledger.mode = 'normal';
    ledger.delayMs = 30;
    const results = await Promise.all([
      service.reconcile(first.body.transferId, true),
      service.reconcile(first.body.transferId, true),
      service.reconcile(first.body.transferId, true),
    ]);

    expect(ledger.postCalls).toBe(2);
    expect(results.some((result) => result.body.status === 'COMPLETED')).toBe(true);
    await expect(service.getInternal(first.body.transferId)).resolves.toMatchObject({
      status: 'COMPLETED',
    });
  });

  it('fails closed on wallet ownership and currency mismatches', async () => {
    const setup = walletSetup(account);
    const denied = await service.createDomestic('mallory', randomUUID(), setup.command);
    expect(denied).toMatchObject({
      httpStatus: 403,
      body: { status: 'FAILED', failure: { code: 'WALLET_ACCESS_DENIED' } },
    });

    const second = walletSetup(account, 'EUR');
    const mismatch = await service.createDomestic('alice', randomUUID(), {
      ...second.command,
      currency: 'USD',
    });
    expect(mismatch).toMatchObject({
      httpStatus: 409,
      body: { status: 'FAILED', failure: { code: 'CURRENCY_MISMATCH' } },
    });
    expect(ledger.postCalls).toBe(0);
  });

  it('maps internal Account authentication failures to a safe dependency error', async () => {
    const setup = walletSetup(account);
    account.error = new UpstreamHttpError(
      'account',
      401,
      'INTERNAL_AUTH_REQUIRED',
      'Internal service authentication failed.',
    );

    const result = await service.createDomestic('alice', randomUUID(), setup.command);
    expect(result).toMatchObject({
      httpStatus: 503,
      body: { status: 'FAILED', failure: { code: 'ACCOUNT_UNAVAILABLE' } },
    });
    expect(ledger.postCalls).toBe(0);
  });

  it('keeps internal Ledger authentication failures recoverable without leaking them', async () => {
    const setup = walletSetup(account);
    ledger.mode = 'internal-auth';

    const result = await service.createDomestic('alice', randomUUID(), setup.command);
    expect(result).toMatchObject({ httpStatus: 202, body: { status: 'PROCESSING' } });
  });

  it('enforces lifecycle transitions in PostgreSQL', async () => {
    const setup = walletSetup(account);
    const completed = await service.createDomestic('alice', randomUUID(), setup.command);

    await expect(
      prisma.db.transfer.update({
        where: { id: completed.body.transferId },
        data: { status: 'PROCESSING' },
      }),
    ).rejects.toThrow(/invalid transfer status transition/);
  });
});

class FakeAccountClient {
  readonly wallets = new Map<string, WalletValidation>();
  error: Error | undefined;

  async validation(walletId: string): Promise<WalletValidation> {
    if (this.error) throw this.error;
    const wallet = this.wallets.get(walletId);
    if (!wallet) {
      throw new UpstreamHttpError('account', 404, 'WALLET_NOT_FOUND', 'Wallet not found.');
    }
    return wallet;
  }
}

class FakeLedgerClient {
  mode:
    | 'normal'
    | 'commit-then-unavailable'
    | 'unavailable-before-commit'
    | 'insufficient-funds'
    | 'internal-auth' = 'normal';
  delayMs = 0;
  postCalls = 0;
  byReferenceCalls = 0;
  private readonly postings = new Map<string, LedgerPosting>();

  async post(command: DomesticPostingCommand): Promise<LedgerPosting> {
    this.postCalls += 1;
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    if (this.mode === 'unavailable-before-commit') {
      throw new UpstreamUnavailableError('ledger');
    }
    if (this.mode === 'insufficient-funds') {
      throw new UpstreamHttpError(
        'ledger',
        422,
        'INSUFFICIENT_FUNDS',
        'The wallet has insufficient available funds.',
      );
    }
    if (this.mode === 'internal-auth') {
      throw new UpstreamHttpError(
        'ledger',
        401,
        'INTERNAL_AUTH_REQUIRED',
        'Internal service authentication failed.',
      );
    }
    const posting: LedgerPosting = {
      id: randomUUID(),
      externalReference: command.externalReference,
      status: 'POSTED',
      postingType: command.postingType,
      entries: command.entries.map((entry) => ({
        ledgerAccountId: randomUUID(),
        direction: entry.direction,
        amount: entry.amount,
        currency: entry.currency,
      })),
    };
    this.postings.set(command.externalReference, posting);
    if (this.mode === 'commit-then-unavailable') {
      this.mode = 'normal';
      throw new UpstreamUnavailableError('ledger');
    }
    return posting;
  }

  async byReference(externalReference: string): Promise<LedgerPosting | null> {
    this.byReferenceCalls += 1;
    return this.postings.get(externalReference) ?? null;
  }
}

function walletSetup(account: FakeAccountClient, currency = 'USD') {
  const senderId = randomUUID();
  const recipientId = randomUUID();
  account.wallets.set(senderId, {
    walletId: senderId,
    userId: randomUUID(),
    ownerExternalRef: 'alice',
    currency,
    status: 'ACTIVE',
    ledgerAccountId: randomUUID(),
  });
  account.wallets.set(recipientId, {
    walletId: recipientId,
    userId: randomUUID(),
    ownerExternalRef: 'bob',
    currency,
    status: 'ACTIVE',
    ledgerAccountId: randomUUID(),
  });
  return {
    senderId,
    recipientId,
    command: {
      senderWalletId: senderId,
      recipientWalletId: recipientId,
      amount: '10.00000000',
      currency,
    },
  };
}
