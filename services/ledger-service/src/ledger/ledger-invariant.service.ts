import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { LedgerMetricsService } from './ledger-metrics.service.js';

interface ViolationRow {
  transactionId: string;
  currency: string;
}

@Injectable()
export class LedgerInvariantService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(LedgerInvariantService.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: LedgerMetricsService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === 'test') return;
    void this.verify().catch((error: unknown) => this.logFailure(error));
    this.timer = setInterval(
      () => void this.verify().catch((error: unknown) => this.logFailure(error)),
      invariantIntervalMs(),
    );
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async verify(): Promise<{ violations: number; checkedAt: string }> {
    const rows = await this.prisma.db.$queryRaw<ViolationRow[]>`
      SELECT
        transaction."id" AS "transactionId",
        COALESCE(entry."currency", transaction."source_currency") AS "currency"
      FROM "ledger_transactions" AS transaction
      LEFT JOIN "ledger_entries" AS entry
        ON entry."ledger_transaction_id" = transaction."id"
      GROUP BY
        transaction."id",
        COALESCE(entry."currency", transaction."source_currency")
      HAVING
        COUNT(entry."id") = 0
        OR
        COALESCE(SUM(CASE WHEN entry."direction" = 'DEBIT' THEN entry."amount" ELSE 0 END), 0)
        <>
        COALESCE(SUM(CASE WHEN entry."direction" = 'CREDIT' THEN entry."amount" ELSE 0 END), 0)
      ORDER BY transaction."id", COALESCE(entry."currency", transaction."source_currency")
    `;
    this.metrics.setInvariantViolations(rows.length);
    const checkedAt = new Date();
    await this.prisma.db.ledgerInvariantCheck.create({
      data: {
        checkType: 'DOUBLE_ENTRY_BALANCE',
        violations: rows.length,
        details: {
          examples: rows.slice(0, 10).map((row) => ({
            transactionId: row.transactionId,
            currency: row.currency,
          })),
        },
        checkedAt,
      },
    });
    if (rows.length > 0) {
      this.logger.error({
        event: 'ledger.invariant.violated',
        violations: rows.length,
        timestamp: checkedAt.toISOString(),
      });
    }
    return { violations: rows.length, checkedAt: checkedAt.toISOString() };
  }

  private logFailure(error: unknown): void {
    this.logger.error({
      event: 'ledger.invariant.check_failed',
      errorName: error instanceof Error ? error.name : 'UnknownError',
      timestamp: new Date().toISOString(),
    });
  }
}

function invariantIntervalMs(): number {
  const value = Number(process.env.LEDGER_INVARIANT_INTERVAL_MS ?? 15_000);
  return Number.isInteger(value) && value >= 1_000 ? value : 15_000;
}
