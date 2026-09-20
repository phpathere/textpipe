import { MAX_SESSION_DRAFT_BYTES, PBKDF2_ITERATIONS } from "./constants";
import { base64ToBytes, bytesToBase64, decodeUtf8, textEncoder, utf8ByteLength } from "./encoding";
import { InvalidPassphraseError, PassphrasePolicyError, StorageDataError } from "./errors";
import type {
  EncryptedNoteRecord,
  EncryptedStoredDraft,
  EncryptionEnabled,
  NoteMetadata,
  PlainNoteRecord,
  StoredDraft,
} from "./types";

const VERIFIER_TEXT = "textpipe-key-check-v1";
const VERIFIER_AAD_PREFIX = "textpipe-verifier-v1:";

export function normalizePassphrase(passphrase: string): string {
  return passphrase.normalize("NFC");
}

export function validatePassphrase(passphrase: string): void {
  const normalized = normalizePassphrase(passphrase);
  const characterCount = [...normalized].length;
  if (characterCount < 12) {
    throw new PassphrasePolicyError("Passphrase cần ít nhất 12 ký tự.");
  }
  if (characterCount > 128) {
    throw new PassphrasePolicyError("Passphrase không được dài quá 128 ký tự.");
  }
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}

function ownedBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const owned = new Uint8Array(bytes.byteLength);
  owned.set(bytes);
  return owned;
}

async function deriveRawKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(normalizePassphrase(passphrase)),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: ownedBytes(salt), iterations },
    keyMaterial,
    256,
  );
  return new Uint8Array(bits);
}

async function importAesKey(rawKey: Uint8Array): Promise<CryptoKey> {
  if (rawKey.byteLength !== 32) throw new StorageDataError("Khoá phiên không hợp lệ.");
  return crypto.subtle.importKey("raw", ownedBytes(rawKey), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

async function encryptString(
  rawKey: Uint8Array,
  plaintext: string,
  additionalData: string,
): Promise<{ iv: string; ciphertext: string }> {
  const iv = randomBytes(12);
  const key = await importAesKey(rawKey);
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: ownedBytes(iv),
      additionalData: textEncoder.encode(additionalData),
      tagLength: 128,
    },
    key,
    textEncoder.encode(plaintext),
  );
  return { iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(encrypted)) };
}

async function decryptString(
  rawKey: Uint8Array,
  iv: string,
  ciphertext: string,
  additionalData: string,
): Promise<string> {
  const key = await importAesKey(rawKey);
  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: ownedBytes(base64ToBytes(iv)),
      additionalData: textEncoder.encode(additionalData),
      tagLength: 128,
    },
    key,
    ownedBytes(base64ToBytes(ciphertext)),
  );
  return decodeUtf8(decrypted);
}

function noteAdditionalData(note: NoteMetadata, keyId: string): string {
  if (note.schemaVersion === 1) {
    return JSON.stringify([
      "textpipe-note-v1",
      keyId,
      note.schemaVersion,
      note.revision,
      note.createdAt,
      note.updatedAt,
      note.expiresAt,
      note.sourceId,
    ]);
  }
  return JSON.stringify([
    "textpipe-note-v2",
    keyId,
    note.schemaVersion,
    note.securityRevision,
    note.revision,
    note.createdAt,
    note.updatedAt,
    note.expiresAt,
    note.sourceId,
  ]);
}

export async function createEncryptionSettings(
  passphrase: string,
): Promise<{ settings: EncryptionEnabled; rawKey: Uint8Array }> {
  validatePassphrase(passphrase);
  const keyId = crypto.randomUUID();
  const salt = randomBytes(16);
  const rawKey = await deriveRawKey(passphrase, salt, PBKDF2_ITERATIONS);
  const verifier = await encryptString(rawKey, VERIFIER_TEXT, `${VERIFIER_AAD_PREFIX}${keyId}`);

  return {
    settings: {
      enabled: true,
      keyId,
      algorithm: "AES-GCM-256",
      kdf: "PBKDF2-SHA-256",
      iterations: PBKDF2_ITERATIONS,
      salt: bytesToBase64(salt),
      verifierIv: verifier.iv,
      verifierCiphertext: verifier.ciphertext,
    },
    rawKey,
  };
}

export async function unlockEncryption(
  settings: EncryptionEnabled,
  passphrase: string,
): Promise<Uint8Array> {
  try {
    const rawKey = await deriveRawKey(
      passphrase,
      base64ToBytes(settings.salt),
      settings.iterations,
    );
    const verifier = await decryptString(
      rawKey,
      settings.verifierIv,
      settings.verifierCiphertext,
      `${VERIFIER_AAD_PREFIX}${settings.keyId}`,
    );
    if (verifier !== VERIFIER_TEXT) throw new InvalidPassphraseError();
    return rawKey;
  } catch (error) {
    if (error instanceof InvalidPassphraseError) throw error;
    throw new InvalidPassphraseError();
  }
}

export async function encryptNote(
  note: PlainNoteRecord,
  keyId: string,
  rawKey: Uint8Array,
): Promise<EncryptedNoteRecord> {
  const encrypted = await encryptString(rawKey, note.content, noteAdditionalData(note, keyId));
  const { content: _content, ...metadata } = note;
  return {
    ...metadata,
    kind: "encrypted",
    keyId,
    iv: encrypted.iv,
    ciphertext: encrypted.ciphertext,
  };
}

export async function decryptNote(note: EncryptedNoteRecord, rawKey: Uint8Array): Promise<string> {
  try {
    return await decryptString(
      rawKey,
      note.iv,
      note.ciphertext,
      noteAdditionalData(note, note.keyId),
    );
  } catch {
    throw new StorageDataError("Không thể xác thực hoặc giải mã nội dung.");
  }
}

function draftAdditionalData(draft: {
  keyId: string;
  baseEventRevision: string | null;
  updatedAt: number;
}): string {
  return JSON.stringify([
    "textpipe-draft-v2",
    draft.keyId,
    draft.baseEventRevision,
    draft.updatedAt,
  ]);
}

export async function encryptDraft(
  draft: StoredDraft,
  keyId: string,
  rawKey: Uint8Array,
): Promise<EncryptedStoredDraft> {
  const metadata = {
    keyId,
    baseEventRevision: draft.baseEventRevision,
    updatedAt: draft.updatedAt,
  };
  const encrypted = await encryptString(rawKey, draft.text, draftAdditionalData(metadata));
  return {
    schemaVersion: 2,
    ...metadata,
    iv: encrypted.iv,
    ciphertext: encrypted.ciphertext,
  };
}

export async function decryptDraft(
  draft: EncryptedStoredDraft,
  rawKey: Uint8Array,
): Promise<StoredDraft> {
  try {
    const text = await decryptString(
      rawKey,
      draft.iv,
      draft.ciphertext,
      draftAdditionalData(draft),
    );
    if (utf8ByteLength(text) > MAX_SESSION_DRAFT_BYTES) throw new StorageDataError();
    return {
      schemaVersion: 1,
      text,
      baseEventRevision: draft.baseEventRevision,
      updatedAt: draft.updatedAt,
    };
  } catch {
    throw new StorageDataError("Không thể xác thực hoặc giải mã bản nháp.");
  }
}
