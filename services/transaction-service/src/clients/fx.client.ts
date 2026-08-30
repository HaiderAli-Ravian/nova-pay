import { Injectable } from '@nestjs/common';
import { InternalHttpClient } from './internal-http.client.js';

export interface ConsumedQuote {
  quoteId: string;
  sourceCurrency: string;
  targetCurrency: string;
  sourceAmount: string;
  targetAmount: string;
  rate: string;
  status: 'CONSUMED';
  issuedAt: string;
  expiresAt: string;
}

export interface ConsumeQuoteCommand {
  transferId: string;
  clientId: string;
  sourceCurrency: string;
  targetCurrency: string;
  sourceAmount: string;
}

@Injectable()
export class FxClient {
  constructor(private readonly http: InternalHttpClient) {}

  consume(quoteId: string, command: ConsumeQuoteCommand): Promise<ConsumedQuote> {
    return this.http.request(
      'fx',
      process.env.FX_BASE_URL,
      `/internal/fx/quotes/${encodeURIComponent(quoteId)}/consume`,
      { method: 'POST', body: JSON.stringify(command) },
    );
  }
}
