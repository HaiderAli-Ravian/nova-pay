import { randomUUID } from 'node:crypto';
import { Prisma } from '../generated/prisma/client.js';
import { RequestContextService } from '../common/request-context.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { DeterministicFxProvider } from './fx-provider.js';
import { QuoteService } from './quote.service.js';

const describeWithDatabase = process.env.FX_TEST_DATABASE_URL ? describe : describe.skip;

describeWithDatabase('QuoteService database integration', () => {
  let prisma: PrismaService;
  let service: QuoteService;

  beforeAll(() => {
    process.env.DATABASE_URL = process.env.FX_TEST_DATABASE_URL;
    prisma = new PrismaService();
  });

  beforeEach(async () => {
    process.env.FX_PROVIDER_MODE = 'normal';
    await prisma.db.fxQuote.deleteMany();
    service = new QuoteService(prisma, new DeterministicFxProvider(), new RequestContextService());
  });

  afterAll(async () => prisma.onModuleDestroy());

  it('fetches a fresh provider result and persists an exact 60-second quote', async () => {
    const first = await service.create('alice', command());
    const second = await service.create('alice', command());

    expect(first.rate).toBe('0.920000000000');
    expect(first.targetAmount).toBe('92.00000000');
    expect(new Date(first.expiresAt).getTime() - new Date(first.issuedAt).getTime()).toBe(60_000);
    const rows = await prisma.db.fxQuote.findMany({ orderBy: { issuedAt: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.providerReference).not.toBe(rows[1]!.providerReference);
    expect(second.quoteId).not.toBe(first.quoteId);
  });

  it('returns ownership-scoped validity and rejects another principal', async () => {
    const quote = await service.create('alice', command());
    await expect(service.get('alice', quote.quoteId)).resolves.toMatchObject({
      valid: true,
      status: 'ACTIVE',
      remainingSeconds: expect.any(Number),
    });
    await expect(service.get('mallory', quote.quoteId)).rejects.toMatchObject({
      response: { code: 'QUOTE_ACCESS_DENIED' },
    });
  });

  it('consumes once and makes retry by the same transfer idempotent', async () => {
    const quote = await service.create('alice', command());
    const transferId = randomUUID();
    const consume = { ...command(), transferId, clientId: 'alice' };
    const first = await service.consume(quote.quoteId, consume);
    const replay = await service.consume(quote.quoteId, consume);
    expect(first.status).toBe('CONSUMED');
    expect(replay).toEqual(first);
  });

  it('gives simultaneous consumers exactly one winner', async () => {
    const quote = await service.create('alice', command());
    const attempts = await Promise.allSettled([
      service.consume(quote.quoteId, { ...command(), transferId: randomUUID(), clientId: 'alice' }),
      service.consume(quote.quoteId, { ...command(), transferId: randomUUID(), clientId: 'alice' }),
    ]);
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await prisma.db.fxQuote.count({ where: { status: 'CONSUMED' } })).toBe(1);
  });

  it('rejects an expired quote at the database-time boundary', async () => {
    const issuedAt = new Date(Date.now() - 61_000);
    const quote = await prisma.db.fxQuote.create({
      data: {
        clientId: 'alice',
        sourceCurrency: 'USD',
        targetCurrency: 'EUR',
        sourceAmount: new Prisma.Decimal('100'),
        targetAmount: new Prisma.Decimal('92'),
        rate: new Prisma.Decimal('0.92'),
        providerReference: 'expired-fixture',
        issuedAt,
        expiresAt: new Date(issuedAt.getTime() + 60_000),
        createdRequestId: randomUUID(),
      },
    });
    await expect(
      service.consume(quote.id, { ...command(), transferId: randomUUID(), clientId: 'alice' }),
    ).rejects.toMatchObject({ response: { code: 'QUOTE_EXPIRED' } });
    await expect(service.get('alice', quote.id)).resolves.toMatchObject({
      status: 'EXPIRED',
      valid: false,
      remainingSeconds: 0,
    });
  });

  it('rejects mismatched transfer details without consuming the quote', async () => {
    const quote = await service.create('alice', command());
    await expect(
      service.consume(quote.quoteId, {
        ...command(),
        sourceAmount: '101.00000000',
        transferId: randomUUID(),
        clientId: 'alice',
      }),
    ).rejects.toMatchObject({ response: { code: 'QUOTE_DETAILS_MISMATCH' } });
    expect((await prisma.db.fxQuote.findUniqueOrThrow({ where: { id: quote.quoteId } })).status).toBe('ACTIVE');
  });

  it('returns an explicit provider failure and persists no cached substitute', async () => {
    process.env.FX_PROVIDER_MODE = 'unavailable';
    await expect(service.create('alice', command())).rejects.toMatchObject({
      response: { code: 'FX_PROVIDER_UNAVAILABLE' },
    });
    expect(await prisma.db.fxQuote.count()).toBe(0);
  });
});

function command() {
  return { sourceCurrency: 'USD', targetCurrency: 'EUR', sourceAmount: '100.00000000' };
}
