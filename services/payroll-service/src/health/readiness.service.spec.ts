import { jest } from '@jest/globals';
import { PrismaService } from '../database/prisma.service.js';
import { ReadinessService } from './readiness.service.js';
import { RedisReadinessIndicator } from './redis-readiness.indicator.js';

describe('ReadinessService', () => {
  const prisma = {
    checkConnection: jest.fn(async () => undefined),
  } as unknown as PrismaService;
  const redis = {
    checkConnection: jest.fn(async () => undefined),
  } as unknown as RedisReadinessIndicator;
  const readiness = new ReadinessService(prisma, redis);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reports PostgreSQL and Redis as available', async () => {
    await expect(readiness.check()).resolves.toEqual({
      database: 'up',
      redis: 'up',
    });
  });

  it.each([
    ['database', prisma.checkConnection],
    ['redis', redis.checkConnection],
  ] as const)('returns 503 when %s is unavailable', async (_name, check) => {
    jest.mocked(check).mockRejectedValueOnce(new Error('dependency details'));

    await expect(readiness.check()).rejects.toMatchObject({
      response: {
        code: 'SERVICE_NOT_READY',
        message: 'A required service dependency is unavailable.',
      },
      status: 503,
    });
  });
});
