import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleSelectionContextMenuClick,
  installSelectionContextMenu,
} from "../src/background/context-menu";
import {
  CONTEXT_MENU_ID,
  CONTEXT_MENU_RESULT_KEY_PREFIX,
  MAX_TEXT_BYTES,
  NOTE_KEY_PREFIX,
  STORAGE_KEYS,
} from "../src/shared/constants";
import { readContextMenuResult } from "../src/shared/context-menu-result";
import {
  enableEncryption,
  loadReadableState,
  lockSession,
  saveDraft,
  saveNote,
} from "../src/shared/extension-api";
import { createPlainNote, noteStorageKey } from "../src/shared/note-domain";
import { installChromeMock, type ChromeMock } from "./chrome-mock";

function clickInfo(
  selectionText: string | undefined,
  menuItemId: string = CONTEXT_MENU_ID,
): Pick<chrome.contextMenus.OnClickData, "menuItemId" | "selectionText"> {
  return { menuItemId, selectionText };
}

function noteEntries(mock: ChromeMock): Array<[string, unknown]> {
  return Object.entries(mock.sync.snapshot()).filter(([key]) => key.startsWith(NOTE_KEY_PREFIX));
}

describe("selection context menu", () => {
  let mock: ChromeMock;

  beforeEach(() => {
    mock = installChromeMock();
  });

  it("installs one localized menu that appears only for selected text", async () => {
    await installSelectionContextMenu();
    await installSelectionContextMenu();

    expect(mock.createdContextMenus).toEqual([
      {
        id: CONTEXT_MENU_ID,
        title: "Thêm vào Textpipe",
        contexts: ["selection"],
      },
    ]);
  });

  it("ignores another menu id and missing or empty selections", async () => {
    await expect(handleSelectionContextMenuClick(clickInfo("text", "another-menu"))).resolves.toBe(
      "ignored",
    );
    await expect(handleSelectionContextMenuClick(clickInfo(undefined))).resolves.toBe("ignored");
    await expect(handleSelectionContextMenuClick(clickInfo(""))).resolves.toBe("ignored");

    expect(noteEntries(mock)).toHaveLength(0);
    expect(chrome.action.openPopup).not.toHaveBeenCalled();
  });

  it("preserves selected text byte-for-byte and suppresses a self-unread badge", async () => {
    const selection = "  Tiếng Việt 😀\n\t<script>alert(1)</script>\u200f  ";

    await expect(handleSelectionContextMenuClick(clickInfo(selection))).resolves.toBe("saved");

    await expect(loadReadableState()).resolves.toMatchObject({ text: selection, locked: false });
    await expect(readContextMenuResult()).resolves.toMatchObject({
      result: { status: "saved" },
    });
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: "" });
    expect(chrome.action.openPopup).toHaveBeenCalledOnce();
  });

  it("accepts exactly 5,000 UTF-8 bytes without truncation", async () => {
    const selection = "a".repeat(MAX_TEXT_BYTES);

    await expect(handleSelectionContextMenuClick(clickInfo(selection))).resolves.toBe("saved");
    await expect(loadReadableState()).resolves.toMatchObject({ text: selection });
  });

  it("rejects 5,001 UTF-8 bytes and preserves an existing recovery draft", async () => {
    await saveDraft({
      schemaVersion: 1,
      text: "draft that must survive",
      baseEventRevision: null,
      updatedAt: Date.now(),
    });
    const selection = "a".repeat(MAX_TEXT_BYTES + 1);

    await expect(handleSelectionContextMenuClick(clickInfo(selection))).resolves.toBe("error");

    expect(noteEntries(mock)).toHaveLength(0);
    expect(mock.session.snapshot()[STORAGE_KEYS.draft]).toMatchObject({
      text: "draft that must survive",
    });
    expect(JSON.stringify(mock.session.snapshot())).not.toContain(selection);
    await expect(readContextMenuResult()).resolves.toMatchObject({
      result: { status: "error", errorCode: "NOTE_TOO_LARGE" },
    });
  });

  it("replaces an older note and removes a stale draft only after canonical success", async () => {
    await saveNote({ text: "old shared value", baseEventRevision: null, now: Date.now() });
    await saveDraft({
      schemaVersion: 1,
      text: "old local draft",
      baseEventRevision: null,
      updatedAt: Date.now(),
    });

    await expect(handleSelectionContextMenuClick(clickInfo("new selected value"))).resolves.toBe(
      "saved",
    );

    await expect(loadReadableState()).resolves.toMatchObject({ text: "new selected value" });
    expect(mock.session.snapshot()).not.toHaveProperty(STORAGE_KEYS.draft);
    expect(noteEntries(mock)).toHaveLength(2);
  });

  it("does not claim Saved when a later concurrent write becomes canonical", async () => {
    await saveDraft({
      schemaVersion: 1,
      text: "recoverable old draft",
      baseEventRevision: null,
      updatedAt: Date.now(),
    });
    const originalSet = mock.sync.set.bind(mock.sync);
    let insertedRemote = false;
    vi.spyOn(mock.sync, "set").mockImplementation(async (items) => {
      await originalSet(items);
      const wroteSelection = Object.values(items).some(
        (value) =>
          typeof value === "object" &&
          value !== null &&
          "content" in value &&
          value.content === "selection that loses",
      );
      if (!wroteSelection || insertedRemote) return;
      insertedRemote = true;
      const remote = createPlainNote("remote winner", "another-device", null, Date.now() + 60_000);
      await originalSet({ [noteStorageKey(remote.revision)]: remote });
    });

    await expect(handleSelectionContextMenuClick(clickInfo("selection that loses"))).resolves.toBe(
      "error",
    );

    await expect(loadReadableState()).resolves.toMatchObject({ text: "remote winner" });
    expect(mock.session.snapshot()[STORAGE_KEYS.draft]).toMatchObject({
      text: "recoverable old draft",
    });
    await expect(readContextMenuResult()).resolves.toMatchObject({
      result: { status: "error", errorCode: "SYNC_CONFLICT" },
    });
  });

  it("encrypts the selection in unlocked Private mode", async () => {
    const selection = "private selection that must never appear as plaintext";
    await enableEncryption("correct horse battery staple");

    await expect(handleSelectionContextMenuClick(clickInfo(selection))).resolves.toBe("saved");

    await expect(loadReadableState()).resolves.toMatchObject({ text: selection, locked: false });
    const synced = JSON.stringify(mock.sync.snapshot());
    expect(synced).not.toContain(selection);
    expect(
      noteEntries(mock).some(([, value]) => JSON.stringify(value).includes("ciphertext")),
    ).toBe(true);
    const sessionWithoutKey = Object.fromEntries(
      Object.entries(mock.session.snapshot()).filter(([key]) => key !== STORAGE_KEYS.sessionKey),
    );
    expect(JSON.stringify(sessionWithoutKey)).not.toContain(selection);
  });

  it("fails closed while Private mode is locked", async () => {
    const selection = "never persist this locked selection";
    await enableEncryption("correct horse battery staple");
    await lockSession();
    const syncBefore = mock.sync.snapshot();

    await expect(handleSelectionContextMenuClick(clickInfo(selection))).resolves.toBe("error");

    expect(mock.sync.snapshot()).toEqual(syncBefore);
    expect(JSON.stringify(mock.sync.snapshot())).not.toContain(selection);
    expect(JSON.stringify(mock.session.snapshot())).not.toContain(selection);
    expect(JSON.stringify(mock.local.snapshot())).not.toContain(selection);
    await expect(readContextMenuResult()).resolves.toMatchObject({
      result: { status: "error", errorCode: "LOCKED" },
    });
  });

  it("stores no page or tab metadata in the result", async () => {
    const pageUrl = "https://private.example/secret-path";
    await handleSelectionContextMenuClick({
      ...clickInfo("safe selection"),
      pageUrl,
    } as chrome.contextMenus.OnClickData);

    expect(JSON.stringify(mock.sync.snapshot())).not.toContain(pageUrl);
    expect(JSON.stringify(mock.local.snapshot())).not.toContain(pageUrl);
    expect(JSON.stringify(mock.session.snapshot())).not.toContain(pageUrl);
    expect(
      Object.keys(mock.session.snapshot()).some((key) =>
        key.startsWith(CONTEXT_MENU_RESULT_KEY_PREFIX),
      ),
    ).toBe(true);
  });
});
