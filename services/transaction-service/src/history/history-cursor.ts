import { BadRequestException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

const CURSOR_VERSION = 1;
const CURSOR_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/;

export interface HistoryCursorValue {
  occurredAt: Date;
  id: string;
}

interface HistoryCursorPayload {
  v: number;
  w: string;
  t: string;
  id: string;
}

export function encodeHistoryCursor(
  walletId: string,
  value: HistoryCursorValue,
): string {
  const payload = Buffer.from(
    JSON.stringify({
      v: CURSOR_VERSION,
      w: walletId,
      t: value.occurredAt.toISOString(),
      id: value.id,
    } satisfies HistoryCursorPayload),
  ).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function decodeHistoryCursor(
  walletId: string,
  cursor: string,
): HistoryCursorValue {
  try {
    if (cursor.length > 1_024 || !CURSOR_PATTERN.test(cursor)) {
      throw new Error('Invalid cursor encoding.');
    }
    const [encodedPayload, encodedSignature] = cursor.split('.');
    if (!encodedPayload || !encodedSignature) {
      throw new Error('Invalid cursor parts.');
    }
    const expected = Buffer.from(sign(encodedPayload), 'base64url');
    const received = Buffer.from(encodedSignature, 'base64url');
    if (
      received.toString('base64url') !== encodedSignature ||
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    ) {
      throw new Error('Invalid cursor signature.');
    }
    const decoded = Buffer.from(encodedPayload, 'base64url');
    if (decoded.toString('base64url') !== encodedPayload) {
      throw new Error('Non-canonical cursor encoding.');
    }
    const payload = JSON.parse(decoded.toString('utf8')) as Partial<HistoryCursorPayload>;
    if (
      payload.v !== CURSOR_VERSION ||
      payload.w !== walletId ||
      typeof payload.t !== 'string' ||
      typeof payload.id !== 'string' ||
      !isUuid(payload.w) ||
      !isUuid(payload.id)
    ) {
      throw new Error('Invalid cursor payload.');
    }
    const occurredAt = new Date(payload.t);
    if (Number.isNaN(occurredAt.getTime()) || occurredAt.toISOString() !== payload.t) {
      throw new Error('Invalid cursor timestamp.');
    }
    return { occurredAt, id: payload.id };
  } catch {
    throw new BadRequestException({
      code: 'INVALID_CURSOR',
      message: 'The history cursor is invalid.',
    });
  }
}

function sign(payload: string): string {
  return createHmac('sha256', historyCursorKey()).update(payload).digest('base64url');
}

function historyCursorKey(): Buffer {
  const encoded = process.env.HISTORY_CURSOR_HMAC_KEY;
  if (!encoded) {
    throw new Error('HISTORY_CURSOR_HMAC_KEY is required.');
  }
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encoded) {
    throw new Error('HISTORY_CURSOR_HMAC_KEY must be a canonical base64-encoded 32-byte key.');
  }
  return key;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
