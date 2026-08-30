import { Injectable } from '@nestjs/common';
import { InternalHttpClient } from './internal-http.client.js';
import { UpstreamHttpError } from './upstream-error.js';

export interface LedgerPosting {
  id: string;
  externalReference: string;
  status: 'POSTED';
  postingType: string;
  entries: Array<{
    ledgerAccountId: string;
    direction: string;
    amount: string;
    currency: string;
  }>;
}

export interface PostingCommand {
  externalReference: string;
  requestId: string;
  postingType: 'TRANSFER' | 'FX_TRANSFER';
  sourceCurrency: string;
  targetCurrency: string;
  sourceAmount: string;
  targetAmount: string;
  fxQuoteId?: string;
  lockedFxRate?: string;
  entries: Array<{
    walletId: string;
    direction: 'DEBIT' | 'CREDIT';
    amount: string;
    currency: string;
  }>;
}

export type DomesticPostingCommand = PostingCommand;

@Injectable()
export class LedgerClient {
  constructor(private readonly http: InternalHttpClient) {}

  post(command: PostingCommand): Promise<LedgerPosting> {
    return this.http.request(
      'ledger',
      process.env.LEDGER_BASE_URL,
      '/internal/ledger/postings',
      { method: 'POST', body: JSON.stringify(command) },
    );
  }

  async byReference(externalReference: string): Promise<LedgerPosting | null> {
    try {
      return await this.http.request(
        'ledger',
        process.env.LEDGER_BASE_URL,
        `/internal/ledger/postings/by-reference/${encodeURIComponent(externalReference)}`,
      );
    } catch (error) {
      if (error instanceof UpstreamHttpError && error.status === 404) return null;
      throw error;
    }
  }
}
