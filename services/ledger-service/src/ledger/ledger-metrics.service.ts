import { Injectable } from '@nestjs/common';
import { Counter, Gauge } from 'prom-client';
import { MetricsService } from '../observability/metrics.service.js';

@Injectable()
export class LedgerMetricsService {
  private succeeded = 0;
  private failed = 0;
  private invariantViolations = 0;
  private readonly postings: Counter<'result'>;
  private readonly invariantGauge: Gauge;

  constructor(metrics: MetricsService) {
    this.postings = new Counter({
      name: 'novapay_ledger_postings_total',
      help: 'Ledger posting outcomes.',
      labelNames: ['result'],
      registers: [metrics.prometheusRegistry],
    });
    this.invariantGauge = new Gauge({
      name: 'novapay_ledger_invariant_violations',
      help: 'Current count of unbalanced ledger transaction/currency groups.',
      registers: [metrics.prometheusRegistry],
    });
    this.invariantGauge.set(0);
  }

  recordSuccess(): void {
    this.succeeded += 1;
    this.postings.inc({ result: 'success' });
  }

  recordFailure(): void {
    this.failed += 1;
    this.postings.inc({ result: 'failure' });
  }

  setInvariantViolations(violations: number): void {
    this.invariantViolations = violations;
    this.invariantGauge.set(violations);
  }

  snapshot(): {
    postingSuccessTotal: number;
    postingFailureTotal: number;
    invariantViolations: number;
  } {
    return {
      postingSuccessTotal: this.succeeded,
      postingFailureTotal: this.failed,
      invariantViolations: this.invariantViolations,
    };
  }
}
