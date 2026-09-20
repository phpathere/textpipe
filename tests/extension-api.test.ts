import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLEAR_MARKER_KEY_PREFIX,
  LEGACY_CLEAR_MARKER_KEY_PREFIX,
  LEGACY_TOMBSTONE_KEY_PREFIX,
  MAX_FUTURE_CLOCK_SKEW_MS,
  MAX_SESSION_DRAFT_BYTES,
  NOTE_KEY_PREFIX,
  ORPHAN_GRACE_PERIOD_MS,
  STORAGE_KEYS,
  TOMBSTONE_KEY_PREFIX,
  TOMBSTONE_RETENTION_MS,
  TRANSITION_INTENT_KEY_PREFIX,
} from "../src/shared/constants";
import {
  ConflictError,
  InvalidPassphraseError,
  StorageDataError,
  SyncQuotaError,
} from "../src/shared/errors";
import { storageItemByteLength } from "../src/shared/encoding";
import { createEncryptionSettings } from "../src/shared/crypto";
import { createPlainNote, noteStorageKey } from "../src/shared/note-domain";
import {
  cleanupStorage,
  cacheSessionKey,
  clearCurrent,
  disableEncryption,
  enableEncryption,
  getDraft,
  getCachedSessionKey,
  getSettings,
  loadReadableState,
  loadRemoteState,
  lockSession,
  reconcileSessionSecurity,
  resetSyncedData,
  saveDraft,
  saveNote,
  SettingsChangedError,
  unlockSession,
  updateRetention,
} from "../src/shared/extension-api";
import { installChromeMock, type ChromeMock } from "./chrome-mock";

