export type RetentionMinutes = 60 | 1_440 | 10_080 | null;

export interface EncryptionDisabled {
  enabled: false;
}

export interface EncryptionEnabled {
  enabled: true;
  keyId: string;
  algorithm: "AES-GCM-256";
  kdf: "PBKDF2-SHA-256";
  iterations: number;
  salt: string;
  verifierIv: string;
  verifierCiphertext: string;
}

export type EncryptionSettings = EncryptionDisabled | EncryptionEnabled;

export interface SyncSettings {
  schemaVersion: 1;
  revision: string;
  retentionMinutes: RetentionMinutes;
  encryption: EncryptionSettings;
}

/** Retention is independent from the security epoch so a stale retention
 * update can never enable or disable encryption. */
export interface RetentionSettingsRecord {
  schemaVersion: 2;
  revision: string;
  retentionMinutes: RetentionMinutes;
}

/**
 * A security epoch points at the first state event committed with that epoch.
 * Receivers use the target as a transition-completeness fence before removing
 * records that appear incompatible in a partially delivered Sync snapshot.
 */
export interface SecuritySettingsRecord {
  schemaVersion: 2;
  revision: string;
  encryption: EncryptionSettings;
  targetEventRevision: string | null;
  targetEventAt: number | null;
}

export interface SecurityTransitionIntentRecord {
  schemaVersion: 1;
  id: string;
  fromSecurityRevision: string;
  startedAt: number;
  expiresAt: number;
}

export interface RetiredSecurityEpochRecord {
  schemaVersion: 1;
  id: string;
  retiredRevision: string;
  successorRevision: string;
  retireLegacyRecords: boolean;
  retiredAt: number;
}

export interface NoteMetadata {
  schemaVersion: 1 | 2;
  /** Null only for a normalized legacy v1 record. */
  securityRevision: string | null;
  revision: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number | null;
  sourceId: string;
}

export interface PlainNoteRecord extends NoteMetadata {
  kind: "plain";
  content: string;
}

export interface EncryptedNoteRecord extends NoteMetadata {
  kind: "encrypted";
  keyId: string;
  iv: string;
  ciphertext: string;
}

export type NoteRecord = PlainNoteRecord | EncryptedNoteRecord;

export interface TombstoneRecord {
  schemaVersion: 1 | 2;
  /** Null only for a normalized legacy v1 record. */
  securityRevision: string | null;
  id: string;
  targetRevision: string;
  deletedAt: number;
  keepUntil: number;
  scope: "record" | "state";
}

export interface ClearMarkerRecord {
  schemaVersion: 1 | 2;
  /** Null only for a normalized legacy v1 record. */
  securityRevision: string | null;
  id: string;
  clearedAt: number;
}

export interface RemoteState {
  eventRevision: string | null;
  eventAt: number | null;
  note: NoteRecord | null;
  expired: boolean;
  invalidItemCount: number;
}

export interface StoredDraft {
  schemaVersion: 1;
  text: string;
  baseEventRevision: string | null;
  updatedAt: number;
}

export interface EncryptedStoredDraft {
  schemaVersion: 2;
  keyId: string;
  iv: string;
  ciphertext: string;
  baseEventRevision: string | null;
  updatedAt: number;
}

export type StoredDraftRecord = StoredDraft | EncryptedStoredDraft;

export interface SessionKeyRecord {
  schemaVersion: 1;
  keyId: string;
  rawKey: string;
}

export interface ReadableRemoteState extends RemoteState {
  text: string | null;
  locked: boolean;
}

export interface SaveNoteInput {
  text: string;
  baseEventRevision: string | null;
  force?: boolean;
  now?: number;
}
