import {
  CLEANUP_ALARM_NAME,
  CHROME_SYNC_MAX_ITEMS,
  CHROME_SYNC_TOTAL_LIMIT_BYTES,
  CLEAR_MARKER_KEY_PREFIX,
  DEFAULT_RETENTION_SETTINGS,
  DEFAULT_SECURITY_SETTINGS,
  EMERGENCY_SYNC_RESERVE_BYTES,
  EMERGENCY_SYNC_RESERVE_ITEMS,
  LEGACY_CLEAR_MARKER_KEY_PREFIX,
  LEGACY_NOTE_KEY_PREFIX,
  LEGACY_STATE_RECORD_SCHEMA_VERSION,
  LEGACY_STANDARD_SECURITY_REVISION,
  LEGACY_TOMBSTONE_KEY_PREFIX,
  MAX_FUTURE_CLOCK_SKEW_MS,
  MAX_RETAINED_CLEAR_MARKERS,
  MAX_RETAINED_TOMBSTONES,
  MAX_SESSION_DRAFT_BYTES,
  MAX_TOMBSTONES_PER_CLEANUP_BATCH,
  NOTE_KEY_PREFIX,
  NOTE_SCHEMA_VERSION,
  ORPHAN_SEEN_KEY_PREFIX,
  ORPHAN_GRACE_PERIOD_MS,
  READ_CURSOR_KEY_PREFIX,
  RETIRED_EPOCH_KEY_PREFIX,
  RETENTION_SETTINGS_SCHEMA_VERSION,
  SECURITY_SETTINGS_SCHEMA_VERSION,
  SETTINGS_SCHEMA_VERSION,
  STORAGE_KEYS,
  STATE_SEEN_KEY_PREFIX,
  SYNC_WRITE_RESERVE_BYTES,
  SYNC_WRITE_RESERVE_ITEMS,
  TOMBSTONE_KEY_PREFIX,
  TOMBSTONE_RETENTION_MS,
  TRANSITION_INTENT_KEY_PREFIX,
  TRANSITION_INTENT_TTL_MS,
} from "./constants";
import {
  createEncryptionSettings,
  decryptDraft,
  decryptNote,
  encryptDraft,
  encryptNote,
  unlockEncryption,
} from "./crypto";
import { base64ToBytes, bytesToBase64, storageItemByteLength, utf8ByteLength } from "./encoding";
import { AppError, ConflictError, LockedError, StorageDataError, SyncQuotaError } from "./errors";
import {
  assertStorageItemWithinLimit,
  assertTextWithinLimit,
  clearMarkerStorageKey,
  compareEventOrder,
  createClearMarker,
  createPlainNote,
  createTombstone,
  isExpired,
  noteStorageKey,
  tombstoneStorageKey,
} from "./note-domain";
import type {
  ClearMarkerRecord,
  EncryptionSettings,
  NoteRecord,
  PlainNoteRecord,
  ReadableRemoteState,
  RemoteState,
  RetentionSettingsRecord,
  RetentionMinutes,
  RetiredSecurityEpochRecord,
  SaveNoteInput,
  SecuritySettingsRecord,
  SecurityTransitionIntentRecord,
  SessionKeyRecord,
  StoredDraft,
  StoredDraftRecord,
  SyncSettings,
  TombstoneRecord,
} from "./types";
import {
  parseClearMarker,
  parseDraft,
  parseNote,
  parseRetentionSettings,
  parseRetiredSecurityEpoch,
  parseSecuritySettings,
  parseSecurityTransitionIntent,
  parseSessionKey,
  parseSettings,
  parseTombstone,
} from "./validation";

interface SyncCollection {
  notes: Array<{ key: string; note: NoteRecord }>;
  tombstones: Array<{ key: string; tombstone: TombstoneRecord }>;
  clearMarkers: Array<{ key: string; marker: ClearMarkerRecord }>;
  transitionIntents: Array<{ key: string; intent: SecurityTransitionIntentRecord }>;
  retiredEpochs: Array<{ key: string; retirement: RetiredSecurityEpochRecord }>;
  invalidKeys: string[];
  invalidItemCount: number;
  raw: Record<string, unknown>;
}

interface SyncSnapshot {
  collection: SyncCollection;
  settings: SyncSettings;
  retention: RetentionSettingsRecord;
  security: SecuritySettingsRecord;
  state: RemoteState;
  deliveryPending: boolean;
  activeIntent: SecurityTransitionIntentRecord | null;
  transitionPending: boolean;
}

interface SyncEvent {
  eventRevision: string;
  eventAt: number;
  note: NoteRecord | null;
  expired: boolean;
}

interface ResolvedSettings {
  settings: SyncSettings;
  retention: RetentionSettingsRecord;
  security: SecuritySettingsRecord;
}

interface OrphanSeenRecord {
  schemaVersion: 1;
  firstSeenAt: number;
}

export class SettingsChangedError extends AppError {
  constructor() {
    super("Cài đặt bảo vệ vừa thay đổi trên máy khác. Hãy thử lại.", "SETTINGS_CHANGED");
  }
}

function uuid(): string {
  return crypto.randomUUID();
}

function suffixFromKey(key: string, prefix: string): string {
  return key.slice(prefix.length);
}

async function collectSyncRecords(validationNow = Date.now()): Promise<SyncCollection> {
  const raw = (await chrome.storage.sync.get(null)) as Record<string, unknown>;
  const notes: SyncCollection["notes"] = [];
  const tombstones: SyncCollection["tombstones"] = [];
  const clearMarkers: SyncCollection["clearMarkers"] = [];
  const transitionIntents: SyncCollection["transitionIntents"] = [];
  const retiredEpochs: SyncCollection["retiredEpochs"] = [];
  const invalidKeys: string[] = [];
  let invalidItemCount = 0;

  for (const [key, value] of Object.entries(raw)) {
    try {
      if (key.startsWith(NOTE_KEY_PREFIX)) {
        notes.push({
          key,
          note: parseNote(value, suffixFromKey(key, NOTE_KEY_PREFIX), validationNow, 2),
        });
      } else if (key.startsWith(LEGACY_NOTE_KEY_PREFIX)) {
        notes.push({
          key,
          note: parseNote(
            value,
            suffixFromKey(key, LEGACY_NOTE_KEY_PREFIX),
            validationNow,
            LEGACY_STATE_RECORD_SCHEMA_VERSION,
          ),
        });
      } else if (key.startsWith(TOMBSTONE_KEY_PREFIX)) {
        tombstones.push({
          key,
          tombstone: parseTombstone(
            value,
            suffixFromKey(key, TOMBSTONE_KEY_PREFIX),
            validationNow,
            2,
          ),
        });
      } else if (key.startsWith(LEGACY_TOMBSTONE_KEY_PREFIX)) {
        tombstones.push({
          key,
          tombstone: parseTombstone(
            value,
            suffixFromKey(key, LEGACY_TOMBSTONE_KEY_PREFIX),
            validationNow,
            LEGACY_STATE_RECORD_SCHEMA_VERSION,
          ),
        });
      } else if (key.startsWith(CLEAR_MARKER_KEY_PREFIX)) {
        clearMarkers.push({
          key,
          marker: parseClearMarker(
            value,
            suffixFromKey(key, CLEAR_MARKER_KEY_PREFIX),
            validationNow,
            2,
          ),
        });
      } else if (key.startsWith(LEGACY_CLEAR_MARKER_KEY_PREFIX)) {
        clearMarkers.push({
          key,
          marker: parseClearMarker(
            value,
            suffixFromKey(key, LEGACY_CLEAR_MARKER_KEY_PREFIX),
            validationNow,
            LEGACY_STATE_RECORD_SCHEMA_VERSION,
          ),
        });
      } else if (key.startsWith(TRANSITION_INTENT_KEY_PREFIX)) {
        transitionIntents.push({
          key,
          intent: parseSecurityTransitionIntent(
            value,
            suffixFromKey(key, TRANSITION_INTENT_KEY_PREFIX),
            validationNow,
          ),
        });
      } else if (key.startsWith(RETIRED_EPOCH_KEY_PREFIX)) {
        retiredEpochs.push({
          key,
          retirement: parseRetiredSecurityEpoch(
            value,
            suffixFromKey(key, RETIRED_EPOCH_KEY_PREFIX),
            validationNow,
          ),
        });
      }
    } catch {
      invalidItemCount += 1;
      invalidKeys.push(key);
    }
  }

  return {
    notes,
    tombstones,
    clearMarkers,
    transitionIntents,
    retiredEpochs,
    invalidKeys,
    invalidItemCount,
    raw,
  };
}

