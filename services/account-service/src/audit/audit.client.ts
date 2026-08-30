import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { RequestContextService } from '../common/request-context.service.js';

@Injectable()
export class AuditClient {
  constructor(private readonly requestContext: RequestContextService) {}

  identityUpdated(
    userId: string,
    actorId: string,
    canonicalPayload: string,
    occurredAt: Date,
  ): Promise<void> {
    return this.append({
      eventId: deterministicUuid(`identity.updated\0${userId}\0${canonicalPayload}`),
      streamKey: `user:${userId}`,
      action: 'user.identity.updated',
      entityType: 'user',
      entityId: userId,
      actorId,
      occurredAt: occurredAt.toISOString(),
      metadata: { schemaVersion: 'v1' },
    });
  }

  walletActivated(
    walletId: string,
    actorId: string,
    currency: string,
    occurredAt: Date,
  ): Promise<void> {
    return this.append({
      eventId: deterministicUuid(`wallet.activated\0${walletId}`),
      streamKey: `wallet:${walletId}`,
      action: 'wallet.activated',
      entityType: 'wallet',
      entityId: walletId,
      actorId,
      occurredAt: occurredAt.toISOString(),
      metadata: { currency },
    });
  }

  private async append(body: Record<string, unknown>): Promise<void> {
    const baseUrl = process.env.ADMIN_BASE_URL;
    const token = process.env.INTERNAL_SERVICE_TOKEN;
    if (!baseUrl || !token) throw auditUnavailable();
    try {
      const response = await fetch(new URL('/internal/audit-events', baseUrl), {
        method: 'POST',
        signal: AbortSignal.timeout(2_000),
        headers: {
          'content-type': 'application/json',
          'x-internal-service-token': token,
          'x-request-id': this.requestContext.getRequestId(),
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`Admin returned HTTP ${response.status}.`);
    } catch {
      throw auditUnavailable();
    }
  }
}

function deterministicUuid(value: string): string {
  const bytes = createHash('sha256').update(value).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function auditUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: 'AUDIT_UNAVAILABLE',
    message: 'The required audit event could not be recorded.',
  });
}
