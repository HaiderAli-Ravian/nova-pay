import { Injectable } from '@nestjs/common';
import { RequestContextService } from '../common/request-context.service.js';
import { UpstreamHttpError, UpstreamUnavailableError } from './upstream-error.js';

@Injectable()
export class InternalHttpClient {
  constructor(private readonly requestContext: RequestContextService) {}

  async request<T>(
    service: 'account' | 'ledger' | 'fx',
    baseUrl: string | undefined,
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const token = process.env.INTERNAL_SERVICE_TOKEN;
    if (!baseUrl || !token) {
      throw new UpstreamUnavailableError(service);
    }
    try {
      const response = await fetch(new URL(path, baseUrl), {
        ...init,
        signal: AbortSignal.timeout(2_000),
        headers: {
          'content-type': 'application/json',
          'x-internal-service-token': token,
          'x-request-id': this.requestContext.getRequestId(),
          ...init.headers,
        },
      });
      const body = await readBody(response);
      if (!response.ok) {
        throw new UpstreamHttpError(
          service,
          response.status,
          typeof body.code === 'string' ? body.code : `${service.toUpperCase()}_ERROR`,
          typeof body.message === 'string' ? body.message : `${service} request failed.`,
        );
      }
      return body as T;
    } catch (error) {
      if (error instanceof UpstreamHttpError) throw error;
      throw new UpstreamUnavailableError(service);
    }
  }
}

async function readBody(response: Response): Promise<Record<string, unknown>> {
  try {
    const value = (await response.json()) as unknown;
    return typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
