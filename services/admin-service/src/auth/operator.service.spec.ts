import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { OperatorService } from './operator.service.js';

function request(authorization?: string): Request {
  return { header: () => authorization } as unknown as Request;
}

describe('OperatorService', () => {
  const service = new OperatorService();

  it('accepts only the distinct operator bearer scope', () => {
    expect(service.fromRequest(request('Bearer operator:ops-1'))).toBe('ops-1');
    expect(() => service.fromRequest(request('Bearer customer-1'))).toThrow(ForbiddenException);
    expect(() => service.fromRequest(request())).toThrow(UnauthorizedException);
  });
});
