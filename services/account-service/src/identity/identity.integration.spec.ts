import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service.js';
import { IdentityCryptoService } from './identity-crypto.service.js';
import { IdentityService } from './identity.service.js';
import type { AuditClient } from '../audit/audit.client.js';

const describeWithDatabase = process.env.ACCOUNT_TEST_DATABASE_URL ? describe : describe.skip;

describeWithDatabase('encrypted identity persistence', () => {
  let prisma: PrismaService;
  let service: IdentityService;

  beforeAll(() => {
    process.env.DATABASE_URL = process.env.ACCOUNT_TEST_DATABASE_URL;
    process.env.IDENTITY_ACTIVE_KEY_VERSION = 'v1';
    process.env.IDENTITY_KEK_RING = JSON.stringify({ v1: Buffer.alloc(32, 4).toString('base64') });
    process.env.IDENTITY_LOOKUP_HMAC_KEY = Buffer.alloc(32, 5).toString('base64');
    prisma = new PrismaService();
    service = new IdentityService(
      prisma,
      new IdentityCryptoService(),
      { identityUpdated: async () => undefined } as unknown as AuditClient,
    );
  });

  afterAll(async () => prisma.onModuleDestroy());

  it('stores no known identity plaintext and returns data only for the selected principal', async () => {
    const principal = `customer-${randomUUID()}`;
    const canary = `Alice-${randomUUID()}`;
    const email = `${randomUUID()}@example.com`;
    const phone = `+1555${String(Date.now()).slice(-7)}`;
    const address = `Secret-${randomUUID()} Street`;
    const governmentId = `TAX-${randomUUID()}`;
    const response = await service.update(principal, {
      legalName: canary,
      email,
      phone,
      postalAddress: address,
      governmentId,
    });
    expect((await service.get(principal)).legalName).toBe(canary);
    const stored = await prisma.db.user.findUniqueOrThrow({ where: { id: response.userId } });
    const serialized = [
      stored.identityCiphertext,
      stored.encryptedDek,
      stored.emailLookupHmac,
    ].map((value) => value ? Buffer.from(value).toString('utf8') : '').join('');
    expect(serialized).not.toContain(canary);
    expect(serialized).not.toContain(email);
    expect(serialized).not.toContain(phone);
    expect(serialized).not.toContain(address);
    expect(serialized).not.toContain(governmentId);
    expect(await service.lookup(email.toUpperCase())).toMatchObject({ userId: response.userId });
    await expect(service.get(`stranger-${randomUUID()}`)).rejects.toMatchObject({
      response: { code: 'USER_IDENTITY_NOT_FOUND' },
    });
  });
});
