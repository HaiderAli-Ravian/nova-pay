import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma, type AuditRecord } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import type { AppendAuditEventDto } from './dto/audit-event.dto.js';
import type {
  AuditRecordResponseDto,
  AuditVerificationResponseDto,
} from './dto/audit-response.dto.js';

const GENESIS_HASH = '0'.repeat(64);
const DOMAIN_TAG = 'novapay:audit-chain:v1';
const DENIED_METADATA_KEY = /(authorization|cookie|token|password|secret|card|kek|dek|plaintext|legal.?name|email|phone|address|government|tax|identity)/i;
const SAFE_METADATA_KEY = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

interface NormalizedAuditEvent {
  eventId: string;
  streamKey: string;
  action: string;
  entityType: string;
  entityId: string;
  actorId: string | null;
  occurredAt: Date;
  metadata: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async append(input: AppendAuditEventDto): Promise<AuditRecordResponseDto> {
    return this.appendNormalized(normalizeEvent(input), false);
  }

  async appendOperatorAction(input: AppendAuditEventDto): Promise<AuditRecordResponseDto> {
    return this.appendNormalized(normalizeEvent(input), true);
  }

  async verify(streamKey: string): Promise<AuditVerificationResponseDto> {
    const stream = await this.prisma.db.auditStream.findUnique({ where: { streamKey } });
    if (!stream) throw streamNotFound();
    const records = await this.prisma.db.auditRecord.findMany({
      where: { streamKey },
      orderBy: { sequence: 'asc' },
    });
    let expectedSequence = 1n;
    let previousHash = GENESIS_HASH;
    let recordsChecked = 0;
    let firstInvalidSequence: bigint | null = null;
    for (const record of records) {
      recordsChecked += 1;
      if (record.sequence !== expectedSequence || record.previousHash !== previousHash) {
        firstInvalidSequence = expectedSequence;
        break;
      }
      const expectedHash = computeAuditHash({
        streamKey: record.streamKey,
        sequence: record.sequence,
        previousHash,
        action: record.action,
        entityType: record.entityType,
        entityId: record.entityId,
        actorId: record.actorId,
        occurredAt: record.occurredAt,
        metadata: asMetadata(record.metadata),
      });
      if (expectedHash !== record.currentHash) {
        firstInvalidSequence = record.sequence;
        break;
      }
      previousHash = record.currentHash;
      expectedSequence += 1n;
    }
    if (
      firstInvalidSequence === null &&
      (stream.lastSequence !== expectedSequence - 1n || stream.lastHash !== previousHash)
    ) {
      firstInvalidSequence = expectedSequence;
    }
    const result = {
      streamKey,
      valid: firstInvalidSequence === null,
      recordsChecked,
      firstInvalidSequence: firstInvalidSequence?.toString() ?? null,
    };
    if (!result.valid) {
      this.logger.error({
        event: 'audit.verification.failed',
        streamKey,
        firstInvalidSequence: result.firstInvalidSequence,
      });
    }
    return result;
  }

  async records(streamKey: string): Promise<AuditRecordResponseDto[]> {
    const stream = await this.prisma.db.auditStream.findUnique({ where: { streamKey } });
    if (!stream) throw streamNotFound();
    const records = await this.prisma.db.auditRecord.findMany({
      where: { streamKey },
      orderBy: { sequence: 'asc' },
      take: 100,
    });
    return records.map(toResponse);
  }

  private async appendNormalized(
    input: NormalizedAuditEvent,
    acceptOperatorRetry: boolean,
  ): Promise<AuditRecordResponseDto> {
    const prior = await this.prisma.db.auditRecord.findUnique({ where: { eventId: input.eventId } });
    if (prior) return this.resolveExisting(prior, input, acceptOperatorRetry);
    try {
      const record = await this.prisma.db.$transaction(async (database) => {
        await database.$executeRaw`
          INSERT INTO "audit_streams" ("stream_key")
          VALUES (${input.streamKey})
          ON CONFLICT ("stream_key") DO NOTHING
        `;
        const heads = await database.$queryRaw<Array<{ lastSequence: bigint; lastHash: string }>>`
          SELECT "last_sequence" AS "lastSequence", "last_hash" AS "lastHash"
          FROM "audit_streams"
          WHERE "stream_key" = ${input.streamKey}
          FOR UPDATE
        `;
        const existing = await database.auditRecord.findUnique({ where: { eventId: input.eventId } });
        if (existing) return existing;
        const head = heads[0];
        if (!head) throw new Error('AUDIT_STREAM_LOCK_FAILED');
        const sequence = head.lastSequence + 1n;
        const currentHash = computeAuditHash({
          streamKey: input.streamKey,
          sequence,
          previousHash: head.lastHash,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId,
          actorId: input.actorId,
          occurredAt: input.occurredAt,
          metadata: input.metadata,
        });
        const created = await database.auditRecord.create({
          data: {
            eventId: input.eventId,
            streamKey: input.streamKey,
            sequence,
            action: input.action,
            entityType: input.entityType,
            entityId: input.entityId,
            actorId: input.actorId,
            occurredAt: input.occurredAt,
            metadata: input.metadata as Prisma.InputJsonValue,
            previousHash: head.lastHash,
            currentHash,
          },
        });
        await database.auditStream.update({
          where: { streamKey: input.streamKey },
          data: { lastSequence: sequence, lastHash: currentHash },
        });
        return created;
      });
      return this.resolveExisting(record, input, acceptOperatorRetry);
    } catch (error) {
      if (isUniqueConflict(error)) {
        const winner = await this.prisma.db.auditRecord.findUnique({ where: { eventId: input.eventId } });
        if (winner) return this.resolveExisting(winner, input, acceptOperatorRetry);
      }
      throw error;
    }
  }

