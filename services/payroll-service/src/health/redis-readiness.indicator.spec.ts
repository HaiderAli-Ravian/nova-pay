import { RedisReadinessIndicator } from './redis-readiness.indicator.js';

describe('RedisReadinessIndicator', () => {
  const originalRedisUrl = process.env.REDIS_URL;
  const indicator = new RedisReadinessIndicator();

  afterEach(() => {
    if (originalRedisUrl === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = originalRedisUrl;
    }
  });

  it('rejects a missing Redis URL', async () => {
    delete process.env.REDIS_URL;
    await expect(indicator.checkConnection()).rejects.toThrow(
      'REDIS_URL is required.',
    );
  });

  it('rejects non-Redis protocols', async () => {
    process.env.REDIS_URL = 'https://redis.example.test';
    await expect(indicator.checkConnection()).rejects.toThrow(
      'REDIS_URL must use the redis protocol.',
    );
  });
});
