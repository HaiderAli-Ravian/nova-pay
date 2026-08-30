import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { PrincipalService } from './auth/principal.service.js';
import { AccountClient } from './clients/account.client.js';
import { InternalHttpClient } from './clients/internal-http.client.js';
import { TransactionClient } from './clients/transaction.client.js';
import { HttpExceptionFilter } from './common/http-exception.filter.js';
import { InternalServiceGuard } from './common/internal-service.guard.js';
import { RequestContextMiddleware } from './common/request-context.middleware.js';
import { RequestContextService } from './common/request-context.service.js';
import { RequestLoggingInterceptor } from './common/request-logging.interceptor.js';
import { PrismaService } from './database/prisma.service.js';
import { HealthController } from './health/health.controller.js';
import { ReadinessService } from './health/readiness.service.js';
import { RedisReadinessIndicator } from './health/redis-readiness.indicator.js';
import { InternalPayrollController, PayrollController } from './payroll/payroll.controller.js';
import { PayrollProcessorService } from './payroll/payroll-processor.service.js';
import { PayrollService } from './payroll/payroll.service.js';
import { EmployerLeaseService } from './queue/employer-lease.service.js';
import { PayrollQueueService } from './queue/payroll-queue.service.js';
import { PayrollRecoveryService } from './queue/payroll-recovery.service.js';
import { PayrollWorkerService } from './queue/payroll-worker.service.js';
import { RedisConnectionService } from './queue/redis-connection.service.js';

@Module({
  controllers: [HealthController, PayrollController, InternalPayrollController],
  providers: [
    RequestContextService,
    PrismaService,
    ReadinessService,
    RedisReadinessIndicator,
    PrincipalService,
    InternalServiceGuard,
    InternalHttpClient,
    AccountClient,
    TransactionClient,
    RedisConnectionService,
    EmployerLeaseService,
    PayrollQueueService,
    PayrollService,
    PayrollProcessorService,
    PayrollWorkerService,
    PayrollRecoveryService,
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestLoggingInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestContextMiddleware)
      .forRoutes({ path: '{*splat}', method: RequestMethod.ALL });
  }
}
