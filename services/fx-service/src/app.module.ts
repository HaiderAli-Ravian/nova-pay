import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { HttpExceptionFilter } from './common/http-exception.filter.js';
import { RequestContextMiddleware } from './common/request-context.middleware.js';
import { RequestContextService } from './common/request-context.service.js';
import { RequestLoggingInterceptor } from './common/request-logging.interceptor.js';
import { PrismaService } from './database/prisma.service.js';
import { PrincipalService } from './auth/principal.service.js';
import { InternalServiceGuard } from './common/internal-service.guard.js';
import { HealthController } from './health/health.controller.js';
import { ReadinessService } from './health/readiness.service.js';
import { InternalQuoteController, QuoteController } from './quotes/quote.controller.js';
import { DeterministicFxProvider, FxProvider } from './quotes/fx-provider.js';
import { QuoteService } from './quotes/quote.service.js';

@Module({
  controllers: [HealthController, QuoteController, InternalQuoteController],
  providers: [
    RequestContextService,
    PrismaService,
    ReadinessService,
    PrincipalService,
    InternalServiceGuard,
    QuoteService,
    DeterministicFxProvider,
    { provide: FxProvider, useExisting: DeterministicFxProvider },
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