function isEpochCompatible(
  recordSecurityRevision: string | null,
  security: SecuritySettingsRecord,
): boolean {
  if (recordSecurityRevision !== null) return recordSecurityRevision === security.revision;
  // Legacy records have no epoch. They remain readable only before the first
  // v2 security transition; afterward they can never re-enter canonical state.
  return security.targetEventRevision === null && security.targetEventAt === null;
}

function isNoteCompatible(note: NoteRecord, security: SecuritySettingsRecord): boolean {
  if (!isEpochCompatible(note.securityRevision, security)) return false;
  if (!security.encryption.enabled) return note.kind === "plain";
  return note.kind === "encrypted" && note.keyId === security.encryption.keyId;
}

function computeRemoteState(
  collection: SyncCollection,
  security: SecuritySettingsRecord,
  now = Date.now(),
): RemoteState {
  const events: SyncEvent[] = [];
  const deletedRevisions = new Set(
    collection.tombstones
      .filter(({ tombstone }) => isEpochCompatible(tombstone.securityRevision, security))
      .map(({ tombstone }) => tombstone.targetRevision),
  );

  for (const { note } of collection.notes) {
    if (!isNoteCompatible(note, security)) continue;
    if (!deletedRevisions.has(note.revision)) {
      events.push({
        eventRevision: `note:${note.revision}`,
        eventAt: note.createdAt,
        note,
        expired: false,
      });
    }
  }

  for (const { tombstone } of collection.tombstones) {
    if (tombstone.scope !== "state" || !isEpochCompatible(tombstone.securityRevision, security)) {
      continue;
    }
    events.push({
      eventRevision: `tomb:${tombstone.id}`,
      eventAt: tombstone.deletedAt,
      note: null,
      expired: false,
    });
  }

  for (const { marker } of collection.clearMarkers) {
    if (!isEpochCompatible(marker.securityRevision, security)) continue;
    events.push({
      eventRevision: `clear:${marker.id}`,
      eventAt: marker.clearedAt,
      note: null,
      expired: false,
    });
  }

  events.sort(compareEventOrder);
  const latest = events.at(-1);
  if (latest?.note && isExpired(latest.note, now)) {
    return {
      eventRevision: `expired:${latest.note.revision}`,
      eventAt: latest.note.expiresAt ?? latest.note.createdAt,
      note: null,
      expired: true,
      invalidItemCount: collection.invalidItemCount,
    };
  }
  return {
    eventRevision: latest?.eventRevision ?? null,
    eventAt: latest?.eventAt ?? null,
    note: latest?.note ?? null,
    expired: latest?.expired ?? false,
    invalidItemCount: collection.invalidItemCount,
  };
}

function resolveSettings(raw: Record<string, unknown>): ResolvedSettings {
  // Legacy settings are a read-only fallback. Never synthesize a missing v2
  // fixed key during a read: the real v2 record may simply still be in flight,
  // and writing the fallback could win Chrome Sync's LWW merge.
  const retentionValue = raw[STORAGE_KEYS.retentionSettings];
  const securityValue = raw[STORAGE_KEYS.securitySettings];
  // Once both split records exist, the legacy mirror is no longer authoritative
  // and a malformed/stale mirror must not brick otherwise-valid v2 state.
  const legacy =
    retentionValue === undefined ||
    retentionValue === null ||
    securityValue === undefined ||
    securityValue === null
      ? parseSettings(raw[STORAGE_KEYS.settings])
      : null;
  const retention =
    retentionValue === undefined || retentionValue === null
      ? {
          ...DEFAULT_RETENTION_SETTINGS,
          revision: legacy?.revision ?? DEFAULT_RETENTION_SETTINGS.revision,
          retentionMinutes: legacy?.retentionMinutes ?? DEFAULT_RETENTION_SETTINGS.retentionMinutes,
        }
      : parseRetentionSettings(retentionValue);

  const fallbackEncryption = legacy?.encryption ?? DEFAULT_SECURITY_SETTINGS.encryption;
  const security =
    securityValue === undefined || securityValue === null
      ? {
          ...DEFAULT_SECURITY_SETTINGS,
          // Legacy combined revisions also changed for retention-only writes.
          // Bind fallback state to the actual security identity instead so a
          // late same-mode legacy update cannot orphan a v2 Save/Clear.
          revision: fallbackEncryption.enabled
            ? fallbackEncryption.keyId
            : LEGACY_STANDARD_SECURITY_REVISION,
          encryption: fallbackEncryption,
        }
      : parseSecuritySettings(securityValue);

  return {
    retention,
    security,
    settings: {
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      revision: security.revision,
      retentionMinutes: retention.retentionMinutes,
      encryption: security.encryption,
    },
  };
}

function isSecurityTransitionPending(
  state: RemoteState,
  security: SecuritySettingsRecord,
): boolean {
  if (security.targetEventRevision === null || security.targetEventAt === null) return false;
  if (state.eventRevision === null || state.eventAt === null) return true;
  return (
    compareEventOrder(state as { eventRevision: string; eventAt: number }, {
      eventRevision: security.targetEventRevision,
      eventAt: security.targetEventAt,
    }) < 0
  );
}

function findActiveTransitionIntent(
  collection: SyncCollection,
  securityRevision: string,
  now: number,
): SecurityTransitionIntentRecord | null {
  return (
    collection.transitionIntents
      .map(({ intent }) => intent)
      .filter(
        (intent) => intent.fromSecurityRevision === securityRevision && intent.expiresAt > now,
      )
      .sort((left, right) => left.startedAt - right.startedAt || left.id.localeCompare(right.id))
      .at(-1) ?? null
  );
}

async function loadSyncSnapshot(now = Date.now()): Promise<SyncSnapshot> {
  const collection = await collectSyncRecords(Math.max(Date.now(), now));
  const resolved = resolveSettings(collection.raw);
  const state = computeRemoteState(collection, resolved.security, now);
  const deliveryPending = isSecurityTransitionPending(state, resolved.security);
  const activeIntent = findActiveTransitionIntent(collection, resolved.security.revision, now);
  return {
    collection,
    settings: resolved.settings,
    retention: resolved.retention,
    security: resolved.security,
    state,
    deliveryPending,
    activeIntent,
    transitionPending: deliveryPending || activeIntent !== null,
  };
}

function nextLogicalTimestamp(
  requestedAt: number,
  previousEventAt: number | null,
  validationNow = Date.now(),
): number {
  const afterPrevious = previousEventAt === null ? requestedAt : previousEventAt + 1;
  const result = Math.max(requestedAt, afterPrevious);
  if (
    !Number.isSafeInteger(result) ||
    result < 0 ||
    result > validationNow + MAX_FUTURE_CLOCK_SKEW_MS
  ) {
    throw new StorageDataError("Mốc thời gian đồng bộ không hợp lệ.");
  }
  return result;
}

