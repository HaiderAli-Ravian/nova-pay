import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { TransferService } from './transfer.service.js';

@Injectable()
export class ReconciliationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReconciliationService.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(private readonly transfers: TransferService) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    const interval = Number(process.env.RECONCILIATION_INTERVAL_MS ?? 30_000);
    this.timer = setInterval(() => void this.runOnce(), interval);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce(): Promise<{ inspected: number }> {
    if (this.running) return { inspected: 0 };
    this.running = true;
    try {
      const ids = await this.transfers.findStale();
      for (const id of ids) {
        try {
          await this.transfers.reconcile(id, true);
        } catch {
          this.logger.warn(JSON.stringify({ event: 'transfer.reconciliation.failed', transferId: id }));
        }
      }
      return { inspected: ids.length };
    } finally {
      this.running = false;
    }
  }
}
