import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { RequestContextService } from '../common/request-context.service.js';

const PRINCIPAL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,99}$/;

@Injectable()
export class PrincipalService {
  constructor(private readonly requestContext: RequestContextService) {}

  fromRequest(request: Request): string {
    const authorization = request.header('authorization');
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length).trim()
      : '';
    if (!PRINCIPAL_PATTERN.test(token)) {
      throw new UnauthorizedException({
        code: 'INVALID_PRINCIPAL',
        message: 'A valid bearer principal is required.',
      });
    }
    this.requestContext.setUserId(token);
    return token;
  }
}
