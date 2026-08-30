import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from './audit.service.js';

const describeWithDatabase = process.env.ADMIN_TEST_DATABASE_URL ? describe : describe.skip;

describeWithDatabase('immutable audit chain', () => {
  let prisma: PrismaService;
  let service: AuditService;

  beforeAll(() => {
    process.env.DATABASE_URL = process.env.ADMIN_TEST_DATABASE_URL;
    prisma = new PrismaService();
    service = new AuditService(prisma);
  });

  afterAll(async () => prisma.onModuleDestroy());

  it('appends, chains, verifies, and idempotently replays identical events', async () => {
    const streamKey = `transfer:${randomUUID()}`;
    const event = input(streamKey, 'transfer.created');
    const first = await service.append(event);
    const replay = await service.append(event);
    const second = await service.append(input(streamKey, 'transfer.completed'));
    expect(replay).toEqual(first);
    expect(first.sequence).toBe('1');
    expect(second.sequence).toBe('2');
    expect(second.previousHash).toBe(first.currentHash);
    expect(await service.verify(streamKey)).toEqual({
      streamKey,
      valid: true,
      recordsChecked: 2,
      firstInvalidSequence: null,
    });
    await expect(service.append({ ...event, entityId: randomUUID() }))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('serializes concurrent appends into unique contiguous sequences', async () => {
    const streamKey = `payroll:${randomUUID()}`;
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        service.append(input(streamKey, `payroll.item.${index}`))),
    );
    expect(results.map((record) => Number(record.sequence)).sort((a, b) => a - b))
      .toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect((await service.verify(streamKey)).valid).toBe(true);
  });

  it('denies application mutation and detects privileged storage tampering', async () => {
    const streamKey = `audit:${randomUUID()}`;
    const record = await service.append(input(streamKey, 'audit.created'));
    await expect(prisma.db.auditRecord.update({
      where: { eventId: record.eventId },
      data: { action: 'audit.modified' },
    })).rejects.toBeDefined();

    await prisma.db.$executeRawUnsafe(
      'ALTER TABLE "audit_records" DISABLE TRIGGER "audit_records_immutable"',
    );
    try {
      await prisma.db.auditRecord.update({
        where: { eventId: record.eventId },
        data: { action: 'audit.modified' },
      });
    } finally {
      await prisma.db.$executeRawUnsafe(
        'ALTER TABLE "audit_records" ENABLE TRIGGER "audit_records_immutable"',
      );
    }
    expect(await service.verify(streamKey)).toMatchObject({
      valid: false,
      firstInvalidSequence: '1',
    });
  });
});

function input(streamKey: string, action: string) {
  return {
    eventId: randomUUID(),
    streamKey,
    action,
    entityType: 'transfer',
    entityId: randomUUID(),
    actorId: 'transaction-service',
    occurredAt: new Date().toISOString(),
    metadata: { requestId: randomUUID(), status: 'safe' },
  };
}
