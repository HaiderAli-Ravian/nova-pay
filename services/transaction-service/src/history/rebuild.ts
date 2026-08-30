import 'reflect-metadata';
import { PrismaService } from '../database/prisma.service.js';
import { HistoryProjectionService } from './history-projection.service.js';

async function main(): Promise<void> {
  const rawBatchSize = Number(process.env.HISTORY_REBUILD_BATCH_SIZE ?? 500);
  const prisma = new PrismaService();
  try {
    const result = await new HistoryProjectionService(prisma).rebuild(rawBatchSize);
    process.stdout.write(`${JSON.stringify({ event: 'history.rebuild.completed', ...result })}\n`);
  } finally {
    await prisma.onModuleDestroy();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify({
    event: 'history.rebuild.failed',
    errorName: error instanceof Error ? error.name : 'UnknownError',
  })}\n`);
  process.exitCode = 1;
});
