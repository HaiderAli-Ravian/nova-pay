import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';

export type DependencyStatus = Record<string, 'up'>;

@Injectable()
export class ReadinessService {
  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<DependencyStatus> {
    try {
      await this.prisma.checkConnection();
      return { database: 'up' };
    } catch {
      throw new ServiceUnavailableException({
        code: 'SERVICE_NOT_READY',
        message: 'A required service dependency is unavailable.',
      });
    }
  }
}

