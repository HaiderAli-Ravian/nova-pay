import { randomUUID } from 'node:crypto';
import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import type { AccountClient } from '../clients/account.client.js';
import type { TransactionClient, PayrollTransferResponse } from '../clients/transaction.client.js';
import { UpstreamUnavailableError } from '../clients/upstream-error.js';
import { PrismaService } from '../database/prisma.service.js';
import type { EmployerLeaseService } from '../queue/employer-lease.service.js';
import type { PayrollQueueService } from '../queue/payroll-queue.service.js';
import { PayrollProcessorService } from './payroll-processor.service.js';
import { PayrollService } from './payroll.service.js';

const describeWithDatabase = process.env.PAYROLL_TEST_DATABASE_URL ? describe : describe.skip;

class FakeQueue {
  fail = false;
  enqueued: string[] = [];
  async enqueue(jobId: string): Promise<void> {
    if (this.fail) throw new Error('redis unavailable');
    this.enqueued.push(jobId);
  }
}

class FakeAccount {
  async validation(walletId: string) {
    return { walletId, ownerExternalRef: 'employer-a', currency: 'USD', status: 'ACTIVE' };
  }
}

class FakeLease {
  private readonly owners = new Map<string, string>();
  async acquire(employerId: string, token: string): Promise<boolean> {
    if (this.owners.has(employerId)) return false;
    this.owners.set(employerId, token);
    return true;
  }
  async renew(employerId: string, token: string): Promise<boolean> {
    return this.owners.get(employerId) === token;
  }
  async release(employerId: string, token: string): Promise<boolean> {
    if (this.owners.get(employerId) !== token) return false;
    this.owners.delete(employerId);
    return true;
  }
}

class FakeTransactions {
  calls: string[] = [];
  committed = new Map<string, PayrollTransferResponse>();
  failAfterCommitAt: number | undefined;
  delayMs = 0;
  active = 0;
  maxActive = 0;

  async createDomestic(_employer: string, key: string): Promise<PayrollTransferResponse> {
    this.calls.push(key);
    const replay = this.committed.get(key);
    if (replay) return replay;
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    this.active -= 1;
    const response: PayrollTransferResponse = {
      transferId: randomUUID(),
      status: 'COMPLETED',
    };
    this.committed.set(key, response);
    if (this.failAfterCommitAt === this.committed.size) {
      this.failAfterCommitAt = undefined;
      throw new UpstreamUnavailableError('transaction');
    }
    return response;
  }
}

