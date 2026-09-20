import {
  CLEAR_MARKER_SCHEMA_VERSION,
  DEFAULT_SETTINGS,
  LEGACY_STATE_RECORD_SCHEMA_VERSION,
  MAX_FUTURE_CLOCK_SKEW_MS,
  MAX_SESSION_DRAFT_BYTES,
  MAX_TEXT_BYTES,
  NOTE_SCHEMA_VERSION,
  RETENTION_SETTINGS_SCHEMA_VERSION,
  SECURITY_SETTINGS_SCHEMA_VERSION,
  SETTINGS_SCHEMA_VERSION,
  TOMBSTONE_SCHEMA_VERSION,
  TOMBSTONE_RETENTION_MS,
} from "./constants";
import { utf8ByteLength } from "./encoding";
import { StorageDataError } from "./errors";
import type {
  ClearMarkerRecord,
  EncryptedStoredDraft,
  EncryptionEnabled,
  NoteMetadata,
  NoteRecord,
  RetentionSettingsRecord,
  RetentionMinutes,
  RetiredSecurityEpochRecord,
  SecuritySettingsRecord,
  SecurityTransitionIntentRecord,
  SessionKeyRecord,
  StoredDraft,
  StoredDraftRecord,
  SyncSettings,
  TombstoneRecord,
} from "./types";

const MAX_NOTE_RETENTION_MS = 10_080 * 60_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 128;
}

function isStateEventRevision(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const separator = value.indexOf(":");
  if (separator < 1) return false;
  const kind = value.slice(0, separator);
  return (kind === "note" || kind === "clear") && isId(value.slice(separator + 1));
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isNullableTimestamp(value: unknown): value is number | null {
  return value === null || isTimestamp(value);
}

function isRetention(value: unknown): value is RetentionMinutes {
  return value === null || value === 60 || value === 1_440 || value === 10_080;
}

function isBase64(value: unknown, maxLength = 16_384): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value.length % 4 === 0 &&
    /^[A-Za-z0-9+/]*={0,2}$/.test(value)
  );
}

function parseMetadata(
  value: Record<string, unknown>,
  now: number,
  expectedSchemaVersion?: 1 | 2,
): NoteMetadata | null {
  const schemaVersion = value.schemaVersion;
  if (
    (schemaVersion !== LEGACY_STATE_RECORD_SCHEMA_VERSION &&
      schemaVersion !== NOTE_SCHEMA_VERSION) ||
    (expectedSchemaVersion !== undefined && schemaVersion !== expectedSchemaVersion) ||
    (schemaVersion === NOTE_SCHEMA_VERSION && !isId(value.securityRevision)) ||
    !isId(value.revision) ||
    !isTimestamp(value.createdAt) ||
    !isTimestamp(value.updatedAt) ||
    !isNullableTimestamp(value.expiresAt) ||
    !isId(value.sourceId) ||
    value.createdAt > now + MAX_FUTURE_CLOCK_SKEW_MS ||
    value.updatedAt !== value.createdAt ||
    (value.expiresAt !== null &&
      (value.expiresAt <= value.createdAt ||
        value.expiresAt > value.createdAt + MAX_NOTE_RETENTION_MS))
  ) {
    return null;
  }

  return {
    schemaVersion,
    securityRevision:
      schemaVersion === NOTE_SCHEMA_VERSION ? (value.securityRevision as string) : null,
    revision: value.revision,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    expiresAt: value.expiresAt,
    sourceId: value.sourceId,
  };
}

export function parseNote(
  value: unknown,
  expectedRevision?: string,
  now = Date.now(),
  expectedSchemaVersion?: 1 | 2,
): NoteRecord {
  if (!isRecord(value)) throw new StorageDataError("Nội dung đồng bộ không hợp lệ.");
  const metadata = parseMetadata(value, now, expectedSchemaVersion);
  if (!metadata || (expectedRevision && metadata.revision !== expectedRevision)) {
    throw new StorageDataError("Metadata của nội dung đồng bộ không hợp lệ.");
  }

  if (value.kind === "plain") {
    if (typeof value.content !== "string" || utf8ByteLength(value.content) > MAX_TEXT_BYTES) {
      throw new StorageDataError("Văn bản đồng bộ không hợp lệ hoặc quá lớn.");
    }
    return { ...metadata, kind: "plain", content: value.content };
  }

  if (
    value.kind === "encrypted" &&
    isId(value.keyId) &&
    isBase64(value.iv, 128) &&
    isBase64(value.ciphertext)
  ) {
    return {
      ...metadata,
      kind: "encrypted",
      keyId: value.keyId,
      iv: value.iv,
      ciphertext: value.ciphertext,
    };
  }

  throw new StorageDataError("Định dạng nội dung đồng bộ không được hỗ trợ.");
}

