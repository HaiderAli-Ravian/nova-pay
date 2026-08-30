import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AccountClient } from '../clients/account.client.js';
import { UpstreamHttpError, UpstreamUnavailableError } from '../clients/upstream-error.js';
import { Prisma, type PayrollJob } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { PayrollQueueService } from '../queue/payroll-queue.service.js';
import { CreatePayrollJobDto, type PayrollItemInputDto } from './dto/create-payroll-job.dto.js';
import { PayrollJobResponseDto } from './dto/payroll-job-response.dto.js';

const MAX_ITEMS = 15_000;
const REPLAY_WINDOW_MS = 24 * 60 * 60 * 1_000;
const RETENTION_WINDOW_MS = 7 * 365 * 24 * 60 * 60 * 1_000;

type ExistingRecord = Prisma.PayrollIdempotencyRecordGetPayload<{
  include: { job: true };
}>;

@Injectable()
export class PayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly account: AccountClient,
    private readonly queue: PayrollQueueService,
  ) {}

  async submit(
    employerId: string,
    idempotencyKey: string,
    command: CreatePayrollJobDto,
  ): Promise<PayrollJobResponseDto> {
    validateIdempotencyKey(idempotencyKey);
    const normalized = normalizeCommand(command);
    const requestHash = canonicalPayrollHash(normalized);
    const existing = await this.findRecord(employerId, idempotencyKey);
    if (existing) return this.replay(existing, requestHash);

    await this.validateSourceWallet(employerId, normalized);
    const now = new Date();
    const jobId = randomUUID();
    const itemRows = normalized.items.map((item, sequence) => {
      const id = randomUUID();
      return {
        id,
        sequence,
        externalItemId: item.externalItemId,
        recipientWalletId: item.recipientWalletId,
        amount: new Prisma.Decimal(item.amount),
        currency: normalized.currency,
        transferIdempotencyKey: `payroll:${jobId}:${id}`,
      };
    });
    const totalAmount = itemRows.reduce(
      (sum, item) => sum.plus(item.amount),
      new Prisma.Decimal(0),
    );

    try {
      await this.prisma.db.$transaction(async (database) => {
        await database.payrollJob.create({
          data: {
            id: jobId,
            employerId,
            sourceWalletId: normalized.sourceWalletId,
            currency: normalized.currency,
            totalItems: itemRows.length,
            totalAmount,
            items: { create: itemRows },
          },
        });
        await database.payrollIdempotencyRecord.create({
          data: {
            employerId,
            key: idempotencyKey,
            requestHash,
            jobId,
            replayExpiresAt: new Date(now.getTime() + REPLAY_WINDOW_MS),
            retentionUntil: new Date(now.getTime() + RETENTION_WINDOW_MS),
          },
        });
      });
    } catch (error) {
      if (isUniqueConflict(error)) {
        const winner = await this.findRecord(employerId, idempotencyKey);
        if (winner) return this.replay(winner, requestHash);
      }
      throw error;
    }

    await this.ensureEnqueued(jobId);
    return this.getForEmployer(employerId, jobId, true);
  }

  async getForEmployer(
    employerId: string,
    jobId: string,
    includeStatusUrl = false,
  ): Promise<PayrollJobResponseDto> {
    const job = await this.findJob(jobId);
    if (job.employerId !== employerId) {
      throw new ForbiddenException({
        code: 'PAYROLL_ACCESS_DENIED',
        message: 'The payroll job is not accessible to this principal.',
      });
    }
    return this.toResponse(job, includeStatusUrl, true);
  }

  async getInternal(jobId: string): Promise<PayrollJobResponseDto> {
    return this.toResponse(await this.findJob(jobId), false, true);
  }

  private async replay(
    record: ExistingRecord,
    requestHash: string,
  ): Promise<PayrollJobResponseDto> {
    if (record.requestHash !== requestHash) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_PAYLOAD_MISMATCH',
        message: 'The idempotency key was already used for a different payroll request.',
      });
    }
    if (record.replayExpiresAt.getTime() <= Date.now()) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_KEY_EXPIRED',
        message: 'The idempotency replay window has expired.',
      });
    }
    if (record.job.status === 'PENDING') await this.ensureEnqueued(record.job.id);
    return this.getForEmployer(record.employerId, record.job.id, true);
  }

  private async ensureEnqueued(jobId: string): Promise<void> {
    try {
      await this.queue.enqueue(jobId);
      await this.prisma.db.$transaction(async (database) => {
        await database.payrollJob.updateMany({
          where: { id: jobId, status: { in: ['PENDING', 'QUEUED'] } },
          data: { status: 'QUEUED', bullmqJobId: jobId, lastQueueErrorCode: null },
        });
        await database.payrollIdempotencyRecord.update({
          where: { jobId },
          data: { state: 'COMPLETED', responseStatus: 202 },
        });
      });
    } catch {
      await this.prisma.db.payrollJob.update({
        where: { id: jobId },
        data: {
          queueFailureCount: { increment: 1 },
          lastQueueErrorCode: 'QUEUE_UNAVAILABLE',
        },
      });
      throw new ServiceUnavailableException({
        code: 'QUEUE_UNAVAILABLE',
        message: 'The payroll job was persisted and will be enqueued when Redis recovers.',
      });
    }
  }

  private async validateSourceWallet(
    employerId: string,
    command: CreatePayrollJobDto,
  ): Promise<void> {
    try {
      const wallet = await this.account.validation(command.sourceWalletId);
      if (wallet.ownerExternalRef !== employerId || wallet.status !== 'ACTIVE') {
        throw new ForbiddenException({
          code: 'EMPLOYER_WALLET_ACCESS_DENIED',
          message: 'The source wallet is not an active wallet owned by the employer.',
        });
      }
      if (wallet.currency !== command.currency) {
        throw new BadRequestException({
          code: 'CURRENCY_MISMATCH',
          message: 'The payroll currency must match the source wallet currency.',
        });
      }
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof BadRequestException) throw error;
      if (error instanceof UpstreamHttpError && error.status === 404) {
        throw new ForbiddenException({
          code: 'EMPLOYER_WALLET_ACCESS_DENIED',
          message: 'The source wallet is not accessible to the employer.',
        });
      }
      if (error instanceof UpstreamUnavailableError || error instanceof UpstreamHttpError) {
        throw new ServiceUnavailableException({
          code: 'ACCOUNT_UNAVAILABLE',
          message: 'The source wallet could not be validated.',
        });
      }
      throw error;
    }
  }

  private findRecord(employerId: string, key: string): Promise<ExistingRecord | null> {
    return this.prisma.db.payrollIdempotencyRecord.findUnique({
      where: { employerId_key: { employerId, key } },
      include: { job: true },
    });
  }

  private async findJob(jobId: string): Promise<PayrollJob> {
    const job = await this.prisma.db.payrollJob.findUnique({ where: { id: jobId } });
    if (!job) {
      throw new NotFoundException({
        code: 'PAYROLL_JOB_NOT_FOUND',
        message: 'Payroll job not found.',
      });
    }
    return job;
  }

  private async toResponse(
    job: PayrollJob,
    includeStatusUrl: boolean,
    includeFailures: boolean,
  ): Promise<PayrollJobResponseDto> {
    const [processingItems, failures] = await Promise.all([
      this.prisma.db.payrollItem.count({
        where: { payrollJobId: job.id, status: 'PROCESSING' },
      }),
      includeFailures
        ? this.prisma.db.payrollItem.findMany({
            where: { payrollJobId: job.id, status: 'FAILED' },
            orderBy: { sequence: 'asc' },
            take: 20,
            select: { externalItemId: true, failureCode: true },
          })
        : Promise.resolve([]),
    ]);
    return {
      jobId: job.id,
      status: job.status,
      totalItems: job.totalItems,
      pendingItems:
        job.totalItems - job.completedItems - job.failedItems - processingItems,
      processingItems,
      completedItems: job.completedItems,
      failedItems: job.failedItems,
      updatedAt: job.updatedAt.toISOString(),
      ...(includeStatusUrl ? { statusUrl: `/payroll/jobs/${job.id}` } : {}),
      ...(failures.length > 0
        ? {
            failures: failures.map((failure) => ({
              externalItemId: failure.externalItemId,
              failureCode: failure.failureCode ?? 'PAYROLL_ITEM_FAILED',
            })),
          }
        : {}),
      queueFailureCount: job.queueFailureCount,
      lastQueueErrorCode: job.lastQueueErrorCode,
    };
  }
}

