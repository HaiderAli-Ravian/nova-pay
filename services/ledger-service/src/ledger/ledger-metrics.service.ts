import { Injectable } from '@nestjs/common';

@Injectable()
export class LedgerMetricsService {
  private succeeded = 0;
  private failed = 0;

  recordSuccess(): void {
    this.succeeded += 1;
  }

  recordFailure(): void {
    this.failed += 1;
  }

  snapshot(): { postingSuccessTotal: number; postingFailureTotal: number } {
    return { postingSuccessTotal: this.succeeded, postingFailureTotal: this.failed };
  }
}