export function parseTombstone(
  value: unknown,
  expectedId?: string,
  now = Date.now(),
  expectedSchemaVersion?: 1 | 2,
): TombstoneRecord {
  const scope: unknown = isRecord(value) ? (value.scope ?? "state") : undefined;
  const schemaVersion = isRecord(value) ? value.schemaVersion : undefined;
  if (
    !isRecord(value) ||
    (schemaVersion !== LEGACY_STATE_RECORD_SCHEMA_VERSION &&
      schemaVersion !== TOMBSTONE_SCHEMA_VERSION) ||
    (expectedSchemaVersion !== undefined && schemaVersion !== expectedSchemaVersion) ||
    (schemaVersion === TOMBSTONE_SCHEMA_VERSION && !isId(value.securityRevision)) ||
    !isId(value.id) ||
    (expectedId !== undefined && value.id !== expectedId) ||
    !isId(value.targetRevision) ||
    !isTimestamp(value.deletedAt) ||
    value.deletedAt > now + MAX_FUTURE_CLOCK_SKEW_MS ||
    !isTimestamp(value.keepUntil) ||
    value.keepUntil < value.deletedAt ||
    value.keepUntil > now + MAX_FUTURE_CLOCK_SKEW_MS + TOMBSTONE_RETENTION_MS ||
    (scope !== "record" && scope !== "state")
  ) {
    throw new StorageDataError("Dấu xóa đồng bộ không hợp lệ.");
  }

  return {
    schemaVersion,
    securityRevision:
      schemaVersion === TOMBSTONE_SCHEMA_VERSION ? (value.securityRevision as string) : null,
    id: value.id,
    targetRevision: value.targetRevision,
    deletedAt: value.deletedAt,
    keepUntil: value.keepUntil,
    scope,
  };
}

export function parseClearMarker(
  value: unknown,
  expectedId?: string,
  now = Date.now(),
  expectedSchemaVersion?: 1 | 2,
): ClearMarkerRecord {
  const schemaVersion = isRecord(value) ? value.schemaVersion : undefined;
  if (
    !isRecord(value) ||
    (schemaVersion !== LEGACY_STATE_RECORD_SCHEMA_VERSION &&
      schemaVersion !== CLEAR_MARKER_SCHEMA_VERSION) ||
    (expectedSchemaVersion !== undefined && schemaVersion !== expectedSchemaVersion) ||
    (schemaVersion === CLEAR_MARKER_SCHEMA_VERSION && !isId(value.securityRevision)) ||
    !isId(value.id) ||
    (expectedId !== undefined && value.id !== expectedId) ||
    !isTimestamp(value.clearedAt) ||
    value.clearedAt > now + MAX_FUTURE_CLOCK_SKEW_MS
  ) {
    throw new StorageDataError("Mốc xóa đồng bộ không hợp lệ.");
  }

  return {
    schemaVersion,
    securityRevision:
      schemaVersion === CLEAR_MARKER_SCHEMA_VERSION ? (value.securityRevision as string) : null,
    id: value.id,
    clearedAt: value.clearedAt,
  };
}

function parseEncryption(value: unknown): SyncSettings["encryption"] {
  if (!isRecord(value) || typeof value.enabled !== "boolean") {
    throw new StorageDataError("Cài đặt mã hóa không hợp lệ.");
  }
  if (!value.enabled) return { enabled: false };

  if (
    isId(value.keyId) &&
    value.algorithm === "AES-GCM-256" &&
    value.kdf === "PBKDF2-SHA-256" &&
    typeof value.iterations === "number" &&
    Number.isInteger(value.iterations) &&
    value.iterations >= 100_000 &&
    value.iterations <= 2_000_000 &&
    isBase64(value.salt, 256) &&
    isBase64(value.verifierIv, 128) &&
    isBase64(value.verifierCiphertext, 512)
  ) {
    const encryption: EncryptionEnabled = {
      enabled: true,
      keyId: value.keyId,
      algorithm: value.algorithm,
      kdf: value.kdf,
      iterations: value.iterations,
      salt: value.salt,
      verifierIv: value.verifierIv,
      verifierCiphertext: value.verifierCiphertext,
    };
    return encryption;
  }

  throw new StorageDataError("Thông số mã hóa không hợp lệ.");
}

export function parseSettings(value: unknown): SyncSettings {
  if (value === undefined || value === null) return { ...DEFAULT_SETTINGS };
  if (
    !isRecord(value) ||
    value.schemaVersion !== SETTINGS_SCHEMA_VERSION ||
    !isId(value.revision) ||
    !isRetention(value.retentionMinutes)
  ) {
    throw new StorageDataError("Cài đặt đồng bộ không hợp lệ.");
  }

  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    revision: value.revision,
    retentionMinutes: value.retentionMinutes,
    encryption: parseEncryption(value.encryption),
  };
}

