import { Injectable } from '@nestjs/common';
import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';
import { SERVICE_METADATA } from '../service-metadata.js';

export interface HttpMetricObservation {
  method: string;
  route: string;
  statusCode: number;
  durationSeconds: number;
}

@Injectable()
export class MetricsService {
  private readonly registry = new Registry();
  private readonly requests = new Counter({
    name: 'novapay_http_requests_total',
    help: 'Completed HTTP requests.',
    labelNames: ['method', 'route', 'status_class'],
    registers: [this.registry],
  });
  private readonly duration = new Histogram({
    name: 'novapay_http_request_duration_seconds',
    help: 'HTTP request duration in seconds.',
    labelNames: ['method', 'route', 'status_class'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });

  constructor() {
    this.registry.setDefaultLabels({ service: SERVICE_METADATA.name });
    collectDefaultMetrics({ register: this.registry, prefix: 'novapay_process_' });
  }

  observeHttp(observation: HttpMetricObservation): void {
    const labels = {
      method: observation.method,
      route: observation.route,
      status_class: String(Math.floor(observation.statusCode / 100)) + 'xx',
    };
    this.requests.inc(labels);
    this.duration.observe(labels, observation.durationSeconds);
  }

  metrics(): Promise<string> {
    return this.registry.metrics();
  }

  get prometheusRegistry(): Registry {
    return this.registry;
  }
}

