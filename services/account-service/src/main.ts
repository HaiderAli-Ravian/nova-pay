import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApplication } from './bootstrap.js';
import {
  loadEnvironment,
  requireSecretEnvironmentVariable,
  requireUrlEnvironmentVariable,
} from './common/environment.js';
import { SERVICE_METADATA } from './service-metadata.js';
import { readServiceVersion } from './service-version.js';

async function bootstrap(): Promise<void> {
  const environment = loadEnvironment(SERVICE_METADATA.defaultPort);
  requireUrlEnvironmentVariable('DATABASE_URL', ['postgres:', 'postgresql:']);
  requireUrlEnvironmentVariable('LEDGER_BASE_URL', ['http:', 'https:']);
  requireSecretEnvironmentVariable('INTERNAL_SERVICE_TOKEN');
  const version = readServiceVersion();
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  configureApplication(app, {
    ...SERVICE_METADATA,
    version,
  });

  await app.listen(environment.port, '0.0.0.0');

  new Logger('Bootstrap').log({
    event: 'service.started',
    service: SERVICE_METADATA.name,
    version,
    port: environment.port,
    nodeEnv: environment.nodeEnv,
    timestamp: new Date().toISOString(),
  });
}

bootstrap().catch((error: unknown) => {
  new Logger('Bootstrap').error({
    event: 'service.start_failed',
    errorName: error instanceof Error ? error.name : 'UnknownError',
    timestamp: new Date().toISOString(),
  });
  process.exitCode = 1;
});
