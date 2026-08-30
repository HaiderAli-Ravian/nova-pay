import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

@Injectable()
export class PrismaService implements OnModuleDestroy {
  private client: PrismaClient | undefined;

  async checkConnection(): Promise<void> {
    await this.getClient().$queryRaw`SELECT 1`;
  }

  get db(): PrismaClient {
    return this.getClient();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.$disconnect();
  }

  private getClient(): PrismaClient {
    if (this.client) {
      return this.client;
    }

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is required.');
    }

    const adapter = new PrismaPg({
      connectionString,
      connectionTimeoutMillis: 2_000,
      idleTimeoutMillis: 30_000,
      max: 10,
    });

    this.client = new PrismaClient({ adapter });
    return this.client;
  }
}