describe("extension storage integration", () => {
  let mock: ChromeMock;

  beforeEach(() => {
    mock = installChromeMock();
  });

  it("stores every share under an immutable unique key", async () => {
    const first = await saveNote({ text: "first", baseEventRevision: null, now: 100 });
    await expect(
      saveNote({ text: "stale", baseEventRevision: null, now: 101 }),
    ).rejects.toBeInstanceOf(ConflictError);

    const second = await saveNote({
      text: "second",
      baseEventRevision: first.eventRevision,
      now: 102,
    });
    const keys = Object.keys(mock.sync.snapshot()).filter((key) => key.startsWith(NOTE_KEY_PREFIX));

    expect(keys).toHaveLength(2);
    expect(second.text).toBe("second");
    await expect(loadReadableState(103)).resolves.toMatchObject({ text: "second" });
  });

  it("keeps concurrent forced writes without overwriting either record", async () => {
    const first = await saveNote({ text: "one", baseEventRevision: null, now: 100 });
    await saveNote({
      text: "two",
      baseEventRevision: first.eventRevision,
      force: true,
      now: 101,
    });

    const notes = Object.entries(mock.sync.snapshot()).filter(([key]) =>
      key.startsWith(NOTE_KEY_PREFIX),
    );
    expect(notes).toHaveLength(2);
    expect(notes.map(([, value]) => (value as { content: string }).content).sort()).toEqual([
      "one",
      "two",
    ]);
  });

  it("persists drafts only in session memory", async () => {
    await saveDraft({
      schemaVersion: 1,
      text: "local draft",
      baseEventRevision: null,
      updatedAt: 100,
    });
    await expect(getDraft()).resolves.toMatchObject({ text: "local draft" });
    expect(mock.sync.snapshot()).not.toHaveProperty(STORAGE_KEYS.draft);
    expect(mock.local.snapshot()).not.toHaveProperty(STORAGE_KEYS.draft);
  });

  it("rejects oversized recovery drafts before storage.session and purges malformed raw drafts", async () => {
    await expect(
      saveDraft({
        schemaVersion: 1,
        text: "x".repeat(MAX_SESSION_DRAFT_BYTES + 1),
        baseEventRevision: null,
        updatedAt: 100,
      }),
    ).rejects.toBeInstanceOf(StorageDataError);
    expect(mock.session.snapshot()).not.toHaveProperty(STORAGE_KEYS.draft);

    await mock.session.set({
      [STORAGE_KEYS.draft]: {
        schemaVersion: 1,
        text: "plaintext that does not satisfy the schema",
        baseEventRevision: { invalid: true },
        updatedAt: 100,
      },
    });
    await expect(getDraft()).resolves.toBeNull();
    expect(mock.session.snapshot()).not.toHaveProperty(STORAGE_KEYS.draft);
  });

  it("stores private-mode drafts as ciphertext and decrypts them only while unlocked", async () => {
    const passphrase = "correct horse battery staple";
    await enableEncryption(passphrase);
    await saveDraft({
      schemaVersion: 1,
      text: "private draft",
      baseEventRevision: null,
      updatedAt: 100,
    });

    const stored = mock.session.snapshot()[STORAGE_KEYS.draft];
    expect(stored).toMatchObject({ schemaVersion: 2 });
    expect(stored).not.toHaveProperty("text");
    await expect(getDraft()).resolves.toMatchObject({ text: "private draft" });

    await lockSession();
    await expect(getDraft()).resolves.toBeNull();
    expect(mock.session.snapshot()[STORAGE_KEYS.draft]).not.toHaveProperty("text");

    await unlockSession(passphrase);
    await expect(getDraft()).resolves.toMatchObject({ text: "private draft" });
  });

  it("does not let background session reconciliation erase a newly committed private key", async () => {
    const originalSessionSet = mock.session.set.bind(mock.session);
    vi.spyOn(mock.session, "set").mockImplementation(async (items) => {
      await originalSessionSet(items);
      if (Object.hasOwn(items, STORAGE_KEYS.sessionKey)) {
        await reconcileSessionSecurity();
      }
    });

    await enableEncryption("correct horse battery staple");

    expect(mock.session.snapshot()).toHaveProperty(STORAGE_KEYS.sessionKey);
    await expect(loadReadableState()).resolves.toMatchObject({ locked: false });
  });

  it("does not delete a newer cached key when a caller holds stale settings", async () => {
    const original = await enableEncryption("correct horse battery staple");
    if (!original.encryption.enabled) throw new Error("Expected private settings");
    const replacement = await createEncryptionSettings("a different strong passphrase");
    await mock.sync.set({
      [STORAGE_KEYS.securitySettings]: {
        schemaVersion: 2,
        revision: "newer-private-security-revision",
        encryption: replacement.settings,
        targetEventRevision: null,
        targetEventAt: null,
      },
    });
    await cacheSessionKey(replacement.settings.keyId, replacement.rawKey);

    await expect(getCachedSessionKey(original.encryption)).resolves.toBeNull();
    expect(mock.session.snapshot()[STORAGE_KEYS.sessionKey]).toMatchObject({
      keyId: replacement.settings.keyId,
    });
  });

  it("purges a derived key when the security epoch changes during unlock", async () => {
    const passphrase = "correct horse battery staple";
    await enableEncryption(passphrase);
    await lockSession();
    const originalSessionSet = mock.session.set.bind(mock.session);
    let replacedSecurity = false;
    vi.spyOn(mock.session, "set").mockImplementation(async (items) => {
      await originalSessionSet(items);
      if (!replacedSecurity && Object.hasOwn(items, STORAGE_KEYS.sessionKey)) {
        replacedSecurity = true;
        await mock.sync.set({
          [STORAGE_KEYS.securitySettings]: {
            schemaVersion: 2,
            revision: "remote-standard-during-unlock",
            encryption: { enabled: false },
            targetEventRevision: null,
            targetEventAt: null,
          },
        });
      }
    });

    await expect(unlockSession(passphrase)).rejects.toBeInstanceOf(SettingsChangedError);
    expect(mock.session.snapshot()).not.toHaveProperty(STORAGE_KEYS.sessionKey);
  });

  it("hides a pre-existing plaintext draft while locked and encrypts it after unlock", async () => {
    await enableEncryption("correct horse battery staple");
    await lockSession();
    await mock.session.set({
      [STORAGE_KEYS.draft]: {
        schemaVersion: 1,
        text: "must not leak after lock",
        baseEventRevision: null,
        updatedAt: Date.now(),
      },
    });

    await expect(getDraft()).resolves.toBeNull();
    expect(mock.session.snapshot()[STORAGE_KEYS.draft]).toHaveProperty(
      "text",
      "must not leak after lock",
    );

    await unlockSession("correct horse battery staple");
    await expect(getDraft()).resolves.toMatchObject({ text: "must not leak after lock" });
    expect(mock.session.snapshot()[STORAGE_KEYS.draft]).not.toHaveProperty("text");
  });

  it("purges a plaintext draft if settings cannot be validated during Lock", async () => {
    await enableEncryption("correct horse battery staple");
    await mock.session.set({
      [STORAGE_KEYS.draft]: {
        schemaVersion: 1,
        text: "fail closed",
        baseEventRevision: null,
        updatedAt: Date.now(),
      },
    });
    await mock.sync.set({
      [STORAGE_KEYS.securitySettings]: { schemaVersion: 2, encryption: { enabled: true } },
    });

    await expect(lockSession()).resolves.toBeUndefined();
    expect(mock.session.snapshot()).not.toHaveProperty(STORAGE_KEYS.draft);
    expect(mock.session.snapshot()).not.toHaveProperty(STORAGE_KEYS.sessionKey);
  });

  it("leaves draft removal to canonical UI reconciliation after a Sync write", async () => {
    await saveDraft({
      schemaVersion: 1,
      text: "recoverable until canonical read",
      baseEventRevision: null,
      updatedAt: 100,
    });

    await saveNote({ text: "recoverable until canonical read", baseEventRevision: null, now: 101 });

    await expect(getDraft()).resolves.toMatchObject({
      text: "recoverable until canonical read",
    });
  });

  it("keeps a durable clear barrier and never reveals older history", async () => {
    const now = Date.now();
    await updateRetention(null);
    const first = await saveNote({ text: "old", baseEventRevision: null, now });
    const firstRecord = Object.entries(mock.sync.snapshot()).find(([key]) =>
      key.startsWith(NOTE_KEY_PREFIX),
    );
    const latest = await saveNote({
      text: "latest",
      baseEventRevision: first.eventRevision,
      now: now + 1,
    });
    await clearCurrent(latest.eventRevision);

    const state = await loadReadableState(now + 2);
    expect(state.text).toBeNull();
    expect(state.note).toBeNull();
    expect(
      Object.keys(mock.sync.snapshot()).some((key) => key.startsWith(CLEAR_MARKER_KEY_PREFIX)),
    ).toBe(true);

    await cleanupStorage(now + TOMBSTONE_RETENTION_MS + 1);
    expect(
      Object.keys(mock.sync.snapshot()).filter((key) => key.startsWith(CLEAR_MARKER_KEY_PREFIX)),
    ).toHaveLength(1);

    // Simulate an old offline replica replaying a record after short-lived
    // tombstones would already have been collected.
    expect(firstRecord).toBeDefined();
    if (firstRecord) await mock.sync.set({ [firstRecord[0]]: firstRecord[1] });
    await expect(loadReadableState(now + TOMBSTONE_RETENTION_MS + 2)).resolves.toMatchObject({
      text: null,
      note: null,
    });

    const cleared = await loadRemoteState(now + TOMBSTONE_RETENTION_MS + 2);
    const replacement = await saveNote({
      text: "new after clear",
      baseEventRevision: cleared.eventRevision,
      now: 1,
    });
    expect(replacement.eventAt).toBeGreaterThan(cleared.eventAt ?? 0);
    await expect(loadReadableState()).resolves.toMatchObject({ text: "new after clear" });
  });

  it("hides and cleans expired records", async () => {
    await saveNote({ text: "temporary", baseEventRevision: null, now: 100 });
    const expiresAt = 100 + 1_440 * 60_000;
    expect((await loadRemoteState(expiresAt)).expired).toBe(true);

    await cleanupStorage(expiresAt);
    await cleanupStorage(expiresAt + 1);
    await cleanupStorage(expiresAt + ORPHAN_GRACE_PERIOD_MS + 2);
    await cleanupStorage(expiresAt + 2 * ORPHAN_GRACE_PERIOD_MS + 3);
    expect(
      Object.keys(mock.sync.snapshot()).filter((key) => key.startsWith(NOTE_KEY_PREFIX)),
    ).toHaveLength(0);
    expect((await loadReadableState(expiresAt + 1)).text).toBeNull();
  });

  it("does not resurrect an older never-expiring note after a newer note expires", async () => {
    const now = Date.now();
    await updateRetention(null);
    const older = await saveNote({ text: "older forever", baseEventRevision: null, now });
    const olderEntry = Object.entries(mock.sync.snapshot()).find(([key]) =>
      key.startsWith(NOTE_KEY_PREFIX),
    );

    await updateRetention(60);
    await saveNote({
      text: "newer temporary",
      baseEventRevision: older.eventRevision,
      now: now + 1,
    });
    const expiresAt = now + 1 + 60 * 60_000;
    await cleanupStorage(expiresAt);
    await expect(loadReadableState(expiresAt + 1)).resolves.toMatchObject({ text: null });

    await cleanupStorage(expiresAt + TOMBSTONE_RETENTION_MS + 1);
    expect(olderEntry).toBeDefined();
    if (olderEntry) await mock.sync.set({ [olderEntry[0]]: olderEntry[1] });
    await expect(loadReadableState(expiresAt + TOMBSTONE_RETENTION_MS + 2)).resolves.toMatchObject({
      text: null,
      note: null,
    });
  });

  it("does not let an older note expiry hide a newer never-expiring note", async () => {
    const now = Date.now();
    await updateRetention(60);
    const older = await saveNote({ text: "older temporary", baseEventRevision: null, now });
    await updateRetention(null);
    await saveNote({
      text: "newer forever",
      baseEventRevision: older.eventRevision,
      now: now + 1,
    });

    const afterOlderExpiry = now + 60 * 60_000 + 1;
    await expect(loadReadableState(afterOlderExpiry)).resolves.toMatchObject({
      text: "newer forever",
      expired: false,
    });
    await cleanupStorage(afterOlderExpiry);
    await expect(loadReadableState(afterOlderExpiry + 1)).resolves.toMatchObject({
      text: "newer forever",
      expired: false,
    });
  });

  it("encrypts the current record, keeps the key in session, and supports lock/unlock", async () => {
    const passphrase = "correct horse battery staple";
    await saveNote({ text: "bí mật thử nghiệm", baseEventRevision: null, now: Date.now() });
    const protectedSettings = await enableEncryption(passphrase);
    expect(protectedSettings.encryption.enabled).toBe(true);

    const activeSecurityRevision = protectedSettings.revision;
    const syncedNotes = Object.entries(mock.sync.snapshot()).filter(
      ([key, value]) =>
        key.startsWith(NOTE_KEY_PREFIX) &&
        typeof value === "object" &&
        value !== null &&
        "securityRevision" in value &&
        value.securityRevision === activeSecurityRevision,
    );
    expect(syncedNotes).toHaveLength(1);
    expect(syncedNotes[0]?.[1]).not.toHaveProperty("content");
    await expect(loadReadableState()).resolves.toMatchObject({
      text: "bí mật thử nghiệm",
      locked: false,
    });

    await lockSession();
    await expect(loadReadableState()).resolves.toMatchObject({ text: null, locked: true });
    await expect(unlockSession("this passphrase is wrong")).rejects.toBeInstanceOf(
      InvalidPassphraseError,
    );
    await unlockSession(passphrase);
    await expect(loadReadableState()).resolves.toMatchObject({
      text: "bí mật thử nghiệm",
      locked: false,
    });
  });

  it("keeps plaintext and the previous security epoch when the transition commit fails", async () => {
    await saveNote({ text: "still standard", baseEventRevision: null, now: Date.now() });
    vi.spyOn(mock.sync, "set").mockRejectedValueOnce(new Error("simulated commit failure"));

    await expect(enableEncryption("correct horse battery staple")).rejects.toThrow(
      "simulated commit failure",
    );
    await expect(getSettings()).resolves.toMatchObject({ encryption: { enabled: false } });
    expect(JSON.stringify(mock.sync.snapshot())).toContain("still standard");
  });

  it("cannot downgrade private mode when retention changes during an encryption transition", async () => {
    await saveNote({ text: "race-safe", baseEventRevision: null, now: Date.now() });
    const originalSet = mock.sync.set.bind(mock.sync);
    let releaseSecurityCommit!: () => void;
    let signalSecurityCommit!: () => void;
    const securityCommitStarted = new Promise<void>((resolve) => {
      signalSecurityCommit = resolve;
    });
    const securityCommitReleased = new Promise<void>((resolve) => {
      releaseSecurityCommit = resolve;
    });
    vi.spyOn(mock.sync, "set").mockImplementation(async (items) => {
      if (Object.hasOwn(items, STORAGE_KEYS.securitySettings)) {
        signalSecurityCommit();
        await securityCommitReleased;
      }
      await originalSet(items);
    });

    const enabling = enableEncryption("correct horse battery staple");
    await securityCommitStarted;
    await updateRetention(10_080);
    releaseSecurityCommit();
    await enabling;

    await expect(getSettings()).resolves.toMatchObject({
      retentionMinutes: 10_080,
      encryption: { enabled: true },
    });
  });

  it("refuses destructive reset while a security transition owns the old epoch", async () => {
    await saveNote({ text: "do not race reset", baseEventRevision: null, now: Date.now() });
    const originalSet = mock.sync.set.bind(mock.sync);
    let releaseSecurityCommit!: () => void;
    let signalSecurityCommit!: () => void;
    const securityCommitStarted = new Promise<void>((resolve) => {
      signalSecurityCommit = resolve;
    });
    const securityCommitReleased = new Promise<void>((resolve) => {
      releaseSecurityCommit = resolve;
    });
    vi.spyOn(mock.sync, "set").mockImplementation(async (items) => {
      const security = (items as Record<string, unknown>)[STORAGE_KEYS.securitySettings] as
        | { encryption?: { enabled?: boolean } }
        | undefined;
      if (security?.encryption?.enabled === true) {
        signalSecurityCommit();
        await securityCommitReleased;
      }
      await originalSet(items);
    });

    const enabling = enableEncryption("correct horse battery staple");
    await securityCommitStarted;
    await expect(resetSyncedData()).rejects.toBeInstanceOf(SettingsChangedError);
    releaseSecurityCommit();
    await enabling;
    await expect(getSettings()).resolves.toMatchObject({ encryption: { enabled: true } });
  });

  it("survives replacement-note and security-settings delivery in either order", async () => {
    await saveNote({ text: "cross-key payload", baseEventRevision: null, now: Date.now() });
    const originalSet = mock.sync.set.bind(mock.sync);
    let transitionBatch: Record<string, unknown> | undefined;
    vi.spyOn(mock.sync, "set").mockImplementation(async (items) => {
      if (Object.hasOwn(items, STORAGE_KEYS.securitySettings)) {
        transitionBatch = structuredClone(items);
      }
      await originalSet(items);
    });
    await enableEncryption("correct horse battery staple");

    if (!transitionBatch) throw new Error("Expected a security transition batch");
    const noteEntry = Object.entries(transitionBatch).find(
      ([key, value]) =>
        key.startsWith(NOTE_KEY_PREFIX) &&
        typeof value === "object" &&
        value !== null &&
        "kind" in value &&
        value.kind === "encrypted",
    );
    if (!noteEntry) throw new Error("Expected an encrypted replacement note");
    const remainingEntries = Object.entries(transitionBatch).filter(
      ([key]) => key !== noteEntry[0],
    );

    // Receiver A sees the replacement before its security epoch. Cleanup must
    // start a local grace period instead of deleting the unfamiliar record.
    mock = installChromeMock();
    await mock.sync.set({ [noteEntry[0]]: noteEntry[1] });
    await cleanupStorage(Date.now());
    expect(mock.sync.snapshot()).toHaveProperty(noteEntry[0]);
    await mock.sync.set(Object.fromEntries(remainingEntries));
    await expect(loadReadableState()).resolves.toMatchObject({
      note: { revision: (noteEntry[1] as { revision: string }).revision },
      locked: true,
    });

    // Receiver B sees settings first. Until the target note arrives, mutation
    // is fenced so a partial transition cannot be overwritten or cleaned up.
    mock = installChromeMock();
    await mock.sync.set(Object.fromEntries(remainingEntries));
    await expect(saveNote({ text: "must wait", baseEventRevision: null })).rejects.toBeInstanceOf(
      SettingsChangedError,
    );
    await expect(loadRemoteState()).rejects.toBeInstanceOf(SettingsChangedError);
    await mock.sync.set({ [noteEntry[0]]: noteEntry[1] });
    await expect(loadReadableState()).resolves.toMatchObject({
      note: { revision: (noteEntry[1] as { revision: string }).revision },
      locked: true,
    });
  });

  it("ignores a late legacy state tombstone after entering a v2 security epoch", async () => {
    const now = Date.now();
    await saveNote({ text: "current protected value", baseEventRevision: null, now });
    await enableEncryption("correct horse battery staple");
    const current = await loadReadableState();
    const tombstoneId = crypto.randomUUID();
    const deletedAt = (current.eventAt ?? now) + 1;

    await mock.sync.set({
      [`${LEGACY_TOMBSTONE_KEY_PREFIX}${tombstoneId}`]: {
        schemaVersion: 1,
        id: tombstoneId,
        targetRevision: crypto.randomUUID(),
        deletedAt,
        keepUntil: deletedAt + TOMBSTONE_RETENTION_MS,
        scope: "state",
      },
    });

    await expect(loadReadableState(deletedAt)).resolves.toMatchObject({
      text: "current protected value",
      locked: false,
    });
  });

  it("requires the private key before creating content even when shared state is empty", async () => {
    const passphrase = "correct horse battery staple";
    await enableEncryption(passphrase);
    await lockSession();

    await expect(loadReadableState()).resolves.toMatchObject({
      text: null,
      note: null,
      locked: true,
    });
    await unlockSession(passphrase);
    const unlocked = await loadReadableState();
    expect(unlocked.locked).toBe(false);
    await expect(
      saveNote({ text: "first protected value", baseEventRevision: unlocked.eventRevision }),
    ).resolves.toMatchObject({ text: "first protected value", locked: false });
  });

  it("ignores and scrubs plaintext replayed after private mode is active", async () => {
    const now = Date.now();
    await updateRetention(null);
    await saveNote({ text: "private value", baseEventRevision: null, now });
    const oldPlainEntry = Object.entries(mock.sync.snapshot()).find(([key]) =>
      key.startsWith(NOTE_KEY_PREFIX),
    );
    await enableEncryption("correct horse battery staple");

    expect(oldPlainEntry).toBeDefined();
    if (oldPlainEntry) await mock.sync.set({ [oldPlainEntry[0]]: oldPlainEntry[1] });
    await expect(loadReadableState()).resolves.toMatchObject({ text: "private value" });

    const firstObservedAt = Date.now();
    await cleanupStorage(firstObservedAt);
    expect(JSON.stringify(mock.sync.snapshot())).toContain("private value");

    await cleanupStorage(firstObservedAt + ORPHAN_GRACE_PERIOD_MS + 1);
    expect(JSON.stringify(mock.sync.snapshot())).toContain("private value");
    await cleanupStorage(firstObservedAt + 2 * ORPHAN_GRACE_PERIOD_MS + 2);
    const notes = Object.values(mock.sync.snapshot()).filter(
      (value): value is { kind: string } =>
        typeof value === "object" && value !== null && "kind" in value,
    );
    expect(notes.every((note) => note.kind === "encrypted")).toBe(true);
    expect(
      Object.keys(mock.sync.snapshot()).some((key) =>
        key.startsWith(LEGACY_CLEAR_MARKER_KEY_PREFIX),
      ),
    ).toBe(true);
  });

  it("removes overwritten plaintext after the bounded conflict grace period", async () => {
    const now = Date.now();
    await updateRetention(null);
    const first = await saveNote({ text: "old plaintext", baseEventRevision: null, now });
    await saveNote({
      text: "current plaintext",
      baseEventRevision: first.eventRevision,
      now: now + 1,
    });

    await cleanupStorage(now + 2);
    expect(
      Object.keys(mock.sync.snapshot()).filter((key) => key.startsWith(NOTE_KEY_PREFIX)),
    ).toHaveLength(2);

    await cleanupStorage(now + ORPHAN_GRACE_PERIOD_MS + 3);
    expect(
      Object.keys(mock.sync.snapshot()).filter((key) => key.startsWith(NOTE_KEY_PREFIX)),
    ).toHaveLength(2);
    await cleanupStorage(now + 2 * ORPHAN_GRACE_PERIOD_MS + 4);
    const notes = Object.values(mock.sync.snapshot()).filter(
      (value): value is { content?: string } =>
        typeof value === "object" && value !== null && "kind" in value,
    );
    expect(notes).toHaveLength(1);
    expect(notes[0]?.content).toBe("current plaintext");
  });

  it("requires the current passphrase before returning to plaintext mode", async () => {
    const passphrase = "correct horse battery staple";
    await saveNote({ text: "round trip", baseEventRevision: null, now: Date.now() });
    await enableEncryption(passphrase);

    await expect(disableEncryption("this passphrase is wrong")).rejects.toBeInstanceOf(
      InvalidPassphraseError,
    );
    const settings = await disableEncryption(passphrase);
    expect(settings.encryption.enabled).toBe(false);
    await expect(loadReadableState()).resolves.toMatchObject({ text: "round trip", locked: false });
    expect(JSON.stringify(mock.sync.snapshot())).toContain("round trip");
  });

  it("migrates an unlocked private draft and purges the old key after a remote disable", async () => {
    await enableEncryption("correct horse battery staple");
    await saveDraft({
      schemaVersion: 1,
      text: "unsaved before remote disable",
      baseEventRevision: null,
      updatedAt: Date.now(),
    });
    expect(mock.session.snapshot()[STORAGE_KEYS.draft]).not.toHaveProperty("text");

    await mock.sync.set({
      [STORAGE_KEYS.securitySettings]: {
        schemaVersion: 2,
        revision: "remote-standard-epoch",
        encryption: { enabled: false },
        targetEventRevision: null,
        targetEventAt: null,
      },
    });
    await reconcileSessionSecurity();

    expect(mock.session.snapshot()[STORAGE_KEYS.draft]).toMatchObject({
      schemaVersion: 1,
      text: "unsaved before remote disable",
    });
    expect(mock.session.snapshot()).not.toHaveProperty(STORAGE_KEYS.sessionKey);
    await expect(getDraft()).resolves.toMatchObject({ text: "unsaved before remote disable" });
  });

  it("ignores malformed namespaced records without crashing valid content", async () => {
    await mock.sync.set({ [`${NOTE_KEY_PREFIX}bad`]: { kind: "html", content: "<script>" } });
    await saveNote({ text: "valid", baseEventRevision: null, now: 100 });
    const state = await loadReadableState(101);
    expect(state.text).toBe("valid");
    expect(state.invalidItemCount).toBe(1);
  });

  it("fails closed on malformed security settings and supports explicit recovery", async () => {
    await saveNote({ text: "will be reset", baseEventRevision: null, now: Date.now() });
    await mock.sync.set({
      [STORAGE_KEYS.securitySettings]: { schemaVersion: 2, encryption: { enabled: false } },
    });

    await expect(loadReadableState()).rejects.toThrow();
    await expect(resetSyncedData()).resolves.toMatchObject({
      retentionMinutes: 1_440,
      encryption: { enabled: false },
    });
    await expect(loadReadableState()).resolves.toMatchObject({ text: null, locked: false });
    const resetState = await loadRemoteState();
    await cleanupStorage(resetState.eventAt ?? Date.now());
    await cleanupStorage((resetState.eventAt ?? Date.now()) + ORPHAN_GRACE_PERIOD_MS + 1);
    await cleanupStorage((resetState.eventAt ?? Date.now()) + 2 * ORPHAN_GRACE_PERIOD_MS + 2);
    expect(
      Object.keys(mock.sync.snapshot()).filter((key) => key.startsWith(NOTE_KEY_PREFIX)),
    ).toHaveLength(0);
  });

  it("uses the documented default retention settings", async () => {
    await expect(getSettings()).resolves.toMatchObject({
      retentionMinutes: 1_440,
      encryption: { enabled: false },
    });
  });

  it("uses legacy/default settings as a read-only fallback without auto-writing fixed v2 keys", async () => {
    await expect(getSettings()).resolves.toMatchObject({ encryption: { enabled: false } });
    expect(mock.sync.snapshot()).not.toHaveProperty(STORAGE_KEYS.retentionSettings);
    expect(mock.sync.snapshot()).not.toHaveProperty(STORAGE_KEYS.securitySettings);
  });

  it("keeps ordinary Save and Clear from rewriting fixed security settings", async () => {
    const saved = await saveNote({ text: "ordinary mutation", baseEventRevision: null });
    expect(mock.sync.snapshot()).not.toHaveProperty(STORAGE_KEYS.retentionSettings);
    expect(mock.sync.snapshot()).not.toHaveProperty(STORAGE_KEYS.securitySettings);

    await clearCurrent(saved.eventRevision);
    expect(mock.sync.snapshot()).not.toHaveProperty(STORAGE_KEYS.retentionSettings);
    expect(mock.sync.snapshot()).not.toHaveProperty(STORAGE_KEYS.securitySettings);
  });

  it("cannot downgrade a newly-private epoch with a delayed standard Save", async () => {
    const originalSet = mock.sync.set.bind(mock.sync);
    let releaseNoteCommit!: () => void;
    let signalNoteCommit!: () => void;
    const noteCommitStarted = new Promise<void>((resolve) => {
      signalNoteCommit = resolve;
    });
    const noteCommitReleased = new Promise<void>((resolve) => {
      releaseNoteCommit = resolve;
    });
    let intercepted = false;
    vi.spyOn(mock.sync, "set").mockImplementation(async (items) => {
      const isOrdinaryNoteWrite =
        !intercepted &&
        !Object.hasOwn(items, STORAGE_KEYS.securitySettings) &&
        Object.keys(items).some((key) => key.startsWith(NOTE_KEY_PREFIX));
      if (isOrdinaryNoteWrite) {
        intercepted = true;
        signalNoteCommit();
        await noteCommitReleased;
      }
      await originalSet(items);
    });

    const delayedSave = saveNote({ text: "stale standard write", baseEventRevision: null });
    await noteCommitStarted;
    await enableEncryption("correct horse battery staple");
    releaseNoteCommit();
    await delayedSave;

    await expect(getSettings()).resolves.toMatchObject({ encryption: { enabled: true } });
    await expect(loadReadableState()).resolves.toMatchObject({ text: null, locked: false });
  });

  it("ignores a malformed legacy mirror when both split v2 settings are valid", async () => {
    await resetSyncedData();
    await mock.sync.set({
      [STORAGE_KEYS.settings]: { schemaVersion: 1, revision: "broken" },
    });

    const state = await loadRemoteState();
    await expect(getSettings()).resolves.toMatchObject({
      retentionMinutes: 1_440,
      encryption: { enabled: false },
    });
    await expect(
      saveNote({ text: "valid split state", baseEventRevision: state.eventRevision }),
    ).resolves.toMatchObject({ text: "valid split state" });
  });

  it("fails closed when a required split setting is missing and legacy fallback is malformed", async () => {
    await mock.sync.set({
      [STORAGE_KEYS.retentionSettings]: {
        schemaVersion: 2,
        revision: "valid-retention",
        retentionMinutes: 1_440,
      },
      [STORAGE_KEYS.settings]: { schemaVersion: 1, revision: "broken" },
    });

    await expect(getSettings()).rejects.toThrow();
  });

  it("blocks a save while an active security-transition intent exists", async () => {
    const now = Date.now();
    const id = crypto.randomUUID();
    await mock.sync.set({
      [`${TRANSITION_INTENT_KEY_PREFIX}${id}`]: {
        schemaVersion: 1,
        id,
        fromSecurityRevision: "legacy-standard-v1",
        startedAt: now,
        expiresAt: now + 10 * 60_000,
      },
    });

    await expect(
      saveNote({ text: "wait for transition", baseEventRevision: null }),
    ).rejects.toBeInstanceOf(SettingsChangedError);
  });

  it("never deletes a valid note from an unknown security epoch without retirement proof", async () => {
    const now = Date.now();
    const unknown = createPlainNote("future epoch", "another-device", null, now, "future-epoch");
    const key = noteStorageKey(unknown.revision);
    await mock.sync.set({ [key]: unknown });

    await cleanupStorage(now);
    await cleanupStorage(now + 30 * ORPHAN_GRACE_PERIOD_MS);

    expect(mock.sync.snapshot()).toHaveProperty(key);
  });

  it("quarantines future-skewed records instead of deleting them globally", async () => {
    const now = Date.now();
    const future = createPlainNote(
      "clock skew",
      "another-device",
      null,
      now + MAX_FUTURE_CLOCK_SKEW_MS + 10_000,
      "default",
    );
    const key = noteStorageKey(future.revision);
    await mock.sync.set({ [key]: future });

    await cleanupStorage(now);

    expect(mock.sync.snapshot()).toHaveProperty(key);
    await expect(loadRemoteState(now)).resolves.toMatchObject({
      note: null,
      invalidItemCount: 1,
    });
  });

  it("keeps a reserve for recovery/transition writes when Sync storage is nearly full", async () => {
    const filler = Object.fromEntries(
      Array.from({ length: 13 }, (_, index) => [`unrelated.${index}`, "x".repeat(7_000)]),
    );
    await mock.sync.set(filler);

    await expect(saveNote({ text: "small", baseEventRevision: null })).rejects.toBeInstanceOf(
      SyncQuotaError,
    );
  });

  it("user-confirmed reset compacts known invalid records and restores write capacity", async () => {
    const filler = Object.fromEntries(
      Array.from({ length: 13 }, (_, index) => [
        `${NOTE_KEY_PREFIX}invalid-filler-${index}`,
        "x".repeat(7_000),
      ]),
    );
    await mock.sync.set({ ...filler, "other.namespace": "preserve me" });

    await expect(saveNote({ text: "blocked", baseEventRevision: null })).rejects.toBeInstanceOf(
      SyncQuotaError,
    );
    await resetSyncedData();
    const resetState = await loadRemoteState();

    expect(mock.sync.snapshot()).toHaveProperty("other.namespace", "preserve me");
    expect(Object.keys(mock.sync.snapshot()).some((key) => key.includes("invalid-filler"))).toBe(
      false,
    );
    await expect(
      saveNote({ text: "capacity restored", baseEventRevision: resetState.eventRevision }),
    ).resolves.toMatchObject({ text: "capacity restored" });
  });

  it("resets a private epoch and remains idempotent across a second reset", async () => {
    await saveNote({ text: "private value to erase", baseEventRevision: null });
    await enableEncryption("correct horse battery staple");

    await resetSyncedData();
    await expect(loadReadableState()).resolves.toMatchObject({ text: null, locked: false });
    await expect(resetSyncedData()).resolves.toMatchObject({ encryption: { enabled: false } });
    await expect(loadReadableState()).resolves.toMatchObject({ text: null, locked: false });
  });

  it("recovers when a reset commit fails after destructive pre-compaction", async () => {
    await saveNote({ text: "interrupted reset", baseEventRevision: null });
    await enableEncryption("correct horse battery staple");
    const originalSet = mock.sync.set.bind(mock.sync);
    let failCriticalReset = true;
    const setSpy = vi.spyOn(mock.sync, "set").mockImplementation(async (items) => {
      const security = (items as Record<string, unknown>)[STORAGE_KEYS.securitySettings] as
        | { encryption?: { enabled?: boolean }; targetEventRevision?: string | null }
        | undefined;
      if (
        failCriticalReset &&
        security?.encryption?.enabled === false &&
        security.targetEventRevision !== null
      ) {
        failCriticalReset = false;
        throw new Error("simulated reset commit failure");
      }
      await originalSet(items);
    });

    await expect(resetSyncedData()).rejects.toThrow("simulated reset commit failure");
    setSpy.mockImplementation(originalSet);
    await expect(resetSyncedData()).resolves.toMatchObject({ encryption: { enabled: false } });
    await expect(loadReadableState()).resolves.toMatchObject({ text: null, locked: false });
  });

  it("orders reset after an in-flight target so replayed old settings stay empty", async () => {
    const oldRevision = "old-partially-delivered-epoch";
    const targetAt = Date.now() + 100;
    const delayedNote = createPlainNote(
      "must not return after reset",
      "delayed-device",
      null,
      targetAt,
      oldRevision,
    );
    const delayedSecurity = {
      schemaVersion: 2,
      revision: oldRevision,
      encryption: { enabled: false } as const,
      targetEventRevision: `note:${delayedNote.revision}`,
      targetEventAt: targetAt,
    };
    await mock.sync.set({ [STORAGE_KEYS.securitySettings]: delayedSecurity });
    await expect(loadRemoteState()).rejects.toBeInstanceOf(SettingsChangedError);

    await resetSyncedData();
    await mock.sync.set({
      [STORAGE_KEYS.securitySettings]: delayedSecurity,
      [noteStorageKey(delayedNote.revision)]: delayedNote,
    });

    await expect(loadReadableState(targetAt + 1_000)).resolves.toMatchObject({
      text: null,
      note: null,
    });
  });

  it("pre-compacts valid near-byte-quota history before committing reset barriers", async () => {
    const entries: Record<string, unknown> = {};
    let bytes = 0;
    for (let index = 0; index < 30; index += 1) {
      const note = createPlainNote(
        `${index}:`.padEnd(5_000, "x"),
        "reset-byte-fixture",
        null,
        Date.now() + index,
      );
      const key = noteStorageKey(note.revision);
      const itemBytes = storageItemByteLength(key, note);
      if (bytes + itemBytes > 101_700) break;
      entries[key] = note;
      bytes += itemBytes;
    }
    await mock.sync.set(entries);
    expect(bytes).toBeGreaterThan(102_400 - 4_096);

    await expect(resetSyncedData()).resolves.toMatchObject({ encryption: { enabled: false } });
    await expect(loadReadableState()).resolves.toMatchObject({ text: null });
  });

  it("pre-compacts valid hard-item-quota history before committing reset barriers", async () => {
    const notes = Object.fromEntries(
      Array.from({ length: 512 }, (_, index) => {
        const note = createPlainNote(
          `item-${index}`,
          "reset-item-fixture",
          null,
          Date.now() + index,
        );
        return [noteStorageKey(note.revision), note];
      }),
    );
    await mock.sync.set(notes);

    await expect(resetSyncedData()).resolves.toMatchObject({ encryption: { enabled: false } });
    expect(Object.keys(mock.sync.snapshot()).length).toBeLessThan(512);
    await expect(loadReadableState()).resolves.toMatchObject({ text: null });
  });

  it("uses the emergency reserve to tombstone and free near-quota note history", async () => {
    const now = Date.now();
    await updateRetention(null);
    let latestEventRevision: string | null = null;
    let quotaReached = false;

    for (let index = 0; index < 30; index += 1) {
      try {
        const saved = await saveNote({
          text: `${index}:`.padEnd(5_000, "x"),
          baseEventRevision: latestEventRevision,
          now: now + index,
        });
        latestEventRevision = saved.eventRevision;
      } catch (error) {
        expect(error).toBeInstanceOf(SyncQuotaError);
        quotaReached = true;
        break;
      }
    }
    expect(quotaReached).toBe(true);
    expect(latestEventRevision).not.toBeNull();

    const observedAt = now + 100;
    await cleanupStorage(observedAt);
    await cleanupStorage(observedAt + ORPHAN_GRACE_PERIOD_MS + 1);
    await cleanupStorage(observedAt + 2 * ORPHAN_GRACE_PERIOD_MS + 2);

    await expect(
      saveNote({
        text: "capacity recovered",
        baseEventRevision: latestEventRevision,
        now: now + 1_000,
      }),
    ).resolves.toMatchObject({ text: "capacity recovered" });
  });

  it("lets cleanup consume the final emergency reserve to make progress", async () => {
    const now = Date.now();
    const entries: Record<string, unknown> = {};
    let bytes = 0;
    for (let index = 0; index < 30; index += 1) {
      const note = createPlainNote(
        `${index}:`.padEnd(5_000, "x"),
        "quota-fixture",
        null,
        now + index,
      );
      const key = noteStorageKey(note.revision);
      const itemBytes = storageItemByteLength(key, note);
      if (bytes + itemBytes > 101_700) break;
      entries[key] = note;
      bytes += itemBytes;
    }
    await mock.sync.set(entries);
    expect(bytes).toBeGreaterThan(102_400 - 4_096);
    const noteCountBefore = Object.keys(entries).length;

    const observedAt = now + 100;
    await cleanupStorage(observedAt);
    await cleanupStorage(observedAt + ORPHAN_GRACE_PERIOD_MS + 1);
    expect(
      Object.keys(mock.sync.snapshot()).some((key) => key.startsWith(TOMBSTONE_KEY_PREFIX)),
    ).toBe(true);
    await cleanupStorage(observedAt + 2 * ORPHAN_GRACE_PERIOD_MS + 2);

    expect(
      Object.keys(mock.sync.snapshot()).filter((key) => key.startsWith(NOTE_KEY_PREFIX)).length,
    ).toBeLessThan(noteCountBefore);
  });

  it("reserves Sync item slots in addition to bytes", async () => {
    await mock.sync.set(
      Object.fromEntries(Array.from({ length: 449 }, (_, index) => [`tiny.${index}`, "x"])),
    );

    await expect(saveNote({ text: "small", baseEventRevision: null })).rejects.toBeInstanceOf(
      SyncQuotaError,
    );
  });
});
