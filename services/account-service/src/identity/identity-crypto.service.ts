import { Injectable, InternalServerErrorException } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'node:crypto';

const IDENTITY_SCHEMA = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export interface IdentityPayload {
  legalName: string | null;
  email: string | null;
  phone: string | null;
  postalAddress: string | null;
  governmentId: string | null;
}

export interface EncryptedIdentity {
  identityCiphertext: Uint8Array<ArrayBuffer>;
  identityIv: Uint8Array<ArrayBuffer>;
  identityAuthTag: Uint8Array<ArrayBuffer>;
  encryptedDek: Uint8Array<ArrayBuffer>;
  dekIv: Uint8Array<ArrayBuffer>;
  dekAuthTag: Uint8Array<ArrayBuffer>;
  keyVersion: string;
  emailLookupHmac: Uint8Array<ArrayBuffer> | null;
}

export interface StoredEncryptedIdentity extends EncryptedIdentity {
  id: string;
}

@Injectable()
export class IdentityCryptoService {
  encrypt(userId: string, input: Partial<IdentityPayload>): EncryptedIdentity {
    const payload = normalizeIdentity(input);
    const { activeVersion, keys, lookupKey } = loadKeyConfiguration();
    const dek = randomBytes(KEY_BYTES);
    try {
      const identityIv = randomBytes(IV_BYTES);
      const identity = encryptAesGcm(
        dek,
        identityIv,
        Buffer.from(canonicalIdentity(payload)),
        identityAad(userId),
      );
      const dekIv = randomBytes(IV_BYTES);
      const wrapped = encryptAesGcm(
        keys.get(activeVersion) as Buffer,
        dekIv,
        dek,
        dekAad(userId, activeVersion),
      );
      return {
        identityCiphertext: toBytes(identity.ciphertext),
        identityIv: toBytes(identityIv),
        identityAuthTag: toBytes(identity.authTag),
        encryptedDek: toBytes(wrapped.ciphertext),
        dekIv: toBytes(dekIv),
        dekAuthTag: toBytes(wrapped.authTag),
        keyVersion: activeVersion,
        emailLookupHmac: payload.email
          ? toBytes(createHmac('sha256', lookupKey).update(payload.email).digest())
          : null,
      };
    } finally {
      dek.fill(0);
    }
  }

  decrypt(record: StoredEncryptedIdentity): IdentityPayload {
    if (record.identityCiphertext.length === 0) return normalizeIdentity({});
    const { keys } = loadKeyConfiguration();
    const kek = keys.get(record.keyVersion);
    if (!kek) throw decryptionFailure();
    let dek: Buffer | undefined;
    try {
      dek = decryptAesGcm(
        kek,
        Buffer.from(record.dekIv),
        Buffer.from(record.encryptedDek),
        Buffer.from(record.dekAuthTag),
        dekAad(record.id, record.keyVersion),
      );
      const plaintext = decryptAesGcm(
        dek,
        Buffer.from(record.identityIv),
        Buffer.from(record.identityCiphertext),
        Buffer.from(record.identityAuthTag),
        identityAad(record.id),
      );
      return parseIdentity(plaintext);
    } catch {
      throw decryptionFailure();
    } finally {
      dek?.fill(0);
    }
  }

  rewrapDek(record: StoredEncryptedIdentity): Pick<EncryptedIdentity, 'encryptedDek' | 'dekIv' | 'dekAuthTag' | 'keyVersion'> {
    const { activeVersion, keys } = loadKeyConfiguration();
    const oldKek = keys.get(record.keyVersion);
    const newKek = keys.get(activeVersion);
    if (!oldKek || !newKek) throw decryptionFailure();
    let dek: Buffer | undefined;
    try {
      dek = decryptAesGcm(
        oldKek,
        Buffer.from(record.dekIv),
        Buffer.from(record.encryptedDek),
        Buffer.from(record.dekAuthTag),
        dekAad(record.id, record.keyVersion),
      );
      const dekIv = randomBytes(IV_BYTES);
      const wrapped = encryptAesGcm(
        newKek,
        dekIv,
        dek,
        dekAad(record.id, activeVersion),
      );
      return {
        encryptedDek: toBytes(wrapped.ciphertext),
        dekIv: toBytes(dekIv),
        dekAuthTag: toBytes(wrapped.authTag),
        keyVersion: activeVersion,
      };
    } catch {
      throw decryptionFailure();
    } finally {
      dek?.fill(0);
    }
  }

