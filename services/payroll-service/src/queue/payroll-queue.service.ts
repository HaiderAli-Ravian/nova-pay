import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { context, propagation } from '@opentelemetry/api';
import { RedisConnectionService } from './redis-connection.service.js';

export const PAYROLL_QUEUE = 'novapay-payroll';
export interface PayrollQueueData {
  jobId: string;
  traceparent?: string;
  tracestate?: string;
}

@Injectable()
export class PayrollQueueService implements OnModuleDestroy {
  private queue: Queue<PayrollQueueData> | undefined;

  constructor(private readonly redis: RedisConnectionService) {}

  async enqueue(jobId: string): Promise<void> {
    const queue = this.getQueue();
    const existing = await queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (!['completed', 'failed'].includes(state)) return;
      await existing.remove();
    }
    const traceCarrier: Record<string, string> = {};
    propagation.inject(context.active(), traceCarrier);
    await queue.add(
      'process-payroll',
      {
        jobId,
        ...(traceCarrier.traceparent ? { traceparent: traceCarrier.traceparent } : {}),
        ...(traceCarrier.tracestate ? { tracestate: traceCarrier.tracestate } : {}),
      },
      {
        jobId,
        attempts: 5,
        backoff: { type: 'exponential', delay: 1_000 },
        removeOnComplete: { age: 86_400, count: 1_000 },
        removeOnFail: { age: 604_800, count: 1_000 },
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }

  get connection() {
    return this.redis.connection;
  }

  private getQueue(): Queue<PayrollQueueData> {
    this.queue ??= new Queue<PayrollQueueData>(PAYROLL_QUEUE, {
      connection: this.redis.connection,
    });
    return this.queue;
  }
}
