import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { HttpExceptionFilter } from './common/http-exception.filter.js';
import { InternalServiceGuard } from './common/internal-service.guard.js';
import { RequestContextMiddleware } from './common/request-context.middleware.js';
import { RequestContextService } from './common/request-context.service.js';
import { RequestLoggingInterceptor } from './common/request-logging.interceptor.js';
import { PrismaService } from './database/prisma.service.js';
import { HealthController } from './health/health.controller.js';
import { ReadinessService } from './health/readiness.service.js';
import { LedgerController } from './ledger/ledger.controller.js';
import { LedgerAccountService } from './ledger/ledger-account.service.js';
import { LedgerMetricsService } from './ledger/ledger-metrics.service.js';
import { PostingService } from './ledger/posting.service.js';

@Module({
  controllers: [HealthController, LedgerController],
  providers: [
    RequestContextService,
    PrismaService,
    ReadinessService,
    InternalServiceGuard,
    LedgerAccountService,
    LedgerMetricsService,
    PostingService,
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
