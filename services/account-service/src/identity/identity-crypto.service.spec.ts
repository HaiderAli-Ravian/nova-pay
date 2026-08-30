import { IdentityCryptoService } from './identity-crypto.service.js';

const userId = '5a68ad75-0195-40a7-a093-c4838e796470';

describe('IdentityCryptoService', () => {
  beforeEach(() => {
    process.env.IDENTITY_ACTIVE_KEY_VERSION = 'v1';
    process.env.IDENTITY_KEK_RING = JSON.stringify({
      v1: Buffer.alloc(32, 1).toString('base64'),
      v2: Buffer.alloc(32, 2).toString('base64'),
    });
    process.env.IDENTITY_LOOKUP_HMAC_KEY = Buffer.alloc(32, 3).toString('base64');
  });

  it('round-trips canonical identity data with unique ciphertext and nonces', () => {
    const service = new IdentityCryptoService();
    const input = {
      legalName: ' Alice Example ',
      email: 'ALICE@Example.com ',
      phone: '+15555550123',
      postalAddress: '100 Main Street',
      governmentId: 'TAX-123',
    };
    const first = service.encrypt(userId, input);
    const second = service.encrypt(userId, input);
    expect(Buffer.from(first.identityIv)).not.toEqual(Buffer.from(second.identityIv));
    expect(Buffer.from(first.identityCiphertext)).not.toEqual(Buffer.from(second.identityCiphertext));
    expect(service.decrypt({ id: userId, ...first })).toEqual({
      ...input,
      legalName: 'Alice Example',
      email: 'alice@example.com',
    });
  });

  it('fails closed for a moved ciphertext, modified tag, or unavailable key version', () => {
    const service = new IdentityCryptoService();
    const encrypted = service.encrypt(userId, { legalName: 'Alice', email: 'alice@example.com' });
    expect(() => service.decrypt({ id: 'c5511d5e-7bea-4215-a86a-dac725114b25', ...encrypted }))
      .toThrow('The encrypted identity could not be authenticated.');
    const tag = new Uint8Array(encrypted.identityAuthTag);
    tag[0] = (tag[0] as number) ^ 0xff;
    expect(() => service.decrypt({ id: userId, ...encrypted, identityAuthTag: tag }))
      .toThrow('The encrypted identity could not be authenticated.');
    expect(() => service.decrypt({ id: userId, ...encrypted, keyVersion: 'missing' }))
      .toThrow('The encrypted identity could not be authenticated.');
  });

  it('normalizes the blind email index and re-wraps only the DEK', () => {
    const service = new IdentityCryptoService();
    const encrypted = service.encrypt(userId, { legalName: 'Alice', email: 'Alice@Example.com' });
    expect(Buffer.from(service.emailDigest(' alice@example.COM ')))
      .toEqual(Buffer.from(encrypted.emailLookupHmac as Uint8Array));
    process.env.IDENTITY_ACTIVE_KEY_VERSION = 'v2';
    const rewrapped = service.rewrapDek({ id: userId, ...encrypted });
    expect(rewrapped.keyVersion).toBe('v2');
    expect(Buffer.from(rewrapped.encryptedDek)).not.toEqual(Buffer.from(encrypted.encryptedDek));
    expect(service.decrypt({ id: userId, ...encrypted, ...rewrapped }).email).toBe('alice@example.com');
  });
});