async function assertSyncWriteBudget(
  updates: Record<string, unknown>,
  reserveBytes = SYNC_WRITE_RESERVE_BYTES,
  reserveItems = SYNC_WRITE_RESERVE_ITEMS,
): Promise<void> {
  const keys = Object.keys(updates);
  for (const [key, value] of Object.entries(updates)) assertStorageItemWithinLimit(key, value);
  const [currentBytes, replacedBytes, currentItems] = await Promise.all([
    chrome.storage.sync.getBytesInUse(null),
    chrome.storage.sync.getBytesInUse(keys),
    chrome.storage.sync.get(null),
  ]);
  const newBytes = Object.entries(updates).reduce(
    (total, [key, value]) => total + storageItemByteLength(key, value),
    0,
  );
  if (currentBytes - replacedBytes + newBytes > CHROME_SYNC_TOTAL_LIMIT_BYTES - reserveBytes) {
    throw new SyncQuotaError();
  }
  const currentKeys = new Set(Object.keys(currentItems));
  const addedItemCount = keys.filter((key) => !currentKeys.has(key)).length;
  if (currentKeys.size + addedItemCount > CHROME_SYNC_MAX_ITEMS - reserveItems) {
    throw new SyncQuotaError();
  }
}

async function assertSyncWriteBudgetAfterRemoval(
  updates: Record<string, unknown>,
  removalKeys: string[],
): Promise<void> {
  for (const [key, value] of Object.entries(updates)) assertStorageItemWithinLimit(key, value);
  const projected = (await chrome.storage.sync.get(null)) as Record<string, unknown>;
  for (const key of removalKeys) delete projected[key];
  for (const [key, value] of Object.entries(updates)) projected[key] = value;
  const projectedBytes = Object.entries(projected).reduce(
    (total, [key, value]) => total + storageItemByteLength(key, value),
    0,
  );
  if (
    projectedBytes > CHROME_SYNC_TOTAL_LIMIT_BYTES ||
    Object.keys(projected).length > CHROME_SYNC_MAX_ITEMS
  ) {
    throw new SyncQuotaError();
  }
}

function isChromeCapacityError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /QUOTA_BYTES(?:_PER_ITEM)?|MAX_ITEMS/i.test(message);
}

async function setSyncItems(items: Record<string, unknown>): Promise<void> {
  try {
    await chrome.storage.sync.set(items);
  } catch (error) {
    if (isChromeCapacityError(error)) throw new SyncQuotaError();
    throw error;
  }
}

function transitionIntentStorageKey(id: string): string {
  return `${TRANSITION_INTENT_KEY_PREFIX}${id}`;
}

function retiredEpochStorageKey(id: string): string {
  return `${RETIRED_EPOCH_KEY_PREFIX}${id}`;
}

function legacyClearMarkerStorageKey(id: string): string {
  return `${LEGACY_CLEAR_MARKER_KEY_PREFIX}${id}`;
}

function createTransitionIntent(
  fromSecurityRevision: string,
  now = Date.now(),
): SecurityTransitionIntentRecord {
  return {
    schemaVersion: 1,
    id: uuid(),
    fromSecurityRevision,
    startedAt: now,
    expiresAt: now + TRANSITION_INTENT_TTL_MS,
  };
}

function createRetiredEpoch(
  retired: SecuritySettingsRecord,
  successorRevision: string,
  retiredAt: number,
): RetiredSecurityEpochRecord {
  return {
    schemaVersion: 1,
    id: uuid(),
    retiredRevision: retired.revision,
    successorRevision,
    retireLegacyRecords: retired.targetEventRevision === null && retired.targetEventAt === null,
    retiredAt,
  };
}

async function claimSecurityTransition(
  expectedSecurityRevision: string,
): Promise<SecurityTransitionIntentRecord> {
  const intent = createTransitionIntent(expectedSecurityRevision);
  const key = transitionIntentStorageKey(intent.id);
  await assertSyncWriteBudget(
    { [key]: intent },
    EMERGENCY_SYNC_RESERVE_BYTES,
    EMERGENCY_SYNC_RESERVE_ITEMS,
  );
  try {
    await assertSecurityRevision(expectedSecurityRevision);
    await setSyncItems({ [key]: intent });
    const claimed = await loadSyncSnapshot();
    if (
      claimed.security.revision !== expectedSecurityRevision ||
      claimed.deliveryPending ||
      claimed.activeIntent?.id !== intent.id
    ) {
      throw new SettingsChangedError();
    }
    return intent;
  } catch (error) {
    await chrome.storage.sync.remove(key).catch(() => undefined);
    throw error;
  }
}

async function assertTransitionOwnership(
  expectedSecurityRevision: string,
  intentId: string,
): Promise<SyncSnapshot> {
  const latest = await loadSyncSnapshot();
  if (
    latest.security.revision !== expectedSecurityRevision ||
    latest.deliveryPending ||
    latest.activeIntent?.id !== intentId
  ) {
    throw new SettingsChangedError();
  }
  return latest;
}

async function assertIntentOwnershipIgnoringDelivery(
  expectedSecurityRevision: string,
  intentId: string,
): Promise<void> {
  const collection = await collectSyncRecords();
  const security = resolveSettings(collection.raw).security;
  const activeIntent = findActiveTransitionIntent(collection, security.revision, Date.now());
  if (security.revision !== expectedSecurityRevision || activeIntent?.id !== intentId) {
    throw new SettingsChangedError();
  }
}

async function assertSecurityEpochCommitted(expectedSecurityRevision: string): Promise<void> {
  const latest = await loadSyncSnapshot();
  if (latest.security.revision !== expectedSecurityRevision || latest.deliveryPending) {
    throw new SettingsChangedError();
  }
}

export async function configureStorageAccess(): Promise<void> {
  await Promise.all([
    chrome.storage.sync.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
    chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
    chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
  ]);
}

export async function getSettings(): Promise<SyncSettings> {
  const raw = (await chrome.storage.sync.get([
    STORAGE_KEYS.settings,
    STORAGE_KEYS.retentionSettings,
    STORAGE_KEYS.securitySettings,
  ])) as Record<string, unknown>;
  return resolveSettings(raw).settings;
}

export async function getOrCreateDeviceId(): Promise<string> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.deviceId);
  const existing = result[STORAGE_KEYS.deviceId];
  if (typeof existing === "string" && existing.length >= 1 && existing.length <= 128) {
    return existing;
  }
  const deviceId = uuid();
  await chrome.storage.local.set({ [STORAGE_KEYS.deviceId]: deviceId });
  return deviceId;
}

export async function loadRemoteState(now = Date.now()): Promise<RemoteState> {
  const snapshot = await loadSyncSnapshot(now);
  if (snapshot.deliveryPending) throw new SettingsChangedError();
  return snapshot.state;
}

export async function getCachedSessionKey(
  settings: SyncSettings["encryption"],
): Promise<Uint8Array | null> {
  if (!settings.enabled) return null;
  const cached = await getAnyCachedSessionKey();
  if (!cached || cached.keyId !== settings.keyId) {
    if (cached) {
      const latest = await getSettings().catch(() => null);
      if (latest?.encryption.enabled && latest.encryption.keyId === cached.keyId) return null;
      await removeCachedSessionKeyIfUnchanged(cached.keyId);
    }
    return null;
  }
  return cached.rawKey;
}

async function getAnyCachedSessionKey(): Promise<{
  keyId: string;
  rawKey: Uint8Array;
} | null> {
  const result = await chrome.storage.session.get(STORAGE_KEYS.sessionKey);
  const cached = parseSessionKey(result[STORAGE_KEYS.sessionKey]);
  if (!cached) {
    if (result[STORAGE_KEYS.sessionKey] !== undefined) {
      await chrome.storage.session.remove(STORAGE_KEYS.sessionKey);
    }
    return null;
  }
  try {
    const bytes = base64ToBytes(cached.rawKey);
    if (bytes.byteLength === 32) return { keyId: cached.keyId, rawKey: bytes };
  } catch {
    // A corrupted session cache is treated as locked and removed below.
  }
  await chrome.storage.session.remove(STORAGE_KEYS.sessionKey);
  return null;
}

async function removeCachedSessionKeyIfUnchanged(expectedKeyId: string): Promise<void> {
  const result = await chrome.storage.session.get(STORAGE_KEYS.sessionKey);
  const current = parseSessionKey(result[STORAGE_KEYS.sessionKey]);
  if (current?.keyId === expectedKeyId) {
    await chrome.storage.session.remove(STORAGE_KEYS.sessionKey);
  }
}

