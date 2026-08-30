import { Injectable } from '@nestjs/common';
import { InternalHttpClient } from './internal-http.client.js';

export interface PayrollTransferResponse {
  transferId: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'REVERSED';
  failure?: { code: string; message: string };
}

@Injectable()
export class TransactionClient {
  constructor(private readonly http: InternalHttpClient) {}

  createDomestic(
    employerId: string,
    idempotencyKey: string,
    command: {
      senderWalletId: string;
      recipientWalletId: string;
      amount: string;
      currency: string;
    },
  ): Promise<PayrollTransferResponse> {
    return this.http.request(
      'transaction',
      process.env.TRANSACTION_BASE_URL,
      '/transfers',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${employerId}`,
          'idempotency-key': idempotencyKey,
        },
        body: JSON.stringify(command),
      },
      false,
    );
  }

  get(transferId: string): Promise<PayrollTransferResponse> {
    return this.http.request(
      'transaction',
      process.env.TRANSACTION_BASE_URL,
      `/internal/transfers/${encodeURIComponent(transferId)}`,
    );
  }
}
