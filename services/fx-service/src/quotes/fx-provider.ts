import { Injectable, Logger, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

export interface FreshRate {
  rate: string;
  providerReference: string;
}

export abstract class FxProvider {
  abstract freshRate(sourceCurrency: string, targetCurrency: string): Promise<FreshRate>;
}

const RATES: Record<string, string> = {
  'USD:EUR': '0.920000000000',
  'EUR:USD': '1.086956521739',
  'USD:GBP': '0.790000000000',
  'GBP:USD': '1.265822784810',
  'USD:PKR': '278.500000000000',
  'PKR:USD': '0.003590664273',
};

@Injectable()
export class DeterministicFxProvider extends FxProvider {
  private readonly logger = new Logger(DeterministicFxProvider.name);

  async freshRate(sourceCurrency: string, targetCurrency: string): Promise<FreshRate> {
    if (process.env.FX_PROVIDER_MODE === 'unavailable') {
      this.logger.warn(JSON.stringify({
        event: 'fx.provider.failed',
        sourceCurrency,
        targetCurrency,
        code: 'FX_PROVIDER_UNAVAILABLE',
      }));
      throw new ServiceUnavailableException({
        code: 'FX_PROVIDER_UNAVAILABLE',
        message: 'The FX provider is temporarily unavailable.',
      });
    }
    const rate = RATES[`${sourceCurrency}:${targetCurrency}`];
    if (!rate) {
      throw new UnprocessableEntityException({
        code: 'UNSUPPORTED_CURRENCY_PAIR',
        message: 'The requested currency pair is not supported.',
      });
    }
    return { rate, providerReference: `local-${randomUUID()}` };
  }
}
