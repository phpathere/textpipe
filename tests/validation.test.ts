import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  MAX_FUTURE_CLOCK_SKEW_MS,
  MAX_TEXT_BYTES,
} from "../src/shared/constants";
import { StorageDataError } from "../src/shared/errors";
import { createClearMarker, createPlainNote, createTombstone } from "../src/shared/note-domain";
import {
  parseClearMarker,
  parseDraft,
  parseNote,
  parseRetentionSettings,
  parseRetiredSecurityEpoch,
  parseSecuritySettings,
  parseSecurityTransitionIntent,
  parseSettings,
  parseTombstone,
} from "../src/shared/validation";

describe("runtime validation", () => {
  it("returns defaults only when settings are absent", () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(() => parseSettings({ schemaVersion: 999 })).toThrow(StorageDataError);
  });

  it("validates split retention and security records", () => {
    expect(
      parseRetentionSettings({
        schemaVersion: 2,
        revision: "retention-revision",
        retentionMinutes: 1_440,
      }),
    ).toMatchObject({ retentionMinutes: 1_440 });
    expect(
      parseSecuritySettings({
        schemaVersion: 2,
        revision: "security-revision",
        encryption: { enabled: false },
        targetEventRevision: "clear:transition-id",
        targetEventAt: 100,
      }),
    ).toMatchObject({ encryption: { enabled: false } });
    expect(() =>
      parseRetentionSettings({
        schemaVersion: 2,
        revision: "bad-retention",
        retentionMinutes: 30,
      }),
    ).toThrow(StorageDataError);
    expect(() =>
      parseSecuritySettings({
        schemaVersion: 2,
        revision: "bad-security",
        encryption: { enabled: false },
        targetEventRevision: "note:missing-time",
        targetEventAt: null,
      }),
    ).toThrow(StorageDataError);
  });

  it("accepts plain text as inert text and validates the key revision", () => {
    const note = createPlainNote('<img src=x onerror="alert(1)">', "device", 60, 1);
    expect(parseNote(note, note.revision)).toEqual(note);
    expect(() => parseNote(note, "different-id")).toThrow(StorageDataError);
    expect(() => parseNote({ ...note, securityRevision: undefined })).toThrow(StorageDataError);

    const { securityRevision: _securityRevision, ...legacy } = note;
    expect(parseNote({ ...legacy, schemaVersion: 1 }, note.revision, 1, 1)).toMatchObject({
      schemaVersion: 1,
      securityRevision: null,
    });
  });

  it("rejects oversized, NaN, and malformed note records", () => {
    const note = createPlainNote("ok", "device", 60, 1);
    expect(() => parseNote({ ...note, content: "x".repeat(MAX_TEXT_BYTES + 1) })).toThrow(
      StorageDataError,
    );
    expect(() => parseNote({ ...note, createdAt: Number.NaN })).toThrow(StorageDataError);
    expect(() => parseNote({ ...note, createdAt: 1.5, updatedAt: 1.5 })).toThrow(StorageDataError);
    expect(() =>
      parseNote(
        {
          ...note,
          createdAt: Date.now() + MAX_FUTURE_CLOCK_SKEW_MS + 1,
          updatedAt: Date.now() + MAX_FUTURE_CLOCK_SKEW_MS + 1,
        },
        undefined,
        Date.now(),
      ),
    ).toThrow(StorageDataError);
    expect(() => parseNote({ ...note, kind: "html" })).toThrow(StorageDataError);
  });

  it("rejects malformed encrypted fields", () => {
    const note = createPlainNote("ok", "device", 60, 1);
    const { content: _content, ...metadata } = note;
    expect(() =>
      parseNote({
        ...metadata,
        kind: "encrypted",
        keyId: "key",
        iv: "not base64",
        ciphertext: "AAAA",
      }),
    ).toThrow(StorageDataError);
  });

  it("validates tombstones and safely ignores invalid drafts", () => {
    const tombstone = createTombstone("target", 10, 10);
    expect(parseTombstone(tombstone, tombstone.id)).toEqual(tombstone);
    expect(() => parseTombstone({ ...tombstone, keepUntil: 0 })).toThrow(StorageDataError);
    expect(parseDraft({ schemaVersion: 1, text: "x", updatedAt: 1 })).toBeNull();
    expect(
      parseDraft({
        schemaVersion: 2,
        keyId: "draft-key",
        iv: "AAAAAAAAAAAAAAAA",
        ciphertext: "AAAA",
        baseEventRevision: null,
        updatedAt: 1,
      }),
    ).toMatchObject({ schemaVersion: 2, keyId: "draft-key" });
  });

  it("validates immutable clear markers and their storage-key identity", () => {
    const marker = createClearMarker(10);
    expect(parseClearMarker(marker, marker.id, 10)).toEqual(marker);
    expect(() => parseClearMarker(marker, "another-id", 10)).toThrow(StorageDataError);
  });

  it("validates transition intents and immutable epoch-retirement proofs", () => {
    const now = Date.now();
    expect(
      parseSecurityTransitionIntent(
        {
          schemaVersion: 1,
          id: "intent-id",
          fromSecurityRevision: "old-epoch",
          startedAt: now,
          expiresAt: now + 10 * 60_000,
        },
        "intent-id",
        now,
      ),
    ).toMatchObject({ fromSecurityRevision: "old-epoch" });
    expect(
      parseRetiredSecurityEpoch(
        {
          schemaVersion: 1,
          id: "retirement-id",
          retiredRevision: "old-epoch",
          successorRevision: "new-epoch",
          retireLegacyRecords: true,
          retiredAt: now,
        },
        "retirement-id",
        now,
      ),
    ).toMatchObject({ successorRevision: "new-epoch" });
  });
});
