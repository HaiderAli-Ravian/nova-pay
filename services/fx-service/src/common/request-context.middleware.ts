import { randomUUID } from 'node:crypto';
import { Injectable, NestMiddleware } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { NextFunction, Request, Response } from 'express';
import { RequestContextService } from './request-context.service.js';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly requestContext: RequestContextService) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const providedRequestId = request.header('x-request-id');
    const requestId =
      providedRequestId !== undefined && isUUID(providedRequestId)
        ? providedRequestId
        : randomUUID();

    response.setHeader('X-Request-Id', requestId);
    this.requestContext.run({ requestId }, next);
  }
}
