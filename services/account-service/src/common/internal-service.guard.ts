import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';

@Injectable()
export class InternalServiceGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const configured = process.env.INTERNAL_SERVICE_TOKEN;
    const supplied = request.header('x-internal-service-token');

    if (!configured || !supplied || !secureEqual(configured, supplied)) {
      throw new UnauthorizedException({
        code: 'INTERNAL_AUTH_REQUIRED',
        message: 'Internal service authentication is required.',
      });
    }

    return true;
  }
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}
