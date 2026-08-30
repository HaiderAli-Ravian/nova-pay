import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { AdminAuditController, InternalAuditController } from './audit/audit.controller.js';
import { AuditService } from './audit/audit.service.js';
import { OperatorService } from './auth/operator.service.js';
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

@Module({
  controllers: [HealthController, MetricsController, AdminAuditController, InternalAuditController],
  providers: [
    RequestContextService,
    MetricsService,
    PrismaService,
    ReadinessService,
    OperatorService,
    InternalServiceGuard,
    AuditService,
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
