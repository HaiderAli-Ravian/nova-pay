import { jest } from '@jest/globals';
import type { PrismaService } from '../database/prisma.service.js';
import type { PayrollQueueService } from './payroll-queue.service.js';
import { PayrollRecoveryService } from './payroll-recovery.service.js';

describe('PayrollRecoveryService', () => {
  it('re-enqueues every bounded nonterminal job returned by PostgreSQL', async () => {
    const findMany = jest.fn<() => Promise<Array<{ id: string }>>>()
      .mockResolvedValue([{ id: 'job-a' }, { id: 'job-b' }]);
    const enqueue = jest.fn<(id: string) => Promise<void>>().mockResolvedValue();
    const service = new PayrollRecoveryService(
      { db: { payrollJob: { findMany } } } as unknown as PrismaService,
      { enqueue } as unknown as PayrollQueueService,
    );
    await service.recover();
    expect(enqueue.mock.calls).toEqual([['job-a'], ['job-b']]);
  });
});
