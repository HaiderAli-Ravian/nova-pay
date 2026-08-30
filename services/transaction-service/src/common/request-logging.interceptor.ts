import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';
import { trace } from '@opentelemetry/api';
import { tap } from 'rxjs/operators';
import { RequestContextService } from './request-context.service.js';
import { MetricsService } from '../observability/metrics.service.js';

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HttpRequest');

  constructor(
    private readonly requestContext: RequestContextService,
    private readonly metrics: MetricsService,
  ) {}

  intercept(
    executionContext: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const request = executionContext.switchToHttp().getRequest<Request>();
    const response = executionContext.switchToHttp().getResponse<Response>();
    const requestId = this.requestContext.getRequestId();
    const route = request.route?.path
      ? `${request.baseUrl}${String(request.route.path)}`
      : request.path;
    const metricRoute = request.route?.path ? route : 'unmatched';
    const startedAt = process.hrtime.bigint();
    const traceId = trace.getActiveSpan()?.spanContext().traceId;

    this.logger.log({
      event: 'http.request.started',
      requestId,
      method: request.method,
      route,
      timestamp: new Date().toISOString(),
    });

    return next.handle().pipe(
      tap({
        complete: () => {
          const durationMs = elapsedMilliseconds(startedAt);
          this.metrics.observeHttp({
            method: request.method,
            route: metricRoute,
            statusCode: response.statusCode,
            durationSeconds: durationMs / 1_000,
          });
          this.logger.log({
            event: 'http.request.completed',
            requestId,
            method: request.method,
            route,
            statusCode: response.statusCode,
            durationMs,
            userId: this.requestContext.get()?.userId,
            transactionId: this.requestContext.get()?.transactionId,
            traceId,
            timestamp: new Date().toISOString(),
          });
        },
        error: (error: unknown) => {
          const statusCode =
            error instanceof HttpException ? error.getStatus() : 500;
          const durationMs = elapsedMilliseconds(startedAt);
          this.metrics.observeHttp({
            method: request.method,
            route: metricRoute,
            statusCode,
            durationSeconds: durationMs / 1_000,
          });

          this.logger.error({
            event: 'http.request.failed',
            requestId,
            method: request.method,
            route,
            statusCode,
            durationMs,
            userId: this.requestContext.get()?.userId,
            transactionId: this.requestContext.get()?.transactionId,
            traceId,
            timestamp: new Date().toISOString(),
          });
        },
      }),
    );
  }
}

function elapsedMilliseconds(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}
