import { jest } from '@jest/globals';
import { RequestContextService } from '../common/request-context.service.js';
import { AuditClient } from './audit.client.js';

describe('AuditClient', () => {
  it('uses a deterministic event ID and never sends identity plaintext', async () => {
    process.env.ADMIN_BASE_URL = 'http://admin.test';
    process.env.INTERNAL_SERVICE_TOKEN = 'test-internal-service-token-1234';
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const client = new AuditClient(new RequestContextService());
    const canary = 'Alice Secret alice@example.com';
    const occurredAt = new Date('2026-08-30T10:00:00.000Z');
    await client.identityUpdated('5a68ad75-0195-40a7-a093-c4838e796470', 'alice', canary, occurredAt);
    await client.identityUpdated('5a68ad75-0195-40a7-a093-c4838e796470', 'alice', canary, occurredAt);
    const bodies = fetchMock.mock.calls.map(([, init]) => String(init?.body));
    expect(JSON.parse(bodies[0] as string).eventId).toBe(JSON.parse(bodies[1] as string).eventId);
    expect(bodies.join('')).not.toContain(canary);
    fetchMock.mockRestore();
  });
});
