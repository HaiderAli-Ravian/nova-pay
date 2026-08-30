import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { TransactionClient, type PayrollTransferResponse } from '../clients/transaction.client.js';
import { UpstreamHttpError } from '../clients/upstream-error.js';
import { type PayrollItem } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { EmployerLeaseService } from '../queue/employer-lease.service.js';

const LEASE_TTL_MS = 30_000;
const LEASE_RENEW_MS = 10_000;
const ITEM_BATCH_SIZE = 100;

@Injectable()
export class PayrollProcessorService {
  private readonly logger = new Logger(PayrollProcessorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly leases: EmployerLeaseService,
    private readonly transactions: TransactionClient,
  ) {}

  async process(jobId: string): Promise<void> {
    const job = await this.prisma.db.payrollJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Payroll job not found.');
    if (isTerminal(job.status)) return;

    const leaseToken = randomUUID();
    if (!(await this.leases.acquire(job.employerId, leaseToken, LEASE_TTL_MS))) {
      throw new Error('EMPLOYER_LEASE_BUSY');
    }

    let leaseLost = false;
    let renewalRunning = false;
    const renewal = setInterval(() => {
      if (renewalRunning) return;
      renewalRunning = true;
      void this.leases
        .renew(job.employerId, leaseToken, LEASE_TTL_MS)
        .then((renewed) => { if (!renewed) leaseLost = true; })
        .catch(() => { leaseLost = true; })
        .finally(() => { renewalRunning = false; });
    }, LEASE_RENEW_MS);

    try {
      await this.prisma.db.payrollJob.update({
        where: { id: job.id },
        data: {
          status: 'PROCESSING',
          startedAt: job.startedAt ?? new Date(),
          lastQueueErrorCode: null,
        },
      });

      await this.reconcileClaimedItems(job.id, job.employerId, job.sourceWalletId);
      for (;;) {
        if (leaseLost) throw new Error('EMPLOYER_LEASE_LOST');
        const batch = await this.claimPendingBatch(job.id);
        if (batch.length === 0) break;
        for (const item of batch) {
          if (leaseLost) throw new Error('EMPLOYER_LEASE_LOST');
          await this.executeItem(job.employerId, job.sourceWalletId, item);
        }
      }
      await this.finalize(job.id);
    } finally {
      clearInterval(renewal);
      await this.leases.release(job.employerId, leaseToken).catch(() => false);
    }
  }

  async noteQueueFailure(jobId: string): Promise<void> {
    await this.prisma.db.payrollJob.updateMany({
      where: { id: jobId, status: { in: ['PENDING', 'QUEUED', 'PROCESSING'] } },
      data: {
        queueFailureCount: { increment: 1 },
        lastQueueErrorCode: 'PAYROLL_WORKER_FAILED',
      },
    });
  }

  private async reconcileClaimedItems(
    jobId: string,
    employerId: string,
    sourceWalletId: string,
  ): Promise<void> {
    const items = await this.prisma.db.payrollItem.findMany({
      where: { payrollJobId: jobId, status: 'PROCESSING' },
      orderBy: { sequence: 'asc' },
    });
    for (const item of items) {
      const token = randomUUID();
      const claimed = await this.prisma.db.payrollItem.updateMany({
        where: { id: item.id, status: 'PROCESSING' },
        data: {
          processingToken: token,
          processingStartedAt: new Date(),
          attemptCount: { increment: 1 },
        },
      });
      if (claimed.count === 1) {
        await this.executeItem(
          employerId,
          sourceWalletId,
          { ...item, processingToken: token },
        );
      }
    }
  }

  private async claimPendingBatch(jobId: string): Promise<PayrollItem[]> {
    const candidates = await this.prisma.db.payrollItem.findMany({
      where: { payrollJobId: jobId, status: 'PENDING' },
      orderBy: { sequence: 'asc' },
      take: ITEM_BATCH_SIZE,
    });
    const claimed: PayrollItem[] = [];
    for (const item of candidates) {
      const token = randomUUID();
      const result = await this.prisma.db.payrollItem.updateMany({
        where: { id: item.id, status: 'PENDING' },
        data: {
          status: 'PROCESSING',
          processingToken: token,
          processingStartedAt: new Date(),
          attemptCount: { increment: 1 },
        },
      });
      if (result.count === 1) {
        claimed.push({
          ...item,
          status: 'PROCESSING',
          processingToken: token,
          processingStartedAt: new Date(),
          attemptCount: item.attemptCount + 1,
        });
      }
    }
    return claimed;
  }

