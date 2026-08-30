import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { RequestContextService } from '../common/request-context.service.js';

export interface LedgerBalance {
  walletId: string;
  ledgerAccountId: string;
  available: string;
  currency: string;
  version: string;
}

interface ProvisionedAccount extends LedgerBalance {}

@Injectable()
export class LedgerClient {
  constructor(private readonly requestContext: RequestContextService) {}

  provision(walletId: string, currency: string): Promise<ProvisionedAccount> {
    return this.request<ProvisionedAccount>('/internal/ledger/accounts', {
      method: 'POST',
      body: JSON.stringify({ walletId, currency }),
    });
  }

  getBalance(walletId: string): Promise<LedgerBalance> {
    return this.request<LedgerBalance>(
      `/internal/ledger/wallets/${encodeURIComponent(walletId)}/balance`,
    );
  }

  async getBalances(walletIds: string[]): Promise<Map<string, LedgerBalance>> {
    if (walletIds.length === 0) {
      return new Map();
    }

    const response = await this.request<{ balances: LedgerBalance[] }>(
      '/internal/ledger/balances/query',
      { method: 'POST', body: JSON.stringify({ walletIds }) },
    );
    return new Map(response.balances.map((balance) => [balance.walletId, balance]));
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const baseUrl = process.env.LEDGER_BASE_URL;
    const token = process.env.INTERNAL_SERVICE_TOKEN;
    if (!baseUrl || !token) {
      throw new ServiceUnavailableException({
        code: 'LEDGER_UNAVAILABLE',
        message: 'Ledger service is not configured.',
      });
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
      const body = (await response.json()) as Record<string, unknown>;
      if (response.ok) {
        return body as T;
      }
      if (response.status === 409) {
        throw new ConflictException({
          code: typeof body.code === 'string' ? body.code : 'LEDGER_CONFLICT',
          message:
            typeof body.message === 'string'
              ? body.message
              : 'Ledger request conflicts with current state.',
        });
      }
      throw new Error(`Ledger returned HTTP ${response.status}.`);
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      throw new ServiceUnavailableException({
        code: 'LEDGER_UNAVAILABLE',
        message: 'Ledger service is temporarily unavailable.',
      });
    }
  }
}
