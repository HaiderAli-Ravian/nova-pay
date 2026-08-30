import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { SERVICE_METADATA } from '../service-metadata.js';
import { readServiceVersion } from '../service-version.js';

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
if (endpoint && process.env.OTEL_SDK_DISABLED !== 'true') {
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      'service.name': SERVICE_METADATA.name,
      'service.version': readServiceVersion(),
      'deployment.environment.name': process.env.NODE_ENV ?? 'development',
    }),
    traceExporter: new OTLPTraceExporter({
      url: new URL('/v1/traces', endpoint).toString(),
    }),
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (request) =>
          request.url?.startsWith('/health/') === true || request.url === '/metrics',
      }),
      new ExpressInstrumentation(),
      new UndiciInstrumentation(),
      new PgInstrumentation(),
      new IORedisInstrumentation(),
    ],
  });
  await sdk.start();
  process.once('beforeExit', () => void sdk.shutdown());
}