export async function cacheSessionKey(keyId: string, rawKey: Uint8Array): Promise<void> {
  const record: SessionKeyRecord = {
    schemaVersion: 1,
    keyId,
    rawKey: bytesToBase64(rawKey),
  };
  await chrome.storage.session.set({ [STORAGE_KEYS.sessionKey]: record });
}

async function getStoredDraftRecord(): Promise<StoredDraftRecord | null> {
  const result = await chrome.storage.session.get(STORAGE_KEYS.draft);
  const raw = result[STORAGE_KEYS.draft];
  const parsed = parseDraft(raw);
  if (!parsed && raw !== undefined && raw !== null) {
    await chrome.storage.session.remove(STORAGE_KEYS.draft);
  }
  return parsed;
}

async function protectDraftForPrivateMode(keyId: string, rawKey: Uint8Array): Promise<void> {
  const draft = await getStoredDraftRecord();
  if (!draft) return;
  if (draft.schemaVersion === 2) {
    if (draft.keyId !== keyId) await clearDraft();
    return;
  }
  await chrome.storage.session.set({
    [STORAGE_KEYS.draft]: await encryptDraft(draft, keyId, rawKey),
  });
}

async function readDraftWithKey(
  expectedKeyId: string,
  rawKey: Uint8Array,
): Promise<StoredDraft | null> {
  const draft = await getStoredDraftRecord();
  if (!draft) return null;
  if (draft.schemaVersion === 1) return draft;
  if (draft.keyId !== expectedKeyId) return null;
  return decryptDraft(draft, rawKey);
}

/** Reconciles device-session secrets after a security mode/key change from
 * another context or device. It never exposes a draft while the active private
 * key is unavailable. */
export async function reconcileSessionSecurity(): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const settings = await getSettings();
    const [draft, cached] = await Promise.all([getStoredDraftRecord(), getAnyCachedSessionKey()]);
    if ((await getSettings()).revision !== settings.revision) continue;

    if (!settings.encryption.enabled) {
      if (draft?.schemaVersion === 2 && cached?.keyId === draft.keyId) {
        try {
          const plaintext = await decryptDraft(draft, cached.rawKey);
          if ((await getSettings()).revision !== settings.revision) continue;
          await chrome.storage.session.set({ [STORAGE_KEYS.draft]: plaintext });
        } catch {
          // Keep authenticated ciphertext rather than deleting an unsaved draft.
        }
      }
      if ((await getSettings()).revision !== settings.revision) continue;
      if (cached) await removeCachedSessionKeyIfUnchanged(cached.keyId);
      return;
    }

    if (cached && cached.keyId !== settings.encryption.keyId) {
      if ((await getSettings()).revision !== settings.revision) continue;
      await removeCachedSessionKeyIfUnchanged(cached.keyId);
      return;
    }
    if (draft?.schemaVersion === 1 && cached?.keyId === settings.encryption.keyId) {
      await protectDraftForPrivateMode(settings.encryption.keyId, cached.rawKey);
      if ((await getSettings()).revision !== settings.revision) continue;
    }
    return;
  }
}

export async function lockSession(): Promise<void> {
  const draft = await getStoredDraftRecord().catch(() => null);
  try {
    const settings = await getSettings();
    if (settings.encryption.enabled && draft?.schemaVersion === 1) {
      const rawKey = await getCachedSessionKey(settings.encryption);
      if (rawKey) await protectDraftForPrivateMode(settings.encryption.keyId, rawKey);
      else await clearDraft();
    } else if (
      settings.encryption.enabled &&
      draft?.schemaVersion === 2 &&
      draft.keyId !== settings.encryption.keyId
    ) {
      await clearDraft();
    }
  } catch {
    // Lock must fail closed. If settings or draft protection cannot be
    // validated, remove plaintext/unknown data but retain verified ciphertext.
    if (draft?.schemaVersion !== 2) await clearDraft().catch(() => undefined);
  } finally {
    await chrome.storage.session.remove(STORAGE_KEYS.sessionKey);
  }
}

export async function unlockSession(passphrase: string): Promise<void> {
  const settings = await getSettings();
  if (!settings.encryption.enabled) return;
  const rawKey = await unlockEncryption(settings.encryption, passphrase);
  const latest = await getSettings();
  if (
    !latest.encryption.enabled ||
    latest.revision !== settings.revision ||
    latest.encryption.keyId !== settings.encryption.keyId
  ) {
    throw new SettingsChangedError();
  }
  await cacheSessionKey(settings.encryption.keyId, rawKey);
  const committed = await getSettings();
  if (
    !committed.encryption.enabled ||
    committed.revision !== settings.revision ||
    committed.encryption.keyId !== settings.encryption.keyId
  ) {
    await removeCachedSessionKeyIfUnchanged(settings.encryption.keyId).catch(() => undefined);
    throw new SettingsChangedError();
  }
}

export async function loadReadableState(now = Date.now()): Promise<ReadableRemoteState> {
  const { state, settings, deliveryPending } = await loadSyncSnapshot(now);
  if (deliveryPending) throw new SettingsChangedError();
  if (!settings.encryption.enabled) {
    if (!state.note) return { ...state, text: null, locked: false };
    if (state.note.kind !== "plain") {
      throw new StorageDataError("Nội dung đang được mã hóa nhưng chế độ bảo vệ đã tắt.");
    }
    return { ...state, text: state.note.content, locked: false };
  }

  if (
    state.note &&
    (state.note.kind !== "encrypted" || state.note.keyId !== settings.encryption.keyId)
  ) {
    throw new StorageDataError("Nội dung không khớp với khóa bảo vệ hiện tại.");
  }
  const rawKey = await getCachedSessionKey(settings.encryption);
  if (!rawKey) return { ...state, text: null, locked: true };
  if (!state.note) return { ...state, text: null, locked: false };
  return { ...state, text: await decryptNote(state.note, rawKey), locked: false };
}

export async function getDraft(): Promise<StoredDraft | null> {
  await reconcileSessionSecurity();
  const draft = await getStoredDraftRecord();
  if (!draft) return null;
  const settings = await getSettings();
  if (!settings.encryption.enabled) {
    if (draft.schemaVersion === 1) return draft;
    return null;
  }
  const rawKey = await getCachedSessionKey(settings.encryption);
  if (!rawKey) {
    // A standard-mode draft may predate a private-mode change received from
    // another device. Keep it session-local but never render it while locked;
    // the first successful unlock encrypts/migrates it before returning it.
    return null;
  }
  if (draft.schemaVersion === 1) {
    try {
      await protectDraftForPrivateMode(settings.encryption.keyId, rawKey);
      return draft;
    } catch {
      await clearDraft().catch(() => undefined);
      return null;
    }
  }
  if (settings.encryption.keyId !== draft.keyId) return null;
  return decryptDraft(draft, rawKey);
}

export async function saveDraft(draft: StoredDraft): Promise<void> {
  if (utf8ByteLength(draft.text) > MAX_SESSION_DRAFT_BYTES || parseDraft(draft) === null) {
    throw new StorageDataError("Bản nháp khôi phục không hợp lệ hoặc quá lớn.");
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const settings = await getSettings();
    let record: StoredDraftRecord = draft;
    if (settings.encryption.enabled) {
      const rawKey = await getCachedSessionKey(settings.encryption);
      if (!rawKey) throw new LockedError();
      record = await encryptDraft(draft, settings.encryption.keyId, rawKey);
    }
    await chrome.storage.session.set({ [STORAGE_KEYS.draft]: record });
    const latest = await getSettings();
    if (latest.revision === settings.revision) return;
  }
  await clearDraft();
  throw new SettingsChangedError();
}

export async function clearDraft(): Promise<void> {
  await chrome.storage.session.remove(STORAGE_KEYS.draft);
}

