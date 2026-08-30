import { Injectable } from '@nestjs/common';
import { InternalHttpClient } from './internal-http.client.js';

export interface WalletValidation {
  walletId: string;
  ownerExternalRef: string;
  currency: string;
  status: string;
}

@Injectable()
export class AccountClient {
  constructor(private readonly http: InternalHttpClient) {}

  validation(walletId: string): Promise<WalletValidation> {
    return this.http.request(
      'account',
      process.env.ACCOUNT_BASE_URL,
      `/internal/wallets/${encodeURIComponent(walletId)}/validation`,
    );
  }
}
