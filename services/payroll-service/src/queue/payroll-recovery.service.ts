import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { PayrollQueueService } from './payroll-queue.service.js';

@Injectable()
export class PayrollRecoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PayrollRecoveryService.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: PayrollQueueService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test' || process.env.PAYROLL_WORKER_ENABLED === 'false') return;
    this.timer = setInterval(() => void this.recover(), 15_000);
    this.timer.unref();
    void this.recover();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async recover(): Promise<void> {
    const jobs = await this.prisma.db.payrollJob.findMany({
      where: { status: { in: ['PENDING', 'QUEUED', 'PROCESSING'] } },
      orderBy: { updatedAt: 'asc' },
      take: 100,
      select: { id: true },
    });
    for (const job of jobs) {
      try {
        await this.queue.enqueue(job.id);
      } catch {
        this.logger.warn({ event: 'payroll.recovery.enqueue_failed', jobId: job.id });
      }
    }
  }
}
