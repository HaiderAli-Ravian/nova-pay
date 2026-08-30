import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import {
  requireEnvironmentVariable,
  requireUrlEnvironmentVariable,
} from './common/environment.js';

async function bootstrapWorker(): Promise<void> {
  requireUrlEnvironmentVariable('DATABASE_URL', ['postgres:', 'postgresql:']);
  requireUrlEnvironmentVariable('REDIS_URL', ['redis:']);
  requireUrlEnvironmentVariable('ACCOUNT_BASE_URL', ['http:', 'https:']);
  requireUrlEnvironmentVariable('TRANSACTION_BASE_URL', ['http:', 'https:']);
  requireEnvironmentVariable('INTERNAL_SERVICE_TOKEN');
  process.env.PAYROLL_WORKER_ENABLED = 'true';
  const application = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: true,
  });
  application.enableShutdownHooks();
  new Logger('PayrollWorker').log({ event: 'payroll.worker.started' });
}

bootstrapWorker().catch((error: unknown) => {
  new Logger('PayrollWorker').error({
    event: 'payroll.worker.start_failed',
    errorName: error instanceof Error ? error.name : 'UnknownError',
  });
  process.exitCode = 1;
});
