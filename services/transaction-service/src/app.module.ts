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
import { LedgerClient } from './clients/ledger.client.js';
import { FxClient } from './clients/fx.client.js';
import { HttpExceptionFilter } from './common/http-exception.filter.js';
import { InternalServiceGuard } from './common/internal-service.guard.js';
import { RequestContextMiddleware } from './common/request-context.middleware.js';
import { RequestContextService } from './common/request-context.service.js';
import { RequestLoggingInterceptor } from './common/request-logging.interceptor.js';
import { PrismaService } from './database/prisma.service.js';
import { HealthController } from './health/health.controller.js';
import { MetricsController } from './observability/metrics.controller.js';
import { MetricsService } from './observability/metrics.service.js';
import { ReadinessService } from './health/readiness.service.js';
import { HistoryProjectionService } from './history/history-projection.service.js';
import { ReconciliationService } from './transfers/reconciliation.service.js';
import {
  InternalTransferController,
  TransferController,
} from './transfers/transfer.controller.js';
import { TransferService } from './transfers/transfer.service.js';

@Module({
  controllers: [HealthController, MetricsController, TransferController, InternalTransferController],
  providers: [
    RequestContextService,
    MetricsService,
    PrismaService,
    ReadinessService,
    PrincipalService,
    InternalServiceGuard,
    InternalHttpClient,
    AccountClient,
    LedgerClient,
    FxClient,
    HistoryProjectionService,
    TransferService,
    ReconciliationService,
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