  private async executeItem(
    employerId: string,
    sourceWalletId: string,
    item: PayrollItem,
  ): Promise<void> {
    try {
      const result = await this.transactions.createDomestic(
        employerId,
        item.transferIdempotencyKey,
        {
          senderWalletId: sourceWalletId,
          recipientWalletId: item.recipientWalletId,
          amount: item.amount.toFixed(8),
          currency: item.currency,
        },
      );
      await this.checkpointResponse(item, result);
    } catch (error) {
      if (error instanceof UpstreamHttpError) {
        const transfer = transferFromBody(error.body);
        if (transfer) {
          await this.checkpointResponse(item, transfer);
          return;
        }
        if (error.status >= 400 && error.status < 500) {
          await this.checkpoint(item, 'FAILED', undefined, error.code);
          return;
        }
      }
      throw error;
    }
  }

  private async checkpointResponse(
    item: PayrollItem,
    transfer: PayrollTransferResponse,
  ): Promise<void> {
    if (transfer.status === 'COMPLETED') {
      await this.checkpoint(item, 'COMPLETED', transfer.transferId);
      return;
    }
    if (transfer.status === 'FAILED' || transfer.status === 'REVERSED') {
      await this.checkpoint(
        item,
        'FAILED',
        transfer.transferId,
        transfer.failure?.code ?? `TRANSFER_${transfer.status}`,
      );
      return;
    }
    await this.prisma.db.payrollItem.updateMany({
      where: { id: item.id, status: 'PROCESSING', processingToken: item.processingToken },
      data: { transferId: transfer.transferId },
    });
    throw new Error('TRANSFER_NOT_TERMINAL');
  }

  private async checkpoint(
    item: PayrollItem,
    status: 'COMPLETED' | 'FAILED',
    transferId?: string,
    failureCode?: string,
  ): Promise<void> {
    await this.prisma.db.$transaction(async (database) => {
      const result = await database.payrollItem.updateMany({
        where: {
          id: item.id,
          status: 'PROCESSING',
          processingToken: item.processingToken,
        },
        data: {
          status,
          transferId,
          failureCode: status === 'FAILED' ? (failureCode ?? 'PAYROLL_ITEM_FAILED') : null,
          processingToken: null,
          processingStartedAt: null,
          completedAt: new Date(),
        },
      });
      if (result.count === 1) {
        await database.payrollJob.update({
          where: { id: item.payrollJobId },
          data: status === 'COMPLETED'
            ? { completedItems: { increment: 1 } }
            : { failedItems: { increment: 1 } },
        });
      }
    });
  }

  private async finalize(jobId: string): Promise<void> {
    const job = await this.prisma.db.payrollJob.findUniqueOrThrow({ where: { id: jobId } });
    const terminalCount = job.completedItems + job.failedItems;
    if (terminalCount !== job.totalItems) throw new Error('PAYROLL_ITEMS_NONTERMINAL');
    const status = job.failedItems === 0
      ? 'COMPLETED'
      : job.completedItems === 0
        ? 'FAILED'
        : 'PARTIALLY_FAILED';
    await this.prisma.db.payrollJob.update({
      where: { id: jobId },
      data: { status, completedAt: new Date(), lastQueueErrorCode: null },
    });
    this.logger.log({ event: 'payroll.completed', jobId, status });
  }
}

function isTerminal(status: string): boolean {
  return ['COMPLETED', 'PARTIALLY_FAILED', 'FAILED'].includes(status);
}

function transferFromBody(body: Record<string, unknown>): PayrollTransferResponse | undefined {
  if (typeof body.transferId !== 'string' || typeof body.status !== 'string') return undefined;
  return body as unknown as PayrollTransferResponse;
}
