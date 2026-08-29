import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { RedisReadinessIndicator } from './redis-readiness.indicator.js';

export type DependencyStatus = Record<string, 'up'>;

@Injectable()
export class ReadinessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisReadinessIndicator,
  ) {}

  async check(): Promise<DependencyStatus> {
    try {
      await Promise.all([
        this.prisma.checkConnection(),
        this.redis.checkConnection(),
      ]);
      return { database: 'up', redis: 'up' };
    } catch {
      throw new ServiceUnavailableException({
        code: 'SERVICE_NOT_READY',
        message: 'A required service dependency is unavailable.',
      });
    }
  }
}
