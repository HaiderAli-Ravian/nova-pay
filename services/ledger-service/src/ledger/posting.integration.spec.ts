import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service.js';
import {
  PostingDirectionDto,
  PostingTypeDto,
  type CreatePostingDto,
} from './dto/ledger-commands.dto.js';
import { LedgerAccountService } from './ledger-account.service.js';
import { LedgerMetricsService } from './ledger-metrics.service.js';
import { PostingService } from './posting.service.js';

const describeWithDatabase = process.env.LEDGER_TEST_DATABASE_URL
  ? describe
  : describe.skip;

describeWithDatabase('PostingService database integration', () => {
  let prisma: PrismaService;
  let accounts: LedgerAccountService;
  let postings: PostingService;

  beforeAll(() => {
    process.env.DATABASE_URL = process.env.LEDGER_TEST_DATABASE_URL;
    process.env.ENABLE_TEST_FUNDING = 'true';
    process.env.NODE_ENV = 'test';
    prisma = new PrismaService();
    accounts = new LedgerAccountService(prisma);
    postings = new PostingService(prisma, new LedgerMetricsService());
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('posts atomically, handles retries and concurrency, then reverses immutably', async () => {
    const sourceWalletId = randomUUID();
    const targetWalletId = randomUUID();
    const rollbackWalletId = randomUUID();
    await Promise.all([
      accounts.provision(sourceWalletId, 'USD'),
      accounts.provision(targetWalletId, 'USD'),
      accounts.provision(rollbackWalletId, 'USD'),
    ]);

    await postings.fund({
      externalReference: randomUUID(),
      requestId: randomUUID(),
      walletId: sourceWalletId,
      amount: '100.00000000',
      currency: 'USD',
    });

    const transfer = transferCommand(sourceWalletId, targetWalletId, '60.00000000');
    const posted = await postings.post(transfer);
    const retried = await postings.post({ ...transfer, requestId: randomUUID() });
    expect(retried.id).toBe(posted.id);

    const mismatch = transferCommand(sourceWalletId, targetWalletId, '1.00000000');
    mismatch.externalReference = transfer.externalReference;
    await expect(postings.post(mismatch)).rejects.toMatchObject({
      response: { code: 'IDEMPOTENCY_KEY_REUSED' },
    });

    await expect(
      postings.post(transferCommand(sourceWalletId, rollbackWalletId, '50.00000000')),
    ).rejects.toMatchObject({ response: { code: 'INSUFFICIENT_FUNDS' } });

    const concurrent = await Promise.allSettled([
      postings.post(transferCommand(sourceWalletId, rollbackWalletId, '30.00000000')),
      postings.post(transferCommand(sourceWalletId, rollbackWalletId, '30.00000000')),
    ]);
    expect(concurrent.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(concurrent.filter((result) => result.status === 'rejected')).toHaveLength(1);

    const beforeRollback = await accounts.balance(sourceWalletId);
    const failedCommand = transferCommand(sourceWalletId, rollbackWalletId, '5.00000000');
    await expect(
      postings.post(failedCommand, { failBeforeCommit: true }),
    ).rejects.toThrow('Injected failure before commit.');
    await expect(postings.byReference(failedCommand.externalReference)).rejects.toMatchObject({
      response: { code: 'POSTING_NOT_FOUND' },
    });
    expect((await accounts.balance(sourceWalletId)).available).toBe(beforeRollback.available);

    const reversal = await postings.reverse(posted.id, {
      externalReference: randomUUID(),
      requestId: randomUUID(),
    });
    expect(reversal.postingType).toBe('REVERSAL');
    expect((await accounts.balance(targetWalletId)).available).toBe('0.00000000');

    await expect(
      prisma.db.$executeRaw`UPDATE "ledger_entries" SET "amount" = "amount" WHERE "ledger_transaction_id" = ${posted.id}::uuid`,
    ).rejects.toThrow(/immutable/);
  });
});

function transferCommand(
  sourceWalletId: string,
  targetWalletId: string,
  amount: string,
): CreatePostingDto {
  return {
    externalReference: randomUUID(),
    requestId: randomUUID(),
    postingType: PostingTypeDto.TRANSFER,
    sourceCurrency: 'USD',
    targetCurrency: 'USD',
    sourceAmount: amount,
    targetAmount: amount,
    entries: [
      {
        walletId: sourceWalletId,
        direction: PostingDirectionDto.DEBIT,
        amount,
        currency: 'USD',
      },
      {
        walletId: targetWalletId,
        direction: PostingDirectionDto.CREDIT,
        amount,
        currency: 'USD',
      },
    ],
  };
}