export async function saveNote(input: SaveNoteInput): Promise<ReadableRemoteState> {
  assertTextWithinLimit(input.text);
  if (input.text.length === 0) throw new AppError("Nội dung đang trống.", "EMPTY_NOTE");

  const requestedAt = input.now ?? Date.now();
  const [{ state: current, settings, security, transitionPending }, sourceId] = await Promise.all([
    loadSyncSnapshot(requestedAt),
    getOrCreateDeviceId(),
  ]);
  if (transitionPending) throw new SettingsChangedError();
  if (!input.force && current.eventRevision !== input.baseEventRevision) {
    throw new ConflictError();
  }

  const createdAt = nextLogicalTimestamp(requestedAt, current.eventAt);
  const plain = createPlainNote(
    input.text,
    sourceId,
    settings.retentionMinutes,
    createdAt,
    security.revision,
  );
  let note: NoteRecord = plain;
  if (settings.encryption.enabled) {
    const rawKey = await getCachedSessionKey(settings.encryption);
    if (!rawKey) throw new LockedError();
    note = await encryptNote(plain, settings.encryption.keyId, rawKey);
  }

  await assertMutationAllowed(security.revision);
  const key = noteStorageKey(note.revision);
  const updates: Record<string, unknown> = { [key]: note };
  await assertSyncWriteBudget(updates);
  await setSyncItems(updates);
  // The UI clears the draft only after it reloads the canonical state and
  // confirms this exact revision won. Keeping it here closes the crash/race
  // window between the Sync write and that reconciliation.
  void requestCleanup();
  return {
    eventRevision: `note:${note.revision}`,
    eventAt: note.createdAt,
    note,
    expired: false,
    invalidItemCount: current.invalidItemCount,
    text: input.text,
    locked: false,
  };
}

export async function clearCurrent(expectedEventRevision: string | null): Promise<void> {
  const now = Date.now();
  const { security, state: current, transitionPending } = await loadSyncSnapshot(now);
  if (transitionPending) throw new SettingsChangedError();
  if (current.eventRevision !== expectedEventRevision) throw new ConflictError();
  if (!current.note) return;

  const marker = createClearMarker(nextLogicalTimestamp(now, current.eventAt), security.revision);
  const markerKey = clearMarkerStorageKey(marker.id);
  await assertMutationAllowed(security.revision);
  const updates: Record<string, unknown> = { [markerKey]: marker };
  await assertSyncWriteBudget(updates, EMERGENCY_SYNC_RESERVE_BYTES, EMERGENCY_SYNC_RESERVE_ITEMS);

  // Physical deletion is deliberately deferred. Chrome Sync can deliver a
  // remove before this marker on another device; cleanup first observes the
  // protector, then tombstones, and only later removes the old record.
  await setSyncItems(updates);
  try {
    await clearDraft();
  } catch {
    // Clearing the shared state must not be reported as failed after commit.
  }
  void requestCleanup();
}

function settingsView(
  retention: RetentionSettingsRecord,
  security: SecuritySettingsRecord,
): SyncSettings {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    revision: security.revision,
    retentionMinutes: retention.retentionMinutes,
    encryption: security.encryption,
  };
}

export async function updateRetention(retentionMinutes: RetentionMinutes): Promise<SyncSettings> {
  if (
    retentionMinutes !== null &&
    retentionMinutes !== 60 &&
    retentionMinutes !== 1_440 &&
    retentionMinutes !== 10_080
  ) {
    throw new StorageDataError("Thời gian lưu không hợp lệ.");
  }
  const snapshot = await loadSyncSnapshot();
  const next: RetentionSettingsRecord = {
    schemaVersion: RETENTION_SETTINGS_SCHEMA_VERSION,
    revision: uuid(),
    retentionMinutes,
  };
  await assertSyncWriteBudget({ [STORAGE_KEYS.retentionSettings]: next });
  await setSyncItems({ [STORAGE_KEYS.retentionSettings]: next });
  return settingsView(next, snapshot.security);
}

async function assertSecurityRevision(expectedRevision: string): Promise<void> {
  const raw = await chrome.storage.sync.get([
    STORAGE_KEYS.settings,
    STORAGE_KEYS.securitySettings,
    STORAGE_KEYS.retentionSettings,
  ]);
  const latest = resolveSettings(raw as Record<string, unknown>);
  if (latest.security.revision !== expectedRevision) throw new SettingsChangedError();
}

async function assertMutationAllowed(expectedRevision: string): Promise<SyncSnapshot> {
  const latest = await loadSyncSnapshot();
  if (latest.security.revision !== expectedRevision || latest.transitionPending) {
    throw new SettingsChangedError();
  }
  return latest;
}

function createReplacementPlain(
  source: NoteRecord,
  content: string,
  sourceId: string,
  createdAt: number,
  securityRevision: string,
): PlainNoteRecord | null {
  if (source.expiresAt !== null && source.expiresAt <= createdAt) return null;
  return {
    schemaVersion: NOTE_SCHEMA_VERSION,
    securityRevision,
    revision: uuid(),
    kind: "plain",
    content,
    sourceId,
    createdAt,
    updatedAt: createdAt,
    expiresAt: source.expiresAt,
  };
}

function createSecurityEpoch(
  encryption: EncryptionSettings,
  target: { eventRevision: string; eventAt: number },
  revision = uuid(),
): SecuritySettingsRecord {
  return {
    schemaVersion: SECURITY_SETTINGS_SCHEMA_VERSION,
    revision,
    encryption,
    targetEventRevision: target.eventRevision,
    targetEventAt: target.eventAt,
  };
}

function legacySettingsMirror(
  retention: RetentionSettingsRecord,
  security: SecuritySettingsRecord,
): SyncSettings {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    revision: security.revision,
    retentionMinutes: retention.retentionMinutes,
    encryption: security.encryption,
  };
}

export async function enableEncryption(passphrase: string): Promise<SyncSettings> {
  const initial = await loadSyncSnapshot();
  if (initial.settings.encryption.enabled || initial.transitionPending) {
    throw new SettingsChangedError();
  }
  const encryption = await createEncryptionSettings(passphrase);
  const intent = await claimSecurityTransition(initial.security.revision);
  try {
    const [snapshot, sourceId] = await Promise.all([
      assertTransitionOwnership(initial.security.revision, intent.id),
      getOrCreateDeviceId(),
    ]);
    const { retention, security: previousSecurity, state: readable } = snapshot;
    const transitionAt = Date.now();
    const nextSecurityRevision = uuid();
    const barrierAt = nextLogicalTimestamp(transitionAt, readable.eventAt);
    const marker = createClearMarker(barrierAt, nextSecurityRevision);
    const markerKey = clearMarkerStorageKey(marker.id);
    const previousEpochMarker = createClearMarker(barrierAt, previousSecurity.revision);

    const updates: Record<string, unknown> = {
      [markerKey]: marker,
      [clearMarkerStorageKey(previousEpochMarker.id)]: previousEpochMarker,
    };
    if (previousSecurity.targetEventRevision === null) {
      const legacyMarker: ClearMarkerRecord = {
        schemaVersion: LEGACY_STATE_RECORD_SCHEMA_VERSION,
        securityRevision: null,
        id: uuid(),
        clearedAt: barrierAt,
      };
      updates[legacyClearMarkerStorageKey(legacyMarker.id)] = legacyMarker;
    }
    let target = { eventRevision: `clear:${marker.id}`, eventAt: marker.clearedAt };

    if (readable.note?.kind === "plain") {
      const replacementPlain = createReplacementPlain(
        readable.note,
        readable.note.content,
        sourceId,
        nextLogicalTimestamp(barrierAt, barrierAt),
        nextSecurityRevision,
      );
      if (replacementPlain) {
        const encrypted = await encryptNote(
          replacementPlain,
          encryption.settings.keyId,
          encryption.rawKey,
        );
        const key = noteStorageKey(encrypted.revision);
        updates[key] = encrypted;
        target = { eventRevision: `note:${encrypted.revision}`, eventAt: encrypted.createdAt };
      }
    }

    const nextSecurity = createSecurityEpoch(encryption.settings, target, nextSecurityRevision);
    const retirement = createRetiredEpoch(previousSecurity, nextSecurityRevision, barrierAt);
    const next = settingsView(retention, nextSecurity);
    updates[retiredEpochStorageKey(retirement.id)] = retirement;
    updates[STORAGE_KEYS.securitySettings] = nextSecurity;
    updates[STORAGE_KEYS.settings] = legacySettingsMirror(retention, nextSecurity);

    await assertTransitionOwnership(previousSecurity.revision, intent.id);
    await assertSyncWriteBudget(
      updates,
      EMERGENCY_SYNC_RESERVE_BYTES,
      EMERGENCY_SYNC_RESERVE_ITEMS,
    );
    await assertTransitionOwnership(previousSecurity.revision, intent.id);
    await setSyncItems(updates);
    await assertSecurityEpochCommitted(nextSecurityRevision);
    try {
      await cacheSessionKey(encryption.settings.keyId, encryption.rawKey);
      await protectDraftForPrivateMode(encryption.settings.keyId, encryption.rawKey);
    } catch {
      // The shared private epoch is already committed. Fall back to a locked
      // local session and never report the committed transition as failed.
      await clearDraft().catch(() => undefined);
      await chrome.storage.session.remove(STORAGE_KEYS.sessionKey).catch(() => undefined);
    }
    void requestCleanup();
    return next;
  } catch (error) {
    await chrome.storage.sync.remove(transitionIntentStorageKey(intent.id)).catch(() => undefined);
    await lockSession().catch(() => undefined);
    throw error;
  }
}

