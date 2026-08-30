import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker } from 'bullmq';
import { PayrollProcessorService } from '../payroll/payroll-processor.service.js';
import { PAYROLL_QUEUE, PayrollQueueService, type PayrollQueueData } from './payroll-queue.service.js';

@Injectable()
export class PayrollWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PayrollWorkerService.name);
  private worker: Worker<PayrollQueueData> | undefined;

  constructor(
    private readonly queue: PayrollQueueService,
    private readonly processor: PayrollProcessorService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test' || process.env.PAYROLL_WORKER_ENABLED === 'false') return;
    this.worker = new Worker<PayrollQueueData>(
      PAYROLL_QUEUE,
      async (job) => this.processor.process(job.data.jobId),
      { connection: this.queue.connection, concurrency: 4 },
    );
    this.worker.on('failed', (job, error) => {
      this.logger.warn({
        event: 'payroll.worker.failed',
        jobId: job?.data.jobId,
        attempt: job?.attemptsMade,
        errorName: error.name,
      });
      if (job?.data.jobId) void this.processor.noteQueueFailure(job.data.jobId);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