  private resolveExisting(
    record: AuditRecord,
    input: NormalizedAuditEvent,
    acceptOperatorRetry: boolean,
  ): AuditRecordResponseDto {
    const identical =
      record.streamKey === input.streamKey &&
      record.action === input.action &&
      record.entityType === input.entityType &&
      record.entityId === input.entityId &&
      record.actorId === input.actorId &&
      (acceptOperatorRetry || record.occurredAt.getTime() === input.occurredAt.getTime()) &&
      canonicalMetadata(asMetadata(record.metadata)) === canonicalMetadata(input.metadata);
    if (!identical) {
      throw new ConflictException({
        code: 'AUDIT_EVENT_ID_REUSED',
        message: 'The audit event ID was already used for different canonical data.',
      });
    }
    return toResponse(record);
  }
}

export function sanitizeMetadata(value: Record<string, unknown>): Record<string, unknown> {
  return sanitizeObject(value, 0);
}

export function computeAuditHash(input: {
  streamKey: string;
  sequence: bigint;
  previousHash: string;
  action: string;
  entityType: string;
  entityId: string;
  actorId: string | null;
  occurredAt: Date;
  metadata: Record<string, unknown>;
}): string {
  const canonical = JSON.stringify({
    streamKey: input.streamKey,
    sequence: input.sequence.toString(),
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    actorId: input.actorId,
    occurredAt: input.occurredAt.toISOString(),
    metadata: sortObject(input.metadata),
  });
  return createHash('sha256')
    .update(DOMAIN_TAG)
    .update('\0')
    .update(input.previousHash)
    .update('\0')
    .update(canonical)
    .digest('hex');
}

function normalizeEvent(input: AppendAuditEventDto): NormalizedAuditEvent {
  const occurredAt = new Date(input.occurredAt);
  if (!Number.isFinite(occurredAt.getTime())) {
    throw new BadRequestException({ code: 'INVALID_OCCURRED_AT', message: 'occurredAt is invalid.' });
  }
  return {
    eventId: input.eventId,
    streamKey: input.streamKey,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    actorId: input.actorId ?? null,
    occurredAt,
    metadata: sanitizeMetadata(input.metadata ?? {}),
  };
}

function sanitizeObject(value: Record<string, unknown>, depth: number): Record<string, unknown> {
  if (depth > 4 || Object.keys(value).length > 40) throw rejectedMetadata();
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    if (!SAFE_METADATA_KEY.test(key) || DENIED_METADATA_KEY.test(key)) throw rejectedMetadata();
    result[key] = sanitizeValue(value[key], depth + 1);
  }
  return result;
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > 4) throw rejectedMetadata();
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.length <= 256) return value;
  if (Array.isArray(value) && value.length <= 20) return value.map((item) => sanitizeValue(item, depth + 1));
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return sanitizeObject(value as Record<string, unknown>, depth);
  }
  throw rejectedMetadata();
}

function sortObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.keys(value).sort().map((key) => [
    key,
    value[key] && typeof value[key] === 'object' && !Array.isArray(value[key])
      ? sortObject(value[key] as Record<string, unknown>)
      : Array.isArray(value[key])
        ? (value[key] as unknown[]).map((item) => item && typeof item === 'object' && !Array.isArray(item)
            ? sortObject(item as Record<string, unknown>)
            : item)
        : value[key],
  ]));
}

function canonicalMetadata(value: Record<string, unknown>): string {
  return JSON.stringify(sortObject(value));
}

function asMetadata(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toResponse(record: AuditRecord): AuditRecordResponseDto {
  return {
    eventId: record.eventId,
    streamKey: record.streamKey,
    sequence: record.sequence.toString(),
    action: record.action,
    entityType: record.entityType,
    entityId: record.entityId,
    actorId: record.actorId,
    occurredAt: record.occurredAt.toISOString(),
    metadata: asMetadata(record.metadata),
    previousHash: record.previousHash,
    currentHash: record.currentHash,
  };
}

function rejectedMetadata(): BadRequestException {
  return new BadRequestException({
    code: 'AUDIT_METADATA_REJECTED',
    message: 'Audit metadata contains a disallowed key or value.',
  });
}

function streamNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'AUDIT_STREAM_NOT_FOUND',
    message: 'Audit stream not found.',
  });
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
