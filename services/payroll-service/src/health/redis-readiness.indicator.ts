import { Injectable } from '@nestjs/common';
import { createConnection } from 'node:net';

@Injectable()
export class RedisReadinessIndicator {
  async checkConnection(): Promise<void> {
    const rawUrl = process.env.REDIS_URL;
    if (!rawUrl) {
      throw new Error('REDIS_URL is required.');
    }

    const redisUrl = new URL(rawUrl);
    if (redisUrl.protocol !== 'redis:') {
      throw new Error('REDIS_URL must use the redis protocol.');
    }

    const port = redisUrl.port ? Number(redisUrl.port) : 6379;
    const password = decodeURIComponent(redisUrl.password);
    const username = decodeURIComponent(redisUrl.username);
    const commands = password
      ? [encodeCommand('AUTH', ...(username ? [username, password] : [password])), encodeCommand('PING')]
      : [encodeCommand('PING')];

    await new Promise<void>((resolve, reject) => {
      const socket = createConnection({ host: redisUrl.hostname, port });
      let buffer = '';
      let settled = false;
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error('Redis readiness check timed out.'));
      }, 2_000);

      const finish = (error?: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        socket.end();
        error ? reject(error) : resolve();
      };

      socket.once('error', finish);
      socket.once('connect', () => socket.write(commands.join('')));
      socket.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        if (buffer.startsWith('-') || buffer.includes('\r\n-')) {
          finish(new Error('Redis rejected the readiness check.'));
          return;
        }
        if (buffer.includes('+PONG\r\n')) {
          finish();
        }
      });
    });
  }
}

function encodeCommand(...parts: string[]): string {
  return `*${parts.length}\r\n${parts
    .map((part) => `$${Buffer.byteLength(part)}\r\n${part}\r\n`)
    .join('')}`;
}
