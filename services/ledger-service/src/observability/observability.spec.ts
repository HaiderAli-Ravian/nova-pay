import { readFile } from 'node:fs/promises';
import { LedgerMetricsService } from '../ledger/ledger-metrics.service.js';
import { MetricsService } from './metrics.service.js';

describe('observability configuration', () => {
  it('exports low-cardinality HTTP and ledger invariant metrics', async () => {
    const metrics = new MetricsService();
    metrics.observeHttp({
      method: 'POST',
      route: '/internal/ledger/postings',
      statusCode: 201,
      durationSeconds: 0.025,
    });
    const ledger = new LedgerMetricsService(metrics);
    ledger.recordSuccess();
    ledger.setInvariantViolations(2);

    const output = await metrics.metrics();
    expect(output).toContain('novapay_http_requests_total');
    expect(output).toContain('route="/internal/ledger/postings"');
    expect(output).toContain('status_class="2xx"');
    expect(output).toContain('service="ledger-service"');
    expect(output).toContain('novapay_ledger_postings_total');
    expect(output).toContain('novapay_ledger_invariant_violations{service="ledger-service"} 2');
    expect(output).not.toMatch(/requestId|userId|transactionId/);
  });

  it('keeps the critical invariant alert and required dashboard queries provisioned', async () => {
    const repository = new URL('../../../../', import.meta.url);
    const alert = await readFile(new URL('infra/prometheus/alerts.yml', repository), 'utf8');
    const dashboard = await readFile(
      new URL('infra/grafana/dashboards/novapay-overview.json', repository),
      'utf8',
    );
    expect(alert).toContain('expr: novapay_ledger_invariant_violations > 0');
    expect(alert).toContain('severity: critical');
    expect(dashboard).toContain('histogram_quantile(0.95');
    expect(dashboard).toContain('histogram_quantile(0.99');
    expect(dashboard).toContain('novapay_http_requests_total');
  });
});
