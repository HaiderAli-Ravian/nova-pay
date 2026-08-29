import { HealthController } from './health.controller.js';
import { ReadinessService } from './readiness.service.js';

describe('HealthController', () => {
  const controller = new HealthController({
    check: async () => ({ database: 'up' }),
  } as ReadinessService);

  it.each(['live', 'ready'] as const)(
    'returns a typed healthy response from %s',
    async (method) => {
      const result = await controller[method]();

      expect(result).toEqual({
        status: 'ok',
        service: 'admin-service',
        timestamp: expect.any(String),
        uptimeSeconds: expect.any(Number),
        ...(method === 'ready' ? { dependencies: { database: 'up' } } : {}),
      });
      expect(Number.isNaN(Date.parse(result.timestamp))).toBe(false);
      expect(result.uptimeSeconds).toBeGreaterThanOrEqual(0);
    },
  );
});