export function canonicalPayrollHash(command: CreatePayrollJobDto): string {
  return createHash('sha256')
    .update(JSON.stringify({
      method: 'POST',
      route: '/payroll/jobs',
      sourceWalletId: command.sourceWalletId,
      currency: command.currency,
      items: command.items.map((item) => ({
        externalItemId: item.externalItemId,
        recipientWalletId: item.recipientWalletId,
        amount: new Prisma.Decimal(item.amount).toFixed(8),
      })),
    }))
    .digest('hex');
}

export function normalizeCommand(command: CreatePayrollJobDto): CreatePayrollJobDto {
  if (command.items.length > MAX_ITEMS) {
    throw new PayloadTooLargeException({
      code: 'PAYROLL_TOO_LARGE',
      message: `Payroll jobs are limited to ${MAX_ITEMS} items.`,
    });
  }
  const seen = new Set<string>();
  for (const item of command.items) {
    if (seen.has(item.externalItemId)) {
      throw new BadRequestException({
        code: 'DUPLICATE_EXTERNAL_ITEM_ID',
        message: 'Each external item ID must be unique within a payroll job.',
      });
    }
    seen.add(item.externalItemId);
    if (!new Prisma.Decimal(item.amount).isPositive()) {
      throw new BadRequestException({
        code: 'INVALID_AMOUNT',
        message: 'Payroll item amounts must be greater than zero.',
      });
    }
  }
  const items = [...command.items].sort(compareItems);
  return { ...command, items };
}

function compareItems(left: PayrollItemInputDto, right: PayrollItemInputDto): number {
  return left.externalItemId < right.externalItemId
    ? -1
    : left.externalItemId > right.externalItemId
      ? 1
      : 0;
}

function validateIdempotencyKey(key: string): void {
  if (!/^[\x21-\x7E]{1,128}$/.test(key)) {
    throw new BadRequestException({
      code: 'INVALID_IDEMPOTENCY_KEY',
      message: 'Idempotency-Key must contain 1 to 128 visible ASCII characters.',
    });
  }
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
