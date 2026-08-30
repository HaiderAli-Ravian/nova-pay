import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { PrincipalService } from './auth/principal.service.js';
import { AuditClient } from './audit/audit.client.js';
import { HttpExceptionFilter } from './common/http-exception.filter.js';
import { InternalServiceGuard } from './common/internal-service.guard.js';
import { RequestContextMiddleware } from './common/request-context.middleware.js';
import { RequestContextService } from './common/request-context.service.js';
import { RequestLoggingInterceptor } from './common/request-logging.interceptor.js';
import { PrismaService } from './database/prisma.service.js';
import { HealthController } from './health/health.controller.js';
import { ReadinessService } from './health/readiness.service.js';
import { IdentityCryptoService } from './identity/identity-crypto.service.js';
import { IdentityController, InternalIdentityController } from './identity/identity.controller.js';
import { IdentityService } from './identity/identity.service.js';
import { LedgerClient } from './wallets/ledger.client.js';
import {
  InternalWalletController,
  WalletController,
} from './wallets/wallet.controller.js';
import { WalletService } from './wallets/wallet.service.js';

@Module({
  controllers: [
    HealthController,
    WalletController,
    InternalWalletController,
    IdentityController,
    InternalIdentityController,
  ],
  providers: [
    RequestContextService,
    PrismaService,
    ReadinessService,
    PrincipalService,
    InternalServiceGuard,
    LedgerClient,
    AuditClient,
    IdentityCryptoService,
    IdentityService,
    WalletService,
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
