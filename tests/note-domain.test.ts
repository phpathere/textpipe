import { describe, expect, it } from "vitest";
import { CHROME_SYNC_ITEM_LIMIT_BYTES, MAX_TEXT_BYTES } from "../src/shared/constants";
import { NoteTooLargeError } from "../src/shared/errors";
import {
  assertStorageItemWithinLimit,
  assertTextWithinLimit,
  calculateExpiresAt,
  compareEventOrder,
  createPlainNote,
  isExpired,
  noteStorageKey,
} from "../src/shared/note-domain";

describe("note domain", () => {
  it("enforces the exact text byte boundary", () => {
    expect(() => assertTextWithinLimit("a".repeat(MAX_TEXT_BYTES))).not.toThrow();
    expect(() => assertTextWithinLimit("a".repeat(MAX_TEXT_BYTES + 1))).toThrow(NoteTooLargeError);
    expect(() => assertTextWithinLimit("😀".repeat(MAX_TEXT_BYTES / 4))).not.toThrow();
    expect(() => assertTextWithinLimit(`😀${"a".repeat(MAX_TEXT_BYTES - 3)}`)).toThrow(
      NoteTooLargeError,
    );
  });

  it("calculates retention and expiration at the inclusive boundary", () => {
    const now = 1_000_000;
    expect(calculateExpiresAt(now, 60)).toBe(now + 3_600_000);
    expect(calculateExpiresAt(now, null)).toBeNull();
    const note = createPlainNote("hello", "device", 60, now);
    expect(isExpired(note, note.expiresAt ?? 0)).toBe(true);
    expect(isExpired(note, (note.expiresAt ?? 0) - 1)).toBe(false);
  });

  it("preflights the serialized Chrome item quota", () => {
    const key = "item";
    expect(() =>
      assertStorageItemWithinLimit(key, "x".repeat(CHROME_SYNC_ITEM_LIMIT_BYTES)),
    ).toThrow(NoteTooLargeError);
    expect(() => assertStorageItemWithinLimit(key, "small")).not.toThrow();
  });

  it("uses stable timestamp then revision ordering", () => {
    expect(
      compareEventOrder(
        { eventAt: 1, eventRevision: "note:b" },
        { eventAt: 1, eventRevision: "note:a" },
      ),
    ).toBeGreaterThan(0);
    expect(
      compareEventOrder(
        { eventAt: 1, eventRevision: "note:z" },
        { eventAt: 2, eventRevision: "note:a" },
      ),
    ).toBeLessThan(0);
  });

  it("creates immutable namespaced records", () => {
    const note = createPlainNote("<script>alert(1)</script>", "device", 1_440, 123);
    expect(note.content).toBe("<script>alert(1)</script>");
    expect(noteStorageKey(note.revision)).toMatch(/^textpipe\.note\.v2\./);
  });
});
