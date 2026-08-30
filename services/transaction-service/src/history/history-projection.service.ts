import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';

export interface HistoryRebuildResult {
  transfersScanned: number;
  rowsWritten: number;
  rowsRemoved: number;
}

type ProjectionTransfer = Prisma.TransferGetPayload<{
  select: {
    id: true;
    type: true;
    status: true;
    senderWalletId: true;
    recipientWalletId: true;
    sourceAmount: true;
    sourceCurrency: true;
    targetAmount: true;
    targetCurrency: true;
    fxQuoteId: true;
    createdAt: true;
  };
}>;

@Injectable()
export class HistoryProjectionService {
  constructor(private readonly prisma: PrismaService) {}

  async rebuild(batchSize = 500): Promise<HistoryRebuildResult> {
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 2_000) {
      throw new Error('History rebuild batch size must be between 1 and 2000.');
    }
    const result: HistoryRebuildResult = {
      transfersScanned: 0,
      rowsWritten: 0,
      rowsRemoved: 0,
    };
    let afterId: string | undefined;

    for (;;) {
      const transfers = await this.prisma.db.transfer.findMany({
        where: afterId ? { id: { gt: afterId } } : undefined,
        orderBy: { id: 'asc' },
        take: batchSize,
        select: {
          id: true,
          type: true,
          status: true,
          senderWalletId: true,
          recipientWalletId: true,
          sourceAmount: true,
          sourceCurrency: true,
          targetAmount: true,
          targetCurrency: true,
          fxQuoteId: true,
          createdAt: true,
        },
      });
      if (transfers.length === 0) break;

      const batchResult = await this.prisma.db.$transaction(async (transaction) => {
        let rowsWritten = 0;
        let rowsRemoved = 0;
        for (const transfer of transfers) {
          const rows = expectedRows(transfer);
          if (rows.length === 0) {
            rowsRemoved += (await transaction.transactionHistory.deleteMany({
              where: { transferId: transfer.id },
            })).count;
            continue;
          }
          for (const row of rows) {
            await transaction.transactionHistory.upsert({
              where: {
                transferId_walletId_role: {
                  transferId: transfer.id,
                  walletId: row.walletId,
                  role: row.role,
                },
              },
              create: { transferId: transfer.id, ...row },
              update: row,
            });
            rowsWritten += 1;
          }
          rowsRemoved += (await transaction.transactionHistory.deleteMany({
            where: {
              transferId: transfer.id,
              NOT: {
                OR: rows.map((row) => ({ walletId: row.walletId, role: row.role })),
              },
            },
          })).count;
        }
        return { rowsWritten, rowsRemoved };
      });
      result.transfersScanned += transfers.length;
      result.rowsWritten += batchResult.rowsWritten;
      result.rowsRemoved += batchResult.rowsRemoved;
      afterId = transfers.at(-1)!.id;
    }
    return result;
  }
}

function expectedRows(transfer: ProjectionTransfer) {
  if (transfer.type === 'INTERNATIONAL' && transfer.targetAmount === null) {
    return [];
  }
  return [
    {
      walletId: transfer.senderWalletId,
      role: 'SENDER' as const,
      counterpartyWalletId: transfer.recipientWalletId,
      status: transfer.status,
      amount: transfer.sourceAmount,
      currency: transfer.sourceCurrency,
      fxQuoteId: transfer.fxQuoteId,
      occurredAt: transfer.createdAt,
    },
    {
      walletId: transfer.recipientWalletId,
      role: 'RECIPIENT' as const,
      counterpartyWalletId: transfer.senderWalletId,
      status: transfer.status,
      amount: transfer.targetAmount ?? transfer.sourceAmount,
      currency: transfer.targetCurrency,
      fxQuoteId: transfer.fxQuoteId,
      occurredAt: transfer.createdAt,
    },
  ];
}
