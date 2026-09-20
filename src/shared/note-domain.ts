import {
  CHROME_SYNC_ITEM_LIMIT_BYTES,
  CLEAR_MARKER_SCHEMA_VERSION,
  CLEAR_MARKER_KEY_PREFIX,
  LEGACY_STANDARD_SECURITY_REVISION,
  MAX_TEXT_BYTES,
  NOTE_KEY_PREFIX,
  NOTE_SCHEMA_VERSION,
  TOMBSTONE_SCHEMA_VERSION,
  TOMBSTONE_KEY_PREFIX,
  TOMBSTONE_RETENTION_MS,
} from "./constants";
import { storageItemByteLength, utf8ByteLength } from "./encoding";
import { NoteTooLargeError } from "./errors";
import type {
  ClearMarkerRecord,
  NoteMetadata,
  PlainNoteRecord,
  RetentionMinutes,
  TombstoneRecord,
} from "./types";

export function noteStorageKey(revision: string): string {
  return `${NOTE_KEY_PREFIX}${revision}`;
}

export function tombstoneStorageKey(id: string): string {
  return `${TOMBSTONE_KEY_PREFIX}${id}`;
}

export function clearMarkerStorageKey(id: string): string {
  return `${CLEAR_MARKER_KEY_PREFIX}${id}`;
}

export function calculateExpiresAt(now: number, retentionMinutes: RetentionMinutes): number | null {
  return retentionMinutes === null ? null : now + retentionMinutes * 60_000;
}

export function createPlainNote(
  content: string,
  sourceId: string,
  retentionMinutes: RetentionMinutes,
  now = Date.now(),
  securityRevision = LEGACY_STANDARD_SECURITY_REVISION,
): PlainNoteRecord {
  assertTextWithinLimit(content);
  const revision = crypto.randomUUID();
  return {
    schemaVersion: NOTE_SCHEMA_VERSION,
    securityRevision,
    revision,
    kind: "plain",
    content,
    sourceId,
    createdAt: now,
    updatedAt: now,
    expiresAt: calculateExpiresAt(now, retentionMinutes),
  };
}

export function cloneMetadata(note: NoteMetadata): NoteMetadata {
  return {
    schemaVersion: note.schemaVersion,
    securityRevision: note.securityRevision,
    revision: note.revision,
    sourceId: note.sourceId,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    expiresAt: note.expiresAt,
  };
}

export function createTombstone(
  targetRevision: string,
  deletedAt = Date.now(),
  retentionAnchor = Date.now(),
  scope: TombstoneRecord["scope"] = "record",
  securityRevision = LEGACY_STANDARD_SECURITY_REVISION,
): TombstoneRecord {
  return {
    schemaVersion: TOMBSTONE_SCHEMA_VERSION,
    securityRevision,
    id: crypto.randomUUID(),
    targetRevision,
    deletedAt,
    keepUntil: retentionAnchor + TOMBSTONE_RETENTION_MS,
    scope,
  };
}

export function createClearMarker(
  clearedAt = Date.now(),
  securityRevision = LEGACY_STANDARD_SECURITY_REVISION,
): ClearMarkerRecord {
  return {
    schemaVersion: CLEAR_MARKER_SCHEMA_VERSION,
    securityRevision,
    id: crypto.randomUUID(),
    clearedAt,
  };
}

export function isExpired(note: NoteMetadata, now = Date.now()): boolean {
  return note.expiresAt !== null && note.expiresAt <= now;
}

export function assertTextWithinLimit(text: string): void {
  if (utf8ByteLength(text) > MAX_TEXT_BYTES) {
    throw new NoteTooLargeError(
      `Nội dung vượt giới hạn ${MAX_TEXT_BYTES.toLocaleString("vi-VN")} byte.`,
    );
  }
}

export function assertStorageItemWithinLimit(key: string, value: unknown): void {
  const bytes = storageItemByteLength(key, value);
  if (bytes > CHROME_SYNC_ITEM_LIMIT_BYTES) {
    throw new NoteTooLargeError(
      `Bản ghi sau mã hóa chiếm ${bytes.toLocaleString("vi-VN")} byte, vượt quota của Chrome Sync.`,
    );
  }
}

export function compareEventOrder(
  left: { eventAt: number; eventRevision: string },
  right: { eventAt: number; eventRevision: string },
): number {
  return left.eventAt - right.eventAt || left.eventRevision.localeCompare(right.eventRevision);
}