  emailDigest(email: string): Uint8Array<ArrayBuffer> {
    const { lookupKey } = loadKeyConfiguration();
    return toBytes(createHmac('sha256', lookupKey).update(normalizeEmail(email)).digest());
  }
}

export function normalizeIdentity(input: Partial<IdentityPayload>): IdentityPayload {
  return {
    legalName: normalizeOptional(input.legalName),
    email: input.email ? normalizeEmail(input.email) : null,
    phone: normalizeOptional(input.phone),
    postalAddress: normalizeOptional(input.postalAddress),
    governmentId: normalizeOptional(input.governmentId),
  };
}

export function canonicalIdentity(identity: IdentityPayload): string {
  return JSON.stringify({
    legalName: identity.legalName,
    email: identity.email,
    phone: identity.phone,
    postalAddress: identity.postalAddress,
    governmentId: identity.governmentId,
  });
}

function normalizeOptional(value: string | null | undefined): string | null {
  const normalized = value?.normalize('NFKC').trim();
  return normalized ? normalized : null;
}

function normalizeEmail(email: string): string {
  return email.normalize('NFKC').trim().toLowerCase();
}

function identityAad(userId: string): Buffer {
  return Buffer.from(`novapay:user-identity:${IDENTITY_SCHEMA}:${userId}`);
}

function dekAad(userId: string, keyVersion: string): Buffer {
  return Buffer.from(`novapay:user-dek:${IDENTITY_SCHEMA}:${userId}:${keyVersion}`);
}

function encryptAesGcm(key: Buffer, iv: Buffer, plaintext: Buffer, aad: Buffer) {
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad);
  return {
    ciphertext: Buffer.concat([cipher.update(plaintext), cipher.final()]),
    authTag: cipher.getAuthTag(),
  };
}

function decryptAesGcm(
  key: Buffer,
  iv: Buffer,
  ciphertext: Buffer,
  authTag: Buffer,
  aad: Buffer,
): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  decipher.setAAD(aad);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function parseIdentity(plaintext: Buffer): IdentityPayload {
  const value = JSON.parse(plaintext.toString('utf8')) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid identity');
  const record = value as Record<string, unknown>;
  const allowed = new Set(['legalName', 'email', 'phone', 'postalAddress', 'governmentId']);
  if (Object.keys(record).some((key) => !allowed.has(key))) throw new Error('invalid identity');
  for (const key of allowed) {
    if (record[key] !== null && typeof record[key] !== 'string') throw new Error('invalid identity');
  }
  return record as unknown as IdentityPayload;
}

function loadKeyConfiguration(): {
  activeVersion: string;
  keys: Map<string, Buffer>;
  lookupKey: Buffer;
} {
  const activeVersion = process.env.IDENTITY_ACTIVE_KEY_VERSION;
  const rawRing = process.env.IDENTITY_KEK_RING;
  const rawLookup = process.env.IDENTITY_LOOKUP_HMAC_KEY;
  if (!activeVersion || !rawRing || !rawLookup) throw new Error('Identity encryption configuration is required.');
  let parsed: unknown;
  try { parsed = JSON.parse(rawRing); } catch { throw new Error('IDENTITY_KEK_RING must be valid JSON.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('IDENTITY_KEK_RING must be a key map.');
  const keys = new Map<string, Buffer>();
  for (const [version, encoded] of Object.entries(parsed)) {
    if (!/^[A-Za-z0-9._-]{1,40}$/.test(version) || typeof encoded !== 'string') {
      throw new Error('IDENTITY_KEK_RING contains an invalid entry.');
    }
    keys.set(version, decodeKey(encoded, `IDENTITY_KEK_RING.${version}`));
  }
  if (!keys.has(activeVersion)) throw new Error('The active identity key version is absent from IDENTITY_KEK_RING.');
  return { activeVersion, keys, lookupKey: decodeKey(rawLookup, 'IDENTITY_LOOKUP_HMAC_KEY') };
}

function decodeKey(encoded: string, name: string): Buffer {
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== KEY_BYTES || key.toString('base64') !== encoded) {
    throw new Error(`${name} must be canonical base64 for exactly 32 bytes.`);
  }
  return key;
}

function toBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(value);
}

function decryptionFailure(): InternalServerErrorException {
  return new InternalServerErrorException({
    code: 'IDENTITY_DECRYPTION_FAILED',
    message: 'The encrypted identity could not be authenticated.',
  });
}
