import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

@Injectable()
export class InternalServiceGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const supplied = request.header('x-internal-service-token') ?? '';
    const expected = process.env.INTERNAL_SERVICE_TOKEN ?? '';
    const left = Buffer.from(supplied);
    const right = Buffer.from(expected);
    if (!expected || left.length !== right.length || !timingSafeEqual(left, right)) {
      throw new UnauthorizedException({
        code: 'INTERNAL_AUTH_REQUIRED',
        message: 'Internal service authentication is required.',
      });
    }
    return true;
  }
}