export function parseRetentionSettings(value: unknown): RetentionSettingsRecord {
  if (
    !isRecord(value) ||
    value.schemaVersion !== RETENTION_SETTINGS_SCHEMA_VERSION ||
    !isId(value.revision) ||
    !isRetention(value.retentionMinutes)
  ) {
    throw new StorageDataError("Cài đặt thời gian lưu không hợp lệ.");
  }

  return {
    schemaVersion: RETENTION_SETTINGS_SCHEMA_VERSION,
    revision: value.revision,
    retentionMinutes: value.retentionMinutes,
  };
}

export function parseSecuritySettings(value: unknown): SecuritySettingsRecord {
  if (
    !isRecord(value) ||
    value.schemaVersion !== SECURITY_SETTINGS_SCHEMA_VERSION ||
    !isId(value.revision) ||
    !(
      (value.targetEventRevision === null && value.targetEventAt === null) ||
      (isStateEventRevision(value.targetEventRevision) && isTimestamp(value.targetEventAt))
    )
  ) {
    throw new StorageDataError("Cài đặt bảo vệ không hợp lệ.");
  }

  return {
    schemaVersion: SECURITY_SETTINGS_SCHEMA_VERSION,
    revision: value.revision,
    encryption: parseEncryption(value.encryption),
    targetEventRevision: value.targetEventRevision,
    targetEventAt: value.targetEventAt,
  };
}

export function parseSecurityTransitionIntent(
  value: unknown,
  expectedId?: string,
  now = Date.now(),
): SecurityTransitionIntentRecord {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !isId(value.id) ||
    (expectedId !== undefined && value.id !== expectedId) ||
    !isId(value.fromSecurityRevision) ||
    !isTimestamp(value.startedAt) ||
    value.startedAt > now + MAX_FUTURE_CLOCK_SKEW_MS ||
    !isTimestamp(value.expiresAt) ||
    value.expiresAt <= value.startedAt ||
    value.expiresAt > value.startedAt + 60 * 60 * 1_000
  ) {
    throw new StorageDataError("Ý định chuyển chế độ bảo vệ không hợp lệ.");
  }
  return {
    schemaVersion: 1,
    id: value.id,
    fromSecurityRevision: value.fromSecurityRevision,
    startedAt: value.startedAt,
    expiresAt: value.expiresAt,
  };
}

export function parseRetiredSecurityEpoch(
  value: unknown,
  expectedId?: string,
  now = Date.now(),
): RetiredSecurityEpochRecord {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !isId(value.id) ||
    (expectedId !== undefined && value.id !== expectedId) ||
    !isId(value.retiredRevision) ||
    !isId(value.successorRevision) ||
    typeof value.retireLegacyRecords !== "boolean" ||
    !isTimestamp(value.retiredAt) ||
    value.retiredAt > now + MAX_FUTURE_CLOCK_SKEW_MS
  ) {
    throw new StorageDataError("Security epoch đã nghỉ không hợp lệ.");
  }
  return {
    schemaVersion: 1,
    id: value.id,
    retiredRevision: value.retiredRevision,
    successorRevision: value.successorRevision,
    retireLegacyRecords: value.retireLegacyRecords,
    retiredAt: value.retiredAt,
  };
}

export function parseDraft(value: unknown): StoredDraftRecord | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) return null;
  if (value.schemaVersion === 1) {
    if (
      typeof value.text !== "string" ||
      utf8ByteLength(value.text) > MAX_SESSION_DRAFT_BYTES ||
      !(value.baseEventRevision === null || isId(value.baseEventRevision)) ||
      !isTimestamp(value.updatedAt)
    ) {
      return null;
    }

    const draft: StoredDraft = {
      schemaVersion: 1,
      text: value.text,
      baseEventRevision: value.baseEventRevision,
      updatedAt: value.updatedAt,
    };
    return draft;
  }

  const maxCiphertextLength = Math.ceil((MAX_SESSION_DRAFT_BYTES + 32) * (4 / 3)) + 8;
  if (
    value.schemaVersion !== 2 ||
    !isId(value.keyId) ||
    !isBase64(value.iv, 128) ||
    !isBase64(value.ciphertext, maxCiphertextLength) ||
    !(value.baseEventRevision === null || isId(value.baseEventRevision)) ||
    !isTimestamp(value.updatedAt)
  ) {
    return null;
  }

  const encryptedDraft: EncryptedStoredDraft = {
    schemaVersion: 2,
    keyId: value.keyId,
    iv: value.iv,
    ciphertext: value.ciphertext,
    baseEventRevision: value.baseEventRevision,
    updatedAt: value.updatedAt,
  };
  return encryptedDraft;
}

export function parseSessionKey(value: unknown): SessionKeyRecord | null {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !isId(value.keyId) ||
    !isBase64(value.rawKey, 128)
  ) {
    return null;
  }
  return { schemaVersion: 1, keyId: value.keyId, rawKey: value.rawKey };
}
