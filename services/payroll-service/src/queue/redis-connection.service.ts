import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';

@Injectable()
export class RedisConnectionService implements OnModuleDestroy {
  private client: Redis | undefined;

  get connection(): Redis {
    if (!this.client) {
      const url = process.env.REDIS_URL;
      if (!url) throw new Error('REDIS_URL is required.');
      this.client = new Redis(url, {
        lazyConnect: true,
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
      });
    }
    return this.client;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) await this.client.quit().catch(() => undefined);
  }
}
