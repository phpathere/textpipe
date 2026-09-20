import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isReadCursorChange,
  markStateRead,
  reconcileActionBadge,
} from "../src/shared/action-badge";
import {
  READ_CURSOR_KEY_PREFIX,
  RECONCILE_BADGE_MESSAGE,
  STORAGE_KEYS,
} from "../src/shared/constants";
import { loadRemoteState } from "../src/shared/extension-api";
import { createPlainNote, noteStorageKey } from "../src/shared/note-domain";
import { installChromeMock, type ChromeMock } from "./chrome-mock";

describe("toolbar unread badge", () => {
  let mock: ChromeMock;

  beforeEach(async () => {
    mock = installChromeMock();
    await mock.local.set({ [STORAGE_KEYS.deviceId]: "this-device" });
  });

  async function addNote(content: string, sourceId: string, createdAt: number) {
    const note = createPlainNote(content, sourceId, null, createdAt);
    await mock.sync.set({ [noteStorageKey(note.revision)]: note });
    return note;
  }

  function readCursorEntries(): Array<[string, unknown]> {
    return Object.entries(mock.local.snapshot()).filter(([key]) =>
      key.startsWith(READ_CURSOR_KEY_PREFIX),
    );
  }

  it("shows a numeric badge only for the canonical note from another device", async () => {
    await addNote("incoming", "another-device", 100);

    await reconcileActionBadge();

    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: "1" });
    expect(chrome.action.setBadgeBackgroundColor).toHaveBeenLastCalledWith({ color: "#0B57D0" });
    expect(chrome.action.setBadgeTextColor).toHaveBeenLastCalledWith({ color: "#FFFFFF" });
    expect(chrome.action.setTitle).toHaveBeenLastCalledWith({
      title: "Textpipe · Có nội dung mới",
    });
  });

  it("suppresses self-notifications and advances the local read cursor", async () => {
    const note = await addNote("sent here", "this-device", 100);

    await reconcileActionBadge();

    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: "" });
    expect(readCursorEntries()).toHaveLength(1);
    expect(readCursorEntries()[0]?.[1]).toMatchObject({
      eventRevision: `note:${note.revision}`,
      eventAt: note.createdAt,
    });
  });

  it("keeps a read revision quiet after reconciliation and flags the next revision", async () => {
    await addNote("first incoming", "another-device", 100);
    await reconcileActionBadge();
    await markStateRead(await loadRemoteState(101));
    await reconcileActionBadge();
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: "" });

    vi.mocked(chrome.action.setBadgeText).mockClear();
    await reconcileActionBadge();
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: "" });

    await addNote("second incoming", "another-device", 102);
    await reconcileActionBadge();
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: "1" });
  });

  it("does not let a stale remote record override a newer local state", async () => {
    await addNote("old incoming", "another-device", 100);
    const local = await addNote("newer local", "this-device", 200);
    await reconcileActionBadge();
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: "" });

    await addNote("late stale replica", "another-device", 150);
    await reconcileActionBadge();

    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: "" });
    expect(readCursorEntries()).toHaveLength(1);
    expect(readCursorEntries()[0]?.[1]).toMatchObject({
      eventRevision: `note:${local.revision}`,
      eventAt: local.createdAt,
    });
  });

  it("does not clear a newer badge when the popup acknowledges an older snapshot", async () => {
    await addNote("first incoming", "another-device", 100);
    const olderSnapshot = await loadRemoteState(101);
    await addNote("arrived during popup load", "another-device", 102);

    await markStateRead(olderSnapshot);
    await reconcileActionBadge();

    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: "1" });
  });

  it("delegates toolbar writes to the service-worker queue", async () => {
    await addNote("incoming", "another-device", 100);
    const snapshot = await loadRemoteState(101);
    vi.mocked(chrome.action.setBadgeText).mockClear();

    await markStateRead(snapshot);

    expect(chrome.action.setBadgeText).not.toHaveBeenCalled();
    expect(chrome.runtime.sendMessage).toHaveBeenLastCalledWith({
      type: RECONCILE_BADGE_MESSAGE,
    });
  });

  it("cannot regress the read watermark when an older acknowledgement finishes last", async () => {
    await addNote("older incoming", "another-device", 100);
    const olderSnapshot = await loadRemoteState(101);
    await addNote("newer incoming", "another-device", 102);
    const newerSnapshot = await loadRemoteState(103);

    const originalSet = mock.local.set.bind(mock.local);
    let releaseOlderSet!: () => void;
    let signalOlderSetStarted!: () => void;
    const olderSetStarted = new Promise<void>((resolve) => {
      signalOlderSetStarted = resolve;
    });
    const olderSetReleased = new Promise<void>((resolve) => {
      releaseOlderSet = resolve;
    });
    vi.spyOn(mock.local, "set").mockImplementation(async (items) => {
      const cursor = Object.values(items).find(
        (value) =>
          typeof value === "object" &&
          value !== null &&
          "eventRevision" in value &&
          value.eventRevision === olderSnapshot.eventRevision,
      );
      if (cursor) {
        signalOlderSetStarted();
        await olderSetReleased;
      }
      await originalSet(items);
    });

    const olderAcknowledgement = markStateRead(olderSnapshot);
    await olderSetStarted;
    await markStateRead(newerSnapshot);
    releaseOlderSet();
    await olderAcknowledgement;
    await reconcileActionBadge();

    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: "" });
    expect(readCursorEntries()).toHaveLength(1);
    expect(readCursorEntries()[0]?.[1]).toMatchObject({
      eventRevision: newerSnapshot.eventRevision,
      eventAt: newerSnapshot.eventAt,
    });
  });

  it("filters local storage events to read cursor records", () => {
    expect(
      isReadCursorChange({ [`${READ_CURSOR_KEY_PREFIX}note:revision`]: { newValue: {} } }),
    ).toBe(true);
    expect(isReadCursorChange({ [STORAGE_KEYS.deviceId]: { newValue: "device" } })).toBe(false);
  });
});