export async function disableEncryption(passphrase: string): Promise<SyncSettings> {
  const initial = await loadSyncSnapshot();
  if (!initial.settings.encryption.enabled || initial.transitionPending) {
    throw new SettingsChangedError();
  }
  const rawKey = await unlockEncryption(initial.settings.encryption, passphrase);
  const intent = await claimSecurityTransition(initial.security.revision);
  try {
    const [snapshot, sourceId] = await Promise.all([
      assertTransitionOwnership(initial.security.revision, intent.id),
      getOrCreateDeviceId(),
    ]);
    const { retention, security: previousSecurity, state: readable } = snapshot;
    if (!previousSecurity.encryption.enabled) throw new SettingsChangedError();
    let content: string | null = null;
    if (readable.note) {
      if (
        readable.note.kind !== "encrypted" ||
        readable.note.keyId !== previousSecurity.encryption.keyId
      ) {
        throw new StorageDataError("Nội dung không khớp với khóa đang dùng.");
      }
      content = await decryptNote(readable.note, rawKey);
    }

    const transitionAt = Date.now();
    const nextSecurityRevision = uuid();
    const barrierAt = nextLogicalTimestamp(transitionAt, readable.eventAt);
    const marker = createClearMarker(barrierAt, nextSecurityRevision);
    const markerKey = clearMarkerStorageKey(marker.id);
    const previousEpochMarker = createClearMarker(barrierAt, previousSecurity.revision);
    const updates: Record<string, unknown> = {
      [markerKey]: marker,
      [clearMarkerStorageKey(previousEpochMarker.id)]: previousEpochMarker,
    };
    if (previousSecurity.targetEventRevision === null) {
      const legacyMarker: ClearMarkerRecord = {
        schemaVersion: LEGACY_STATE_RECORD_SCHEMA_VERSION,
        securityRevision: null,
        id: uuid(),
        clearedAt: barrierAt,
      };
      updates[legacyClearMarkerStorageKey(legacyMarker.id)] = legacyMarker;
    }
    let target = { eventRevision: `clear:${marker.id}`, eventAt: marker.clearedAt };
    if (content !== null && readable.note) {
      const replacement = createReplacementPlain(
        readable.note,
        content,
        sourceId,
        nextLogicalTimestamp(barrierAt, barrierAt),
        nextSecurityRevision,
      );
      if (replacement) {
        const key = noteStorageKey(replacement.revision);
        updates[key] = replacement;
        target = { eventRevision: `note:${replacement.revision}`, eventAt: replacement.createdAt };
      }
    }

    const nextSecurity = createSecurityEpoch({ enabled: false }, target, nextSecurityRevision);
    const retirement = createRetiredEpoch(previousSecurity, nextSecurityRevision, barrierAt);
    const next = settingsView(retention, nextSecurity);
    updates[retiredEpochStorageKey(retirement.id)] = retirement;
    updates[STORAGE_KEYS.securitySettings] = nextSecurity;
    updates[STORAGE_KEYS.settings] = legacySettingsMirror(retention, nextSecurity);

    await assertTransitionOwnership(previousSecurity.revision, intent.id);
    await assertSyncWriteBudget(
      updates,
      EMERGENCY_SYNC_RESERVE_BYTES,
      EMERGENCY_SYNC_RESERVE_ITEMS,
    );
    await assertTransitionOwnership(previousSecurity.revision, intent.id);
    await setSyncItems(updates);
    await assertSecurityEpochCommitted(nextSecurityRevision);
    try {
      const draft = await readDraftWithKey(previousSecurity.encryption.keyId, rawKey);
      if (draft) await chrome.storage.session.set({ [STORAGE_KEYS.draft]: draft });
      else await clearDraft();
    } catch {
      // An unreadable old-key draft must not linger after returning to standard mode.
      await clearDraft().catch(() => undefined);
    }
    await chrome.storage.session.remove(STORAGE_KEYS.sessionKey).catch(() => undefined);
    void requestCleanup();
    return next;
  } catch (error) {
    await chrome.storage.sync.remove(transitionIntentStorageKey(intent.id)).catch(() => undefined);
    throw error;
  }
}

/** User-confirmed destructive recovery. Known Textpipe state is pre-compacted
 * only after a projected quota check, then replaced by one empty security epoch. */
