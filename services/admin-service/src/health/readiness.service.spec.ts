import { jest } from '@jest/globals';
import { PrismaService } from '../database/prisma.service.js';
import { ReadinessService } from './readiness.service.js';

describe('ReadinessService', () => {
  const prisma = {
    checkConnection: jest.fn(async () => undefined),
  } as unknown as PrismaService;
  const readiness = new ReadinessService(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reports the database as available', async () => {
    await expect(readiness.check()).resolves.toEqual({ database: 'up' });
    expect(prisma.checkConnection).toHaveBeenCalledTimes(1);
  });

  it('returns a stable unavailable error without leaking dependency details', async () => {
    jest
      .mocked(prisma.checkConnection)
      .mockRejectedValueOnce(new Error('connection details'));

    await expect(readiness.check()).rejects.toMatchObject({
      response: {
        code: 'SERVICE_NOT_READY',
        message: 'A required service dependency is unavailable.',
      },
      status: 503,
    });
  });
});
