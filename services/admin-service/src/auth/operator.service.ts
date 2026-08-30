import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { RequestContextService } from '../common/request-context.service.js';

const OPERATOR_PATTERN = /^operator:([A-Za-z0-9][A-Za-z0-9._-]{0,79})$/;

@Injectable()
export class OperatorService {
  constructor(private readonly requestContext: RequestContextService) {}

  fromRequest(request: Request): string {
    const authorization = request.header('authorization');
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException({
        code: 'INVALID_PRINCIPAL',
        message: 'A valid bearer principal is required.',
      });
    }
    const match = OPERATOR_PATTERN.exec(authorization.slice('Bearer '.length).trim());
    if (!match) {
      throw new ForbiddenException({
        code: 'OPERATOR_SCOPE_REQUIRED',
        message: 'A distinct operator principal is required.',
      });
    }
    const operatorId = match[1] as string;
    this.requestContext.setUserId('operator:' + operatorId);
    return operatorId;
  }
}