export async function resetSyncedData(): Promise<SyncSettings> {
  let collection = await collectSyncRecords();
  if (collection.invalidKeys.length > 0) {
    await chrome.storage.sync.remove(collection.invalidKeys);
    collection = await collectSyncRecords();
  }

  let resetIntent: SecurityTransitionIntentRecord | null = null;
  try {
    const snapshot = await loadSyncSnapshot();
    if (snapshot.activeIntent) throw new SettingsChangedError();
    if (!snapshot.deliveryPending) {
      try {
        resetIntent = await claimSecurityTransition(snapshot.security.revision);
        collection = (await assertTransitionOwnership(snapshot.security.revision, resetIntent.id))
          .collection;
      } catch (error) {
        // At the hard byte/item ceiling, the explicit destructive reset must be
        // able to reclaim its own records even when no intent item fits.
        if (!(error instanceof SyncQuotaError)) throw error;
        resetIntent = null;
        collection = await collectSyncRecords();
      }
    } else {
      // A target fence without a live transition intent is an interrupted or
      // partially delivered epoch. Explicit Reset is its recovery path.
      collection = snapshot.collection;
    }
  } catch (error) {
    // Malformed fixed settings are one of the reasons Reset exists. They cannot
    // participate in normal transition arbitration, so recovery proceeds by
    // replacing them with a fresh epoch.
    if (!(error instanceof StorageDataError)) throw error;
  }

  let observedTargetEventAt: number | null = null;
  try {
    observedTargetEventAt = resolveSettings(collection.raw).security.targetEventAt;
  } catch {
    // Corrupt security settings have no trustworthy ordering anchor.
  }
  const eventTimes = [
    ...collection.notes.map(({ note }) => note.createdAt),
    ...collection.tombstones.map(({ tombstone }) => tombstone.deletedAt),
    ...collection.clearMarkers.map(({ marker }) => marker.clearedAt),
    ...(observedTargetEventAt === null ? [] : [observedTargetEventAt]),
  ];
  const previousEventAt = eventTimes.length > 0 ? Math.max(...eventTimes) : null;
  const resetAt = nextLogicalTimestamp(Date.now(), previousEventAt);
  const nextSecurityRevision = uuid();
  const marker = createClearMarker(resetAt, nextSecurityRevision);
  const markerKey = clearMarkerStorageKey(marker.id);
  const retention: RetentionSettingsRecord = {
    schemaVersion: RETENTION_SETTINGS_SCHEMA_VERSION,
    revision: uuid(),
    retentionMinutes: DEFAULT_RETENTION_SETTINGS.retentionMinutes,
  };
  const security = createSecurityEpoch(
    { enabled: false },
    { eventRevision: `clear:${marker.id}`, eventAt: marker.clearedAt },
    nextSecurityRevision,
  );
  const next = settingsView(retention, security);
  const legacyMarker: ClearMarkerRecord = {
    schemaVersion: LEGACY_STATE_RECORD_SCHEMA_VERSION,
    securityRevision: null,
    id: uuid(),
    clearedAt: resetAt,
  };
  const criticalUpdates: Record<string, unknown> = {
    [markerKey]: marker,
    [STORAGE_KEYS.retentionSettings]: retention,
    [STORAGE_KEYS.securitySettings]: security,
    [STORAGE_KEYS.settings]: legacySettingsMirror(retention, security),
    [legacyClearMarkerStorageKey(legacyMarker.id)]: legacyMarker,
  };

  const observedEpochs = new Set<string>();
  for (const revision of [
    ...collection.notes.map(({ note }) => note.securityRevision),
    ...collection.tombstones.map(({ tombstone }) => tombstone.securityRevision),
    ...collection.clearMarkers.map(({ marker: oldMarker }) => oldMarker.securityRevision),
    ...collection.retiredEpochs.flatMap(({ retirement }) => [
      retirement.retiredRevision,
      retirement.successorRevision,
    ]),
  ]) {
    if (revision !== null) observedEpochs.add(revision);
  }
  try {
    observedEpochs.add(resolveSettings(collection.raw).security.revision);
  } catch {
    // The corrupt fixed setting is replaced by the reset batch below.
  }
  if (observedEpochs.size === 0) observedEpochs.add("legacy");
  const postResetMetadata: Record<string, unknown> = {};
  let carriesLegacyRetirement = true;
  for (const retiredRevision of observedEpochs) {
    const retirement: RetiredSecurityEpochRecord = {
      schemaVersion: 1,
      id: uuid(),
      retiredRevision,
      successorRevision: nextSecurityRevision,
      retireLegacyRecords: carriesLegacyRetirement,
      retiredAt: resetAt,
    };
    carriesLegacyRetirement = false;
    postResetMetadata[retiredEpochStorageKey(retirement.id)] = retirement;
    const previousEpochMarker = createClearMarker(resetAt, retiredRevision);
    postResetMetadata[clearMarkerStorageKey(previousEpochMarker.id)] = previousEpochMarker;
  }

  const preCompactKeys = [
    ...collection.notes.map(({ key }) => key),
    ...collection.tombstones.map(({ key }) => key),
    ...collection.clearMarkers.map(({ key }) => key),
    ...collection.transitionIntents
      .filter(({ intent }) => intent.id !== resetIntent?.id)
      .map(({ key }) => key),
    ...collection.retiredEpochs.map(({ key }) => key),
    ...collection.invalidKeys,
  ];
  const uniquePreCompactKeys = [...new Set(preCompactKeys)];

  try {
    await assertSyncWriteBudgetAfterRemoval(criticalUpdates, uniquePreCompactKeys);
    if (resetIntent) {
      await assertTransitionOwnership(resetIntent.fromSecurityRevision, resetIntent.id);
    }
    if (uniquePreCompactKeys.length > 0) {
      await chrome.storage.sync.remove(uniquePreCompactKeys);
    }
    if (resetIntent) {
      await assertIntentOwnershipIgnoringDelivery(resetIntent.fromSecurityRevision, resetIntent.id);
    }
    await setSyncItems(criticalUpdates);
    await assertSecurityEpochCommitted(nextSecurityRevision);
  } catch (error) {
    if (resetIntent) {
      await chrome.storage.sync
        .remove(transitionIntentStorageKey(resetIntent.id))
        .catch(() => undefined);
    }
    await chrome.storage.session
      .remove([STORAGE_KEYS.draft, STORAGE_KEYS.sessionKey])
      .catch(() => undefined);
    throw error;
  }

  if (Object.keys(postResetMetadata).length > 0) {
    try {
      await assertSyncWriteBudget(
        postResetMetadata,
        EMERGENCY_SYNC_RESERVE_BYTES,
        EMERGENCY_SYNC_RESERVE_ITEMS,
      );
      await setSyncItems(postResetMetadata);
    } catch {
      // The critical empty epoch already succeeded. Missing retirement metadata
      // weakens replay resistance if an old fixed security record also returns,
      // so the limitation remains disclosed rather than reported as secure erase.
    }
  }

  try {
    const local = await chrome.storage.local.get(null);
    const localKeys = Object.keys(local).filter(
      (key) =>
        key.startsWith(ORPHAN_SEEN_KEY_PREFIX) ||
        key.startsWith(STATE_SEEN_KEY_PREFIX) ||
        key.startsWith(READ_CURSOR_KEY_PREFIX),
    );
    if (localKeys.length > 0) await chrome.storage.local.remove(localKeys);
  } catch {
    // Device-local cursors contain no payload and can be reconciled later.
  }
  await chrome.storage.session
    .remove([STORAGE_KEYS.draft, STORAGE_KEYS.sessionKey])
    .catch(() => undefined);
  void requestCleanup();
  return next;
}

function stateSeenStorageKey(eventRevision: string): string {
  return `${STATE_SEEN_KEY_PREFIX}${eventRevision}`;
}

function parseLocalObservation(value: unknown): OrphanSeenRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = value as Partial<OrphanSeenRecord>;
  if (
    candidate.schemaVersion !== 1 ||
    typeof candidate.firstSeenAt !== "number" ||
    !Number.isSafeInteger(candidate.firstSeenAt) ||
    candidate.firstSeenAt < 0
  ) {
    return null;
  }
  return { schemaVersion: 1, firstSeenAt: candidate.firstSeenAt };
}

async function hasMatureStateProtector(state: RemoteState, now: number): Promise<boolean> {
  if (state.eventRevision === null || state.eventAt === null) return false;
  const key = stateSeenStorageKey(state.eventRevision);
  try {
    const stored = (await chrome.storage.local.get(null)) as Record<string, unknown>;
    const parsed = parseLocalObservation(stored[key]);
    if (!parsed) {
      await chrome.storage.local.set({ [key]: { schemaVersion: 1, firstSeenAt: now } });
    }
    const staleKeys = Object.keys(stored).filter(
      (storedKey) => storedKey.startsWith(STATE_SEEN_KEY_PREFIX) && storedKey !== key,
    );
    if (staleKeys.length > 0) await chrome.storage.local.remove(staleKeys);
    return parsed !== null && parsed.firstSeenAt + ORPHAN_GRACE_PERIOD_MS <= now;
  } catch {
    // Without a durable local observation time, physical deletion is unsafe.
    return false;
  }
}

function isRetiredNote(note: NoteRecord, collection: SyncCollection): boolean {
  if (note.securityRevision === null) {
    return collection.retiredEpochs.some(({ retirement }) => retirement.retireLegacyRecords);
  }
  return collection.retiredEpochs.some(
    ({ retirement }) => retirement.retiredRevision === note.securityRevision,
  );
}

function tombstoneCommitTime(tombstone: TombstoneRecord): number {
  return Math.max(0, tombstone.keepUntil - TOMBSTONE_RETENTION_MS);
}

