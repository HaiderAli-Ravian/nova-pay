import { performance } from 'node:perf_hooks';
import { AccountClient, type WalletValidation } from '../clients/account.client.js';
import { FxClient } from '../clients/fx.client.js';
import { LedgerClient } from '../clients/ledger.client.js';
import { RequestContextService } from '../common/request-context.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { TransferService } from '../transfers/transfer.service.js';

const describeWithDatabase = process.env.TRANSFER_TEST_DATABASE_URL ? describe : describe.skip;
const WALLET_ID = '11111111-1111-4111-8111-111111111111';
const COUNTERPARTY_ID = '22222222-2222-4222-8222-222222222222';
const DATASET_ROWS = 25_000;

describeWithDatabase('transaction history scale profile', () => {
  let prisma: PrismaService;
  let service: TransferService;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TRANSFER_TEST_DATABASE_URL;
    process.env.HISTORY_CURSOR_HMAC_KEY = Buffer.alloc(32, 11).toString('base64');
    prisma = new PrismaService();
    await prisma.db.$executeRawUnsafe(
      'TRUNCATE TABLE "transaction_history", "idempotency_records", "transfers" CASCADE',
    );
    await prisma.db.$executeRawUnsafe(`
      INSERT INTO "transfers" (
        "id", "client_id", "type", "status", "sender_wallet_id",
        "recipient_wallet_id", "source_currency", "source_amount",
        "target_currency", "target_amount", "ledger_transaction_id",
        "created_at", "updated_at", "completed_at"
      )
      SELECT
        ('10000000-0000-4000-8000-' || lpad(gs::text, 12, '0'))::uuid,
        'scale-profile', 'DOMESTIC', 'COMPLETED',
        '${WALLET_ID}'::uuid, '${COUNTERPARTY_ID}'::uuid,
        'USD', 10.00000000, 'USD', 10.00000000,
        ('30000000-0000-4000-8000-' || lpad(gs::text, 12, '0'))::uuid,
        TIMESTAMPTZ '2026-01-01 00:00:00+00' + ((gs / 10) * INTERVAL '1 millisecond'),
        TIMESTAMPTZ '2026-01-01 00:00:00+00' + ((gs / 10) * INTERVAL '1 millisecond'),
        TIMESTAMPTZ '2026-01-01 00:00:00+00' + ((gs / 10) * INTERVAL '1 millisecond')
      FROM generate_series(1, ${DATASET_ROWS}) AS gs
    `);
    await prisma.db.$executeRawUnsafe(`
      INSERT INTO "transaction_history" (
        "id", "transfer_id", "wallet_id", "role", "counterparty_wallet_id",
        "status", "amount", "currency", "occurred_at"
      )
      SELECT
        ('20000000-0000-4000-8000-' || lpad(gs::text, 12, '0'))::uuid,
        ('10000000-0000-4000-8000-' || lpad(gs::text, 12, '0'))::uuid,
        '${WALLET_ID}'::uuid, 'SENDER', '${COUNTERPARTY_ID}'::uuid,
        'COMPLETED', 10.00000000, 'USD',
        TIMESTAMPTZ '2026-01-01 00:00:00+00' + ((gs / 10) * INTERVAL '1 millisecond')
      FROM generate_series(1, ${DATASET_ROWS}) AS gs
    `);
    await prisma.db.$executeRawUnsafe('ANALYZE "transaction_history"');
    service = new TransferService(
      prisma,
      new ProfileAccountClient() as unknown as AccountClient,
      {} as LedgerClient,
      {} as FxClient,
      new RequestContextService(),
    );
  }, 30_000);

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('uses the wallet/timestamp/ID index and returns only the bounded page', async () => {
    const boundaryId = '20000000-0000-4000-8000-000000012500';
    const boundaryTime = new Date('2026-01-01T00:00:01.250Z');
    const plan = await prisma.db.$queryRawUnsafe<unknown[]>(`
      EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT "id", "transfer_id", "role", "status", "amount", "currency", "occurred_at"
      FROM "transaction_history"
      WHERE "wallet_id" = '${WALLET_ID}'::uuid
        AND ("occurred_at", "id") < ('${boundaryTime.toISOString()}'::timestamptz, '${boundaryId}'::uuid)
      ORDER BY "occurred_at" DESC, "id" DESC
      LIMIT 51
    `);
    const serializedPlan = JSON.stringify(plan);
    expect(serializedPlan).toContain('transaction_history_wallet_occurred_id_idx');
    expect(serializedPlan).not.toContain('Seq Scan');

    const page = await service.history('scale-profile', WALLET_ID, 50);
    expect(page.items).toHaveLength(50);
    expect(page.nextCursor).toEqual(expect.any(String));
  });

  it('records a bounded concurrent profile without asserting production capacity', async () => {
    const concurrency = 8;
    const requestsPerWorker = 2_500;
    const latencies: number[] = [];
    let errors = 0;
    const started = performance.now();

    await Promise.all(Array.from({ length: concurrency }, async () => {
      let cursor: string | undefined;
      for (let request = 0; request < requestsPerWorker; request += 1) {
        const requestStarted = performance.now();
        try {
          const page = await service.history('scale-profile', WALLET_ID, 50, cursor);
          if (page.items.length > 50) throw new Error('Unbounded history page.');
          cursor = page.nextCursor ?? undefined;
        } catch {
          errors += 1;
          cursor = undefined;
        } finally {
          latencies.push(performance.now() - requestStarted);
        }
      }
    }));

    const durationMs = performance.now() - started;
    latencies.sort((left, right) => left - right);
    const requests = concurrency * requestsPerWorker;
    const evidence = {
      event: 'history.profile.completed',
      datasetRows: DATASET_ROWS,
      requests,
      concurrency,
      durationMs: Number(durationMs.toFixed(2)),
      throughputRps: Number((requests / (durationMs / 1_000)).toFixed(2)),
      p95Ms: Number(percentile(latencies, 0.95).toFixed(2)),
      p99Ms: Number(percentile(latencies, 0.99).toFixed(2)),
      errors,
    };
    process.stdout.write(`${JSON.stringify(evidence)}\n`);

    expect(errors).toBe(0);
    expect(latencies).toHaveLength(requests);
  }, 30_000);
});

class ProfileAccountClient {
  async validation(walletId: string): Promise<WalletValidation> {
    if (walletId !== WALLET_ID) throw new Error('Unexpected wallet.');
    return {
      walletId,
      userId: '44444444-4444-4444-8444-444444444444',
      ownerExternalRef: 'scale-profile',
      currency: 'USD',
      status: 'ACTIVE',
      ledgerAccountId: '55555555-5555-4555-8555-555555555555',
    };
  }
}

function percentile(values: number[], fraction: number): number {
  return values[Math.max(0, Math.ceil(values.length * fraction) - 1)] ?? 0;
}
