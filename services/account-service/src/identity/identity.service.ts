import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service.js';
import { AuditClient } from '../audit/audit.client.js';
import {
  canonicalIdentity,
  IdentityCryptoService,
  normalizeIdentity,
  type IdentityPayload,
} from './identity-crypto.service.js';
import {
  type UpdateUserIdentityDto,
  type UserIdentityResponseDto,
} from './dto/user-identity.dto.js';

@Injectable()
export class IdentityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: IdentityCryptoService,
    private readonly audit: AuditClient,
  ) {}

  async ensureUser(externalRef: string) {
    const existing = await this.prisma.db.user.findUnique({ where: { externalRef } });
    if (existing) {
      if (existing.identityCiphertext.length === 0) {
        return this.prisma.db.user.update({
          where: { id: existing.id },
          data: this.crypto.encrypt(existing.id, {}),
        });
      }
      return existing;
    }
    const id = randomUUID();
    try {
      return await this.prisma.db.user.create({
        data: {
          id,
          externalRef,
          ...this.crypto.encrypt(id, {}),
          status: 'ACTIVE',
        },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return this.prisma.db.user.findUniqueOrThrow({ where: { externalRef } });
    }
  }

  async update(externalRef: string, input: UpdateUserIdentityDto): Promise<UserIdentityResponseDto> {
    const user = await this.ensureUser(externalRef);
    const normalized = normalizeIdentity(input);
    const canonical = canonicalIdentity(normalized);
    const existing = this.crypto.decrypt(user);
    let updated = user;
    if (canonicalIdentity(existing) !== canonical) {
      try {
        updated = await this.prisma.db.user.update({
          where: { id: user.id },
          data: this.crypto.encrypt(user.id, normalized),
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException({
            code: 'EMAIL_ALREADY_EXISTS',
            message: 'The normalized email is already assigned to another user.',
          });
        }
        throw error;
      }
    }
    await this.audit.identityUpdated(user.id, externalRef, canonical, updated.updatedAt);
    return toResponse(updated.id, updated.externalRef, this.crypto.decrypt(updated));
  }

  async get(externalRef: string): Promise<UserIdentityResponseDto> {
    const user = await this.prisma.db.user.findUnique({ where: { externalRef } });
    if (!user) throw identityNotFound();
    return toResponse(user.id, user.externalRef, this.crypto.decrypt(user));
  }

  async lookup(email: string) {
    const user = await this.prisma.db.user.findFirst({
      where: { emailLookupHmac: this.crypto.emailDigest(email) },
      select: { id: true, externalRef: true, status: true },
    });
    if (!user) throw identityNotFound();
    return { userId: user.id, externalRef: user.externalRef, status: user.status };
  }
}

function toResponse(
  userId: string,
  externalRef: string,
  identity: IdentityPayload,
): UserIdentityResponseDto {
  return { userId, externalRef, ...identity };
}

function identityNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'USER_IDENTITY_NOT_FOUND',
    message: 'User identity not found.',
  });
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}
