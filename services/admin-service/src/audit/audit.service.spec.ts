import { BadRequestException } from '@nestjs/common';
import { computeAuditHash, sanitizeMetadata } from './audit.service.js';
import { deterministicUuid } from './audit.controller.js';

describe('audit canonicalization', () => {
  it('produces stable hashes for sorted safe metadata', () => {
    const base = {
      streamKey: 'transfer:1',
      sequence: 1n,
      previousHash: '0'.repeat(64),
      action: 'transfer.completed',
      entityType: 'transfer',
      entityId: '1',
      actorId: 'transaction-service',
      occurredAt: new Date('2026-08-30T10:00:00.000Z'),
    };
    expect(computeAuditHash({ ...base, metadata: { z: true, a: 'safe' } }))
      .toBe(computeAuditHash({ ...base, metadata: { a: 'safe', z: true } }));
    expect(computeAuditHash({ ...base, sequence: 2n, metadata: { a: 'safe', z: true } }))
      .not.toBe(computeAuditHash({ ...base, metadata: { a: 'safe', z: true } }));
  });

  it('rejects sensitive metadata keys rather than storing or logging them', () => {
    expect(() => sanitizeMetadata({ requestId: 'safe', email: 'secret@example.com' }))
      .toThrow(BadRequestException);
  });

  it('derives stable UUID event IDs for operator idempotency keys', () => {
    expect(deterministicUuid('operator-action')).toBe(deterministicUuid('operator-action'));
    expect(deterministicUuid('operator-action')).not.toBe(deterministicUuid('other-action'));
  });
});
