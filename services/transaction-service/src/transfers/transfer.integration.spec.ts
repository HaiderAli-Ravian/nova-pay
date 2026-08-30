import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service.js';
import { RequestContextService } from '../common/request-context.service.js';
import { AccountClient, type WalletValidation } from '../clients/account.client.js';
import { FxClient, type ConsumeQuoteCommand, type ConsumedQuote } from '../clients/fx.client.js';
import { LedgerClient, type PostingCommand, type LedgerPosting } from '../clients/ledger.client.js';
import { UpstreamHttpError, UpstreamUnavailableError } from '../clients/upstream-error.js';
import { HistoryProjectionService } from '../history/history-projection.service.js';
import { TransferService } from './transfer.service.js';

const describeWithDatabase = process.env.TRANSFER_TEST_DATABASE_URL
  ? describe
  : describe.skip;

describeWithDatabase('TransferService database integration', () => {
  let prisma: PrismaService;
  let account: FakeAccountClient;
  let ledger: FakeLedgerClient;
  let fx: FakeFxClient;
  let service: TransferService;

  beforeAll(() => {
    process.env.DATABASE_URL = process.env.TRANSFER_TEST_DATABASE_URL;
    process.env.STALE_PROCESSING_MS = '30000';
    process.env.HISTORY_CURSOR_HMAC_KEY = Buffer.alloc(32, 9).toString('base64');
    prisma = new PrismaService();
  });

  beforeEach(async () => {
    await prisma.db.transactionHistory.deleteMany();
    await prisma.db.idempotencyRecord.deleteMany();
    await prisma.db.transfer.deleteMany();
    account = new FakeAccountClient();
    ledger = new FakeLedgerClient();
    fx = new FakeFxClient();
    service = new TransferService(
      prisma,
      account as unknown as AccountClient,
      ledger as unknown as LedgerClient,
      fx as unknown as FxClient,
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
    await expect(service.history('bob', setup.recipientId, 2, first.nextCursor!)).rejects
      .toMatchObject({ response: { code: 'INVALID_CURSOR' } });
  });

  it('paginates equal timestamps by descending ID without duplicates or gaps', async () => {
    const setup = walletSetup(account);
    for (const amount of ['1', '2', '3', '4', '5']) {
      await service.createDomestic('alice', randomUUID(), { ...setup.command, amount });
    }
    const occurredAt = new Date('2026-08-30T12:00:00.000Z');
    await prisma.db.transactionHistory.updateMany({
      where: { walletId: setup.senderId },
      data: { occurredAt },
    });
    const expected = await prisma.db.transactionHistory.findMany({
      where: { walletId: setup.senderId },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      select: { transferId: true },
    });
    const actual: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await service.history('alice', setup.senderId, 2, cursor);
      actual.push(...page.items.map((item) => item.transferId));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    expect(actual).toEqual(expected.map((row) => row.transferId));
    expect(new Set(actual).size).toBe(5);
  });

  it('repairs missing, corrupted, and stale projection rows from transfer-owned data', async () => {
    const setup = walletSetup(account);
    const completed = await service.createDomestic('alice', randomUUID(), setup.command);
    await prisma.db.transactionHistory.updateMany({
      where: { transferId: completed.body.transferId, role: 'SENDER' },
      data: { amount: '999.00000000', status: 'FAILED' },
    });
    await prisma.db.transactionHistory.deleteMany({
      where: { transferId: completed.body.transferId, role: 'RECIPIENT' },
    });
    await prisma.db.transactionHistory.create({
      data: {
        transferId: completed.body.transferId,
        walletId: randomUUID(),
        role: 'RECIPIENT',
        counterpartyWalletId: setup.senderId,
        status: 'FAILED',
        amount: '1.00000000',
        currency: 'USD',
        occurredAt: new Date('2020-01-01T00:00:00.000Z'),
      },
    });

    const result = await new HistoryProjectionService(prisma).rebuild(1);
    const rows = await prisma.db.transactionHistory.findMany({
      where: { transferId: completed.body.transferId },
      orderBy: { role: 'asc' },
    });

    expect(result).toMatchObject({ transfersScanned: 1, rowsWritten: 2, rowsRemoved: 1 });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === 'COMPLETED')).toBe(true);
    expect(rows.map((row) => row.amount.toFixed(8))).toEqual([
      '10.00000000',
      '10.00000000',
    ]);
    expect(rows.map((row) => row.walletId)).toEqual(
      expect.arrayContaining([setup.senderId, setup.recipientId]),
    );
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

  it('executes an international transfer with consumed quote terms on Ledger and history', async () => {
    const setup = walletSetup(account, 'USD', 'EUR');
    const quoteId = randomUUID();
    const first = await service.createInternational('alice', randomUUID(), {
      senderWalletId: setup.senderId,
      recipientWalletId: setup.recipientId,
      sourceAmount: '100.00000000',
      sourceCurrency: 'USD',
      targetCurrency: 'EUR',
      quoteId,
    });

    expect(first).toMatchObject({
      httpStatus: 201,
      body: {
        status: 'COMPLETED',
        sourceAmount: '100.00000000',
        targetAmount: '92.00000000',
        quoteId,
        lockedRate: '0.920000000000',
      },
    });
    expect(fx.consumeCalls).toBe(1);
    expect(ledger.lastCommand).toMatchObject({
      postingType: 'FX_TRANSFER',
      sourceAmount: '100.00000000',
      targetAmount: '92.00000000',
      fxQuoteId: quoteId,
      lockedFxRate: '0.920000000000',
    });
    const history = await prisma.db.transactionHistory.findMany({
      where: { transferId: first.body.transferId },
      orderBy: { role: 'asc' },
    });
    expect(history.map((row) => [row.currency, row.amount.toFixed(8)])).toEqual(
      expect.arrayContaining([['USD', '100.00000000'], ['EUR', '92.00000000']]),
    );
  });

  it('keeps an unavailable FX preparation pending and resumes with the same transfer', async () => {
    const setup = walletSetup(account, 'USD', 'EUR');
    const key = randomUUID();
    fx.mode = 'unavailable';
    const command = {
      senderWalletId: setup.senderId,
      recipientWalletId: setup.recipientId,
      sourceAmount: '100.00000000',
      sourceCurrency: 'USD',
      targetCurrency: 'EUR',
      quoteId: randomUUID(),
    };
    const first = await service.createInternational('alice', key, command);
    expect(first).toMatchObject({ httpStatus: 202, body: { status: 'PENDING' } });

    fx.mode = 'normal';
    const replay = await service.createInternational('alice', key, command);
    expect(replay).toMatchObject({ httpStatus: 201, body: { status: 'COMPLETED' } });
    expect(replay.body.transferId).toBe(first.body.transferId);
  });

  it('does not release a consumed quote after a downstream failure', async () => {
    const setup = walletSetup(account, 'USD', 'EUR');
    const quoteId = randomUUID();
    ledger.mode = 'insufficient-funds';
    const result = await service.createInternational('alice', randomUUID(), {
      senderWalletId: setup.senderId,
      recipientWalletId: setup.recipientId,
      sourceAmount: '100.00000000',
      sourceCurrency: 'USD',
      targetCurrency: 'EUR',
      quoteId,
    });
    expect(result).toMatchObject({
      httpStatus: 422,
      body: { status: 'FAILED', failure: { code: 'INSUFFICIENT_FUNDS' } },
    });
    expect(fx.consumedBy.get(quoteId)).toBe(result.body.transferId);
  });

  it('stores and replays a definitive expired quote failure', async () => {
    const setup = walletSetup(account, 'USD', 'EUR');
    const key = randomUUID();
    fx.mode = 'expired';
    const command = {
      senderWalletId: setup.senderId,
      recipientWalletId: setup.recipientId,
      sourceAmount: '100.00000000',
      sourceCurrency: 'USD',
      targetCurrency: 'EUR',
      quoteId: randomUUID(),
    };
    const first = await service.createInternational('alice', key, command);
    const replay = await service.createInternational('alice', key, command);
    expect(first).toMatchObject({
      httpStatus: 409,
      body: { status: 'FAILED', failure: { code: 'QUOTE_EXPIRED' } },
    });
    expect(replay).toEqual(first);
    expect(fx.consumeCalls).toBe(1);
    expect(ledger.postCalls).toBe(0);
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
  lastCommand: PostingCommand | undefined;
  private readonly postings = new Map<string, LedgerPosting>();

  async post(command: PostingCommand): Promise<LedgerPosting> {
    this.postCalls += 1;
    this.lastCommand = command;
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

class FakeFxClient {
  mode: 'normal' | 'unavailable' | 'expired' = 'normal';
  consumeCalls = 0;
  readonly consumedBy = new Map<string, string>();

  async consume(quoteId: string, command: ConsumeQuoteCommand): Promise<ConsumedQuote> {
    this.consumeCalls += 1;
    if (this.mode === 'unavailable') throw new UpstreamUnavailableError('fx');
    if (this.mode === 'expired') {
      throw new UpstreamHttpError('fx', 409, 'QUOTE_EXPIRED', 'The FX quote has expired.');
    }
    const prior = this.consumedBy.get(quoteId);
    if (prior && prior !== command.transferId) {
      throw new UpstreamHttpError(
        'fx',
        409,
        'QUOTE_ALREADY_USED',
        'The quote was already consumed by another transfer.',
      );
    }
    this.consumedBy.set(quoteId, command.transferId);
    const issuedAt = new Date();
    return {
      quoteId,
      sourceCurrency: command.sourceCurrency,
      targetCurrency: command.targetCurrency,
      sourceAmount: command.sourceAmount,
      targetAmount: '92.00000000',
      rate: '0.920000000000',
      status: 'CONSUMED',
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(issuedAt.getTime() + 60_000).toISOString(),
    };
  }
}

function walletSetup(
  account: FakeAccountClient,
  senderCurrency = 'USD',
  recipientCurrency = senderCurrency,
) {
  const senderId = randomUUID();
  const recipientId = randomUUID();
  account.wallets.set(senderId, {
    walletId: senderId,
    userId: randomUUID(),
    ownerExternalRef: 'alice',
    currency: senderCurrency,
    status: 'ACTIVE',
    ledgerAccountId: randomUUID(),
  });
  account.wallets.set(recipientId, {
    walletId: recipientId,
    userId: randomUUID(),
    ownerExternalRef: 'bob',
    currency: recipientCurrency,
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
      currency: senderCurrency,
    },
  };
}