describeWithDatabase('Payroll durable processing', () => {
  let prisma: PrismaService;

  beforeAll(() => {
    process.env.DATABASE_URL = process.env.PAYROLL_TEST_DATABASE_URL;
    prisma = new PrismaService();
  });

  beforeEach(async () => {
    await prisma.db.payrollIdempotencyRecord.deleteMany();
    await prisma.db.payrollItem.deleteMany();
    await prisma.db.payrollJob.deleteMany();
  });

  afterAll(async () => prisma.onModuleDestroy());

  it('persists before enqueue, replays the same job, and rejects a changed payload', async () => {
    const queue = new FakeQueue();
    const service = new PayrollService(
      prisma,
      new FakeAccount() as unknown as AccountClient,
      queue as unknown as PayrollQueueService,
    );
    const request = {
      sourceWalletId: randomUUID(),
      currency: 'USD',
      items: [
        { externalItemId: 'b', recipientWalletId: randomUUID(), amount: '2.00' },
        { externalItemId: 'a', recipientWalletId: randomUUID(), amount: '1.00' },
      ],
    };
    const first = await service.submit('employer-a', 'payroll-key', request);
    const replay = await service.submit('employer-a', 'payroll-key', request);
    expect(replay.jobId).toBe(first.jobId);
    expect(await prisma.db.payrollJob.count()).toBe(1);
    const items = await prisma.db.payrollItem.findMany({ orderBy: { sequence: 'asc' } });
    expect(items.map((item) => item.externalItemId)).toEqual(['a', 'b']);
    expect(items.every((item) => item.transferIdempotencyKey === `payroll:${first.jobId}:${item.id}`)).toBe(true);
    await expect(service.submit('employer-a', 'payroll-key', {
      ...request,
      items: [{ ...request.items[0]!, amount: '3.00' }],
    })).rejects.toBeInstanceOf(ConflictException);
  });

  it('keeps a queue-outage submission durable and enqueues it on retry', async () => {
    const queue = new FakeQueue();
    queue.fail = true;
    const service = new PayrollService(
      prisma,
      new FakeAccount() as unknown as AccountClient,
      queue as unknown as PayrollQueueService,
    );
    const request = {
      sourceWalletId: randomUUID(),
      currency: 'USD',
      items: [{ externalItemId: 'a', recipientWalletId: randomUUID(), amount: '1.00' }],
    };
    await expect(service.submit('employer-a', 'queue-recovery', request))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(await prisma.db.payrollJob.count()).toBe(1);
    queue.fail = false;
    const replay = await service.submit('employer-a', 'queue-recovery', request);
    expect(queue.enqueued).toEqual([replay.jobId]);
  });

  it('resumes a scaled 14-item job after an ambiguous sixth transfer without repaying checkpoints', async () => {
    const jobId = await seedJob(prisma, 'employer-a', 14);
    const transactions = new FakeTransactions();
    transactions.failAfterCommitAt = 6;
    const processor = new PayrollProcessorService(
      prisma,
      new FakeLease() as unknown as EmployerLeaseService,
      transactions as unknown as TransactionClient,
    );
    await expect(processor.process(jobId)).rejects.toBeInstanceOf(UpstreamUnavailableError);
    expect((await prisma.db.payrollJob.findUniqueOrThrow({ where: { id: jobId } })).completedItems).toBe(5);
    await processor.process(jobId);
    const job = await prisma.db.payrollJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job).toMatchObject({ status: 'COMPLETED', completedItems: 14, failedItems: 0 });
    expect(transactions.committed.size).toBe(14);
    expect(new Set(transactions.calls).size).toBe(14);
    expect(transactions.calls).toHaveLength(15);
  });

  it('serializes the same employer while allowing different employers to progress concurrently', async () => {
    const lease = new FakeLease();
    const transactions = new FakeTransactions();
    transactions.delayMs = 20;
    const processor = new PayrollProcessorService(
      prisma,
      lease as unknown as EmployerLeaseService,
      transactions as unknown as TransactionClient,
    );
    const sameA = await seedJob(prisma, 'employer-a', 1);
    const sameB = await seedJob(prisma, 'employer-a', 1);
    const first = processor.process(sameA);
    await expect(processor.process(sameB)).rejects.toThrow('EMPLOYER_LEASE_BUSY');
    await first;
    await processor.process(sameB);

    transactions.maxActive = 0;
    const otherA = await seedJob(prisma, 'employer-a', 1);
    const otherB = await seedJob(prisma, 'employer-b', 1);
    await Promise.all([processor.process(otherA), processor.process(otherB)]);
    expect(transactions.maxActive).toBe(2);
  });
});

async function seedJob(prisma: PrismaService, employerId: string, count: number): Promise<string> {
  const jobId = randomUUID();
  await prisma.db.payrollJob.create({
    data: {
      id: jobId,
      employerId,
      sourceWalletId: randomUUID(),
      currency: 'USD',
      totalItems: count,
      totalAmount: String(count),
      status: 'QUEUED',
      items: {
        create: Array.from({ length: count }, (_, sequence) => {
          const id = randomUUID();
          return {
            id,
            sequence,
            externalItemId: `employee-${sequence}`,
            recipientWalletId: randomUUID(),
            amount: '1.00',
            currency: 'USD',
            transferIdempotencyKey: `payroll:${jobId}:${id}`,
          };
        }),
      },
    },
  });
  return jobId;
}
