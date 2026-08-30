import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { EmployerLeaseService } from './employer-lease.service.js';
import { PAYROLL_QUEUE, PayrollQueueService, type PayrollQueueData } from './payroll-queue.service.js';
import { RedisConnectionService } from './redis-connection.service.js';

const describeWithRedis = process.env.PAYROLL_TEST_REDIS_URL ? describe : describe.skip;

describeWithRedis('Payroll Redis coordination', () => {
  let redis: RedisConnectionService;

  beforeAll(async () => {
    process.env.REDIS_URL = process.env.PAYROLL_TEST_REDIS_URL;
    redis = new RedisConnectionService();
    await redis.connection.flushdb();
  });

  afterAll(async () => {
    await redis.connection.flushdb();
    await redis.onModuleDestroy();
  });

  it('acquires, token-renews, and compare-deletes an employer lease atomically', async () => {
    const leases = new EmployerLeaseService(redis);
    expect(await leases.acquire('employer-a', 'owner-a', 30_000)).toBe(true);
    expect(await leases.acquire('employer-a', 'owner-b', 30_000)).toBe(false);
    expect(await leases.renew('employer-a', 'owner-b', 30_000)).toBe(false);
    expect(await leases.renew('employer-a', 'owner-a', 30_000)).toBe(true);
    expect(await leases.release('employer-a', 'owner-b')).toBe(false);
    expect(await leases.release('employer-a', 'owner-a')).toBe(true);
  });

  it('allows recovery after a lease holder disappears and its TTL expires', async () => {
    const leases = new EmployerLeaseService(redis);
    expect(await leases.acquire('employer-expiry', 'owner-a', 30)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await leases.acquire('employer-expiry', 'owner-b', 30_000)).toBe(true);
    expect(await leases.release('employer-expiry', 'owner-b')).toBe(true);
  });

  it('uses the job UUID as the BullMQ ID with bounded retries and retention', async () => {
    const service = new PayrollQueueService(redis);
    const jobId = randomUUID();
    await service.enqueue(jobId);
    const url = new URL(process.env.PAYROLL_TEST_REDIS_URL as string);
    const inspector = new Queue<PayrollQueueData>(PAYROLL_QUEUE, {
      connection: { host: url.hostname, port: Number(url.port || 6379) },
    });
    const job = await inspector.getJob(jobId);
    expect(job?.id).toBe(jobId);
    expect(job?.opts.attempts).toBe(5);
    expect(job?.opts.backoff).toEqual({ type: 'exponential', delay: 1_000 });
    await job?.remove();
    await inspector.close();
    await service.onModuleDestroy();
  });
});
