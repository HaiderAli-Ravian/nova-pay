import { BadRequestException } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { decodeHistoryCursor, encodeHistoryCursor } from './history-cursor.js';

describe('history cursor', () => {
  const originalKey = process.env.HISTORY_CURSOR_HMAC_KEY;

  beforeAll(() => {
    process.env.HISTORY_CURSOR_HMAC_KEY = randomBytes(32).toString('base64');
  });

  afterAll(() => {
    if (originalKey === undefined) delete process.env.HISTORY_CURSOR_HMAC_KEY;
    else process.env.HISTORY_CURSOR_HMAC_KEY = originalKey;
  });

  it('round trips a signed wallet-bound cursor', () => {
    const walletId = randomUUID();
    const value = { occurredAt: new Date('2026-08-30T10:00:00.000Z'), id: randomUUID() };
    expect(decodeHistoryCursor(walletId, encodeHistoryCursor(walletId, value))).toEqual(value);
  });

  it('rejects payload/signature changes and use against another wallet', () => {
    const walletId = randomUUID();
    const cursor = encodeHistoryCursor(walletId, {
      occurredAt: new Date('2026-08-30T10:00:00.000Z'),
      id: randomUUID(),
    });
    const [payload, signature] = cursor.split('.');
    const changedPayload = `${payload!.slice(0, -1)}${payload!.endsWith('A') ? 'B' : 'A'}`;
    const changedSignature = `${signature!.slice(0, -1)}${signature!.endsWith('A') ? 'B' : 'A'}`;

    for (const invalid of [
      `${changedPayload}.${signature}`,
      `${payload}.${changedSignature}`,
      cursor.slice(0, -1),
      'not-a-cursor',
    ]) {
      expect(() => decodeHistoryCursor(walletId, invalid)).toThrow(BadRequestException);
    }
    expect(() => decodeHistoryCursor(randomUUID(), cursor)).toThrow(BadRequestException);
  });
});
