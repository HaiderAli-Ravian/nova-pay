import { Injectable } from '@nestjs/common';
import { RedisConnectionService } from './redis-connection.service.js';

const RENEW_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('pexpire', KEYS[1], ARGV[2])
end
return 0`;

const RELEASE_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0`;

@Injectable()
export class EmployerLeaseService {
  constructor(private readonly redis: RedisConnectionService) {}

  async acquire(employerId: string, token: string, ttlMs: number): Promise<boolean> {
    const result = await this.redis.connection.set(
      leaseKey(employerId),
      token,
      'PX',
      ttlMs,
      'NX',
    );
    return result === 'OK';
  }

  async renew(employerId: string, token: string, ttlMs: number): Promise<boolean> {
    const result = await this.redis.connection.eval(
      RENEW_SCRIPT,
      1,
      leaseKey(employerId),
      token,
      String(ttlMs),
    );
    return result === 1;
  }

  async release(employerId: string, token: string): Promise<boolean> {
    const result = await this.redis.connection.eval(
      RELEASE_SCRIPT,
      1,
      leaseKey(employerId),
      token,
    );
    return result === 1;
  }
}

function leaseKey(employerId: string): string {
  return `novapay:payroll:employer:${encodeURIComponent(employerId)}:lease`;
}
