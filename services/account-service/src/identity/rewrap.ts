import 'reflect-metadata';
import { IdentityCryptoService } from './identity-crypto.service.js';
import { PrismaService } from '../database/prisma.service.js';

async function rewrap(): Promise<void> {
  const prisma = new PrismaService();
  const crypto = new IdentityCryptoService();
  try {
    const users = await prisma.db.user.findMany();
    let updated = 0;
    for (const user of users) {
      if (user.identityCiphertext.length === 0) continue;
      const wrapped = crypto.rewrapDek(user);
      if (wrapped.keyVersion === user.keyVersion) continue;
      await prisma.db.user.update({ where: { id: user.id }, data: wrapped });
      updated += 1;
    }
    process.stdout.write(`Re-wrapped ${updated} user DEKs.\n`);
  } finally {
    await prisma.onModuleDestroy();
  }
}

rewrap().catch((error: unknown) => {
  process.stderr.write(`Identity DEK re-wrap failed (${error instanceof Error ? error.name : 'UnknownError'}).\n`);
  process.exitCode = 1;
});