export async function cleanupStorage(now = Date.now()): Promise<void> {
  const { collection, security, state, transitionPending } = await loadSyncSnapshot(now);

  const expiredIntentKeys = collection.transitionIntents
    .filter(({ intent }) => intent.expiresAt <= now)
    .map(({ key }) => key);
  if (expiredIntentKeys.length > 0) await chrome.storage.sync.remove(expiredIntentKeys);
  if (transitionPending) return;

  const compatibleNewestFirst = collection.notes
    .filter(({ note }) => isNoteCompatible(note, security))
    .sort(
      (left, right) =>
        right.note.createdAt - left.note.createdAt ||
        right.note.revision.localeCompare(left.note.revision),
    );
  const activeExpiredRevision = state.eventRevision?.startsWith("expired:")
    ? state.eventRevision.slice("expired:".length)
    : null;
  const currentRevision = state.note?.revision ?? activeExpiredRevision;

  if (activeExpiredRevision && state.eventAt !== null) {
    const expiryBarrier = createClearMarker(
      nextLogicalTimestamp(now, state.eventAt, now),
      security.revision,
    );
    const expiryBarrierKey = clearMarkerStorageKey(expiryBarrier.id);
    try {
      await assertSyncWriteBudget(
        { [expiryBarrierKey]: expiryBarrier },
        EMERGENCY_SYNC_RESERVE_BYTES,
        EMERGENCY_SYNC_RESERVE_ITEMS,
      );
      await setSyncItems({ [expiryBarrierKey]: expiryBarrier });
    } catch {
      // The synthetic expiry keeps the note hidden until a barrier can commit.
    }
    return;
  }

  const protectorMature = await hasMatureStateProtector(state, now);
  if (!protectorMature) return;

  const compatibleCandidates = compatibleNewestFirst.filter(
    ({ note }) => note.revision !== currentRevision,
  );
  const retiredCandidates = collection.notes.filter(
    ({ note }) => !isNoteCompatible(note, security) && isRetiredNote(note, collection),
  );
  const candidates = [...compatibleCandidates, ...retiredCandidates];
  const tombstoneByTarget = new Map<string, TombstoneRecord>();
  for (const { tombstone } of collection.tombstones) {
    const previous = tombstoneByTarget.get(tombstone.targetRevision);
    if (!previous || tombstoneCommitTime(tombstone) > tombstoneCommitTime(previous)) {
      tombstoneByTarget.set(tombstone.targetRevision, tombstone);
    }
  }
  const needsTombstone = candidates.filter(({ note }) => !tombstoneByTarget.has(note.revision));

  if (needsTombstone.length > 0) {
    const tombstoneEntries: Array<[string, TombstoneRecord]> = [];
    for (const { note } of needsTombstone.slice(0, MAX_TOMBSTONES_PER_CLEANUP_BATCH)) {
      const effectiveDeleteTime =
        note.expiresAt !== null && note.expiresAt <= now ? note.expiresAt : note.createdAt;
      const tombstone = createTombstone(
        note.revision,
        effectiveDeleteTime,
        now,
        "record",
        security.revision,
      );
      tombstoneEntries.push([tombstoneStorageKey(tombstone.id), tombstone]);
    }
    while (tombstoneEntries.length > 0) {
      const tombstoneValues = Object.fromEntries(tombstoneEntries);
      try {
        // Tombstones are what let cleanup free the emergency reserve. They may
        // consume the last available bytes/items; no payload is removed until
        // a later pass observes the tombstone as mature.
        await assertSyncWriteBudget(tombstoneValues, 0, 0);
        await setSyncItems(tombstoneValues);
        break;
      } catch (error) {
        if (!(error instanceof SyncQuotaError) || tombstoneEntries.length === 1) break;
        tombstoneEntries.splice(Math.ceil(tombstoneEntries.length / 2));
      }
    }
  }

  const notesReadyToRemove = candidates.filter(({ note }) => {
    const tombstone = tombstoneByTarget.get(note.revision);
    return (
      tombstone !== undefined && tombstoneCommitTime(tombstone) + ORPHAN_GRACE_PERIOD_MS <= now
    );
  });
  if (notesReadyToRemove.length > 0) {
    await chrome.storage.sync.remove(notesReadyToRemove.map(({ key }) => key));
  }

  const removedRevisions = new Set(notesReadyToRemove.map(({ note }) => note.revision));
  const remainingNotes = collection.notes
    .map(({ note }) => note)
    .filter((note) => !removedRevisions.has(note.revision));
  const remainingRevisions = new Set(remainingNotes.map((note) => note.revision));
  const tombstonesNewestFirst = [...collection.tombstones].sort(
    (left, right) =>
      right.tombstone.deletedAt - left.tombstone.deletedAt ||
      right.tombstone.id.localeCompare(left.tombstone.id),
  );
  const tombstonesToRemove = tombstonesNewestFirst.filter(
    ({ tombstone }, index) =>
      !remainingRevisions.has(tombstone.targetRevision) &&
      (tombstone.keepUntil <= now || index >= MAX_RETAINED_TOMBSTONES),
  );
  if (tombstonesToRemove.length > 0) {
    await chrome.storage.sync.remove(tombstonesToRemove.map(({ key }) => key));
  }

  const removableClearMarkers = collection.clearMarkers.filter(({ marker }) => {
    if (isEpochCompatible(marker.securityRevision, security)) return true;
    if (marker.securityRevision === null) {
      return collection.retiredEpochs.some(({ retirement }) => retirement.retireLegacyRecords);
    }
    return collection.retiredEpochs.some(
      ({ retirement }) => retirement.retiredRevision === marker.securityRevision,
    );
  });
  const clearMarkersNewestFirst = removableClearMarkers.sort(
    (left, right) =>
      right.marker.clearedAt - left.marker.clearedAt ||
      right.marker.id.localeCompare(left.marker.id),
  );
  const activeMarkers = clearMarkersNewestFirst.filter(({ marker }) =>
    isEpochCompatible(marker.securityRevision, security),
  );
  const activeKeysToKeep = new Set(
    activeMarkers.slice(0, MAX_RETAINED_CLEAR_MARKERS).map(({ key }) => key),
  );
  const retiredKeysToKeep = new Set<string>();
  const protectedRetiredEpochs = new Set<string>();
  for (const { key, marker } of clearMarkersNewestFirst) {
    if (isEpochCompatible(marker.securityRevision, security)) continue;
    const epoch = marker.securityRevision ?? "__legacy__";
    if (!protectedRetiredEpochs.has(epoch)) {
      // Keep one barrier for every retired epoch indefinitely. Chrome Sync has
      // no cross-key removal ordering, and a late old client must not observe
      // the marker removal before a replayed note from the same epoch.
      protectedRetiredEpochs.add(epoch);
      retiredKeysToKeep.add(key);
    }
  }
  const oldClearMarkers = clearMarkersNewestFirst.filter(({ key, marker }) =>
    isEpochCompatible(marker.securityRevision, security)
      ? !activeKeysToKeep.has(key)
      : !retiredKeysToKeep.has(key),
  );
  if (oldClearMarkers.length > 0) {
    await chrome.storage.sync.remove(oldClearMarkers.map(({ key }) => key));
  }
}

export async function requestCleanup(): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: CLEANUP_ALARM_NAME });
  } catch {
    // Cleanup is best-effort; the recurring alarm remains the fallback.
  }
}

export function isRelevantSyncChange(
  changes: Record<string, chrome.storage.StorageChange>,
): boolean {
  return Object.keys(changes).some(
    (key) =>
      key === STORAGE_KEYS.settings ||
      key === STORAGE_KEYS.retentionSettings ||
      key === STORAGE_KEYS.securitySettings ||
      key.startsWith(NOTE_KEY_PREFIX) ||
      key.startsWith(LEGACY_NOTE_KEY_PREFIX) ||
      key.startsWith(TOMBSTONE_KEY_PREFIX) ||
      key.startsWith(LEGACY_TOMBSTONE_KEY_PREFIX) ||
      key.startsWith(CLEAR_MARKER_KEY_PREFIX) ||
      key.startsWith(LEGACY_CLEAR_MARKER_KEY_PREFIX) ||
      key.startsWith(TRANSITION_INTENT_KEY_PREFIX) ||
      key.startsWith(RETIRED_EPOCH_KEY_PREFIX),
  );
}
