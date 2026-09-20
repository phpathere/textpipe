import { beforeAll, describe, expect, it } from "vitest";
import {
  createEncryptionSettings,
  decryptNote,
  encryptNote,
  unlockEncryption,
  validatePassphrase,
} from "../src/shared/crypto";
import {
  InvalidPassphraseError,
  PassphrasePolicyError,
  StorageDataError,
} from "../src/shared/errors";
import { createPlainNote } from "../src/shared/note-domain";
import type { EncryptionEnabled } from "../src/shared/types";

describe("private lock cryptography", () => {
  let settings: EncryptionEnabled;
  let rawKey: Uint8Array;

  beforeAll(async () => {
    const created = await createEncryptionSettings("correct horse battery staple");
    settings = created.settings;
    rawKey = created.rawKey;
  });

  it("enforces a minimum passphrase policy", () => {
    expect(() => validatePassphrase("short")).toThrow(PassphrasePolicyError);
    expect(() => validatePassphrase("đây là passphrase đủ dài")).not.toThrow();
  });

  it("verifies the correct passphrase and rejects a wrong one", async () => {
    await expect(unlockEncryption(settings, "correct horse battery staple")).resolves.toEqual(
      rawKey,
    );
    await expect(unlockEncryption(settings, "this is definitely wrong")).rejects.toBeInstanceOf(
      InvalidPassphraseError,
    );
  });

  it("encrypts and decrypts Unicode and hostile-looking plain text", async () => {
    const note = createPlainNote("Tiếng Việt 😀 <script>alert(1)</script>", "device", 60, 10);
    const encrypted = await encryptNote(note, settings.keyId, rawKey);
    expect(encrypted).not.toHaveProperty("content");
    expect(encrypted.ciphertext).not.toContain("script");
    await expect(decryptNote(encrypted, rawKey)).resolves.toBe(note.content);
  });

  it("uses unique nonces and authenticates ciphertext plus metadata", async () => {
    const note = createPlainNote("same text", "device", 60, 10);
    const first = await encryptNote(note, settings.keyId, rawKey);
    const second = await encryptNote(note, settings.keyId, rawKey);
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);

    const changedCiphertext = `${first.ciphertext.slice(0, -4)}AAAA`;
    await expect(
      decryptNote({ ...first, ciphertext: changedCiphertext }, rawKey),
    ).rejects.toBeInstanceOf(StorageDataError);
    await expect(
      decryptNote({ ...first, expiresAt: (first.expiresAt ?? 0) + 1 }, rawKey),
    ).rejects.toBeInstanceOf(StorageDataError);
    await expect(
      decryptNote({ ...first, securityRevision: "another-security-epoch" }, rawKey),
    ).rejects.toBeInstanceOf(StorageDataError);
  });
});
