import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONTEXT_MENU_RESULT_KEY_PREFIX,
  MAX_TEXT_BYTES,
  NOTE_KEY_PREFIX,
  READ_CURSOR_KEY_PREFIX,
  STORAGE_KEYS,
} from "../src/shared/constants";
import { storeContextMenuResult } from "../src/shared/context-menu-result";
import {
  enableEncryption,
  getDraft,
  loadReadableState,
  lockSession,
  saveDraft,
  saveNote,
} from "../src/shared/extension-api";
import { createPlainNote, noteStorageKey } from "../src/shared/note-domain";
import { App } from "../src/popup/App";
import { handleSelectionContextMenuClick } from "../src/background/context-menu";
import { installChromeMock, type ChromeMock } from "./chrome-mock";

describe("popup", () => {
  let mock: ChromeMock;

  beforeEach(() => {
    mock = installChromeMock();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("renders hostile-looking input as inert text and saves only on explicit action", async () => {
    const user = userEvent.setup();
    render(<App />);
    const editor = await screen.findByLabelText("Nội dung");
    const payload = '<img src=x onerror="alert(1)"><script>alert(2)</script>';

    fireEvent.input(editor, { target: { value: payload } });
    expect(screen.getByText("Bản nháp chưa lưu")).not.toBeNull();
    expect(document.querySelector("script:not([type=module])")).toBeNull();
    const images = document.querySelectorAll("img");
    expect(images).toHaveLength(1);
    expect(images[0]?.getAttribute("src")).toBe("icons/icon-128.png");
    expect((editor as HTMLTextAreaElement).value).toBe(payload);
    expect(
      Object.keys(mock.sync.snapshot()).filter((key) => key.startsWith(NOTE_KEY_PREFIX)),
    ).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Lưu để đồng bộ" }));
    await screen.findByText("Đã lưu trên máy này để Chrome đồng bộ");
    const notes = Object.entries(mock.sync.snapshot()).filter(([key]) =>
      key.startsWith(NOTE_KEY_PREFIX),
    );
    expect(notes).toHaveLength(1);
    expect(notes[0]?.[1]).toMatchObject({ kind: "plain", content: payload });
  });

  it("shows a context-menu selection as clean text with confirmed Saved status", async () => {
    const selection = "  chọn từ trang web 😀\n<script>alert(1)</script>  ";
    await handleSelectionContextMenuClick({
      menuItemId: "textpipe.add-selection.v1",
      selectionText: selection,
    });

    render(<App />);

    const editor = await screen.findByLabelText("Nội dung");
    expect((editor as HTMLTextAreaElement).value).toBe(selection);
    expect(screen.getByText("Đã lưu trên máy này để Chrome đồng bộ")).not.toBeNull();
    expect(
      (screen.getByRole("button", { name: "Lưu để đồng bộ" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await waitFor(() => {
      expect(
        Object.keys(mock.session.snapshot()).some((key) =>
          key.startsWith(CONTEXT_MENU_RESULT_KEY_PREFIX),
        ),
      ).toBe(false);
    });
    expect(document.querySelector("script:not([type=module])")).toBeNull();
  });

  it("does not show Saved for a stale context-menu result", async () => {
    const current = await saveNote({ text: "current remote", baseEventRevision: null });
    await storeContextMenuResult({
      schemaVersion: 1,
      operationId: crypto.randomUUID(),
      createdAt: Date.now(),
      status: "saved",
      eventRevision: `${current.eventRevision}-stale`,
    });

    render(<App />);

    await screen.findByDisplayValue("current remote");
    expect(screen.queryByText("Đã lưu trên máy này để Chrome đồng bộ")).toBeNull();
    expect(screen.getByText(/Lưu lúc/)).not.toBeNull();
  });

  it("explains that a locked context-menu selection was not retained", async () => {
    await enableEncryption("correct horse battery staple");
    await lockSession();
    await handleSelectionContextMenuClick({
      menuItemId: "textpipe.add-selection.v1",
      selectionText: "private text while locked",
    });

    render(<App />);

    await screen.findByRole("heading", { name: "Nội dung đang được khóa" });
    expect(
      screen.getByText("Chưa lưu phần đã chọn. Hãy mở khóa, rồi chọn và thử lại."),
    ).not.toBeNull();
    expect(JSON.stringify(mock.session.snapshot())).not.toContain("private text while locked");
  });

  it("counts UTF-8 bytes and blocks an oversized share without truncating it", async () => {
    render(<App />);
    const editor = await screen.findByLabelText("Nội dung");
    const oversized = "😀".repeat(Math.floor(MAX_TEXT_BYTES / 4) + 1);
    fireEvent.input(editor, { target: { value: oversized } });

    expect((editor as HTMLTextAreaElement).value).toBe(oversized);
    expect(screen.getByText(/Nội dung vượt giới hạn 5 KB/)).not.toBeNull();
    expect(
      (screen.getByRole("button", { name: "Lưu để đồng bộ" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("flushes a fresh draft when the popup closes before the debounce fires", async () => {
    render(<App />);
    const editor = await screen.findByLabelText("Nội dung");
    fireEvent.input(editor, { target: { value: "typed then closed" } });
    window.dispatchEvent(new Event("pagehide"));

    await waitFor(async () => {
      await expect(getDraft()).resolves.toMatchObject({ text: "typed then closed" });
    });
  });

  it("preserves a local draft when a remote update arrives and offers an explicit choice", async () => {
    const user = userEvent.setup();
    render(<App />);
    const editor = await screen.findByLabelText("Nội dung");
    await user.type(editor, "bản nháp trên máy này");

    await saveNote({ text: "bản mới từ máy khác", baseEventRevision: null, now: Date.now() });

    await screen.findByRole("heading", { name: "Có bản mới từ máy khác" });
    expect((editor as HTMLTextAreaElement).value).toBe("bản nháp trên máy này");
    expect(screen.getByText("bản mới từ máy khác")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Dùng bản mới" }));
    await waitFor(() => expect((editor as HTMLTextAreaElement).value).toBe("bản mới từ máy khác"));
    expect(screen.queryByRole("heading", { name: "Có bản mới từ máy khác" })).toBeNull();
  });

  it("reconciles a remote write that lands while Save is in flight", async () => {
    const user = userEvent.setup();
    render(<App />);
    const editor = await screen.findByLabelText("Nội dung");
    await user.type(editor, "local save in flight");

    const originalSet = mock.sync.set.bind(mock.sync);
    let releaseLocalWrite!: () => void;
    let signalLocalWrite!: () => void;
    const localWriteStarted = new Promise<void>((resolve) => {
      signalLocalWrite = resolve;
    });
    const localWriteReleased = new Promise<void>((resolve) => {
      releaseLocalWrite = resolve;
    });
    vi.spyOn(mock.sync, "set").mockImplementation(async (items) => {
      const localNote = Object.entries(items).find(
        ([key, value]) =>
          key.startsWith(NOTE_KEY_PREFIX) &&
          typeof value === "object" &&
          value !== null &&
          "content" in value &&
          value.content === "local save in flight",
      );
      if (localNote) {
        signalLocalWrite();
        await localWriteReleased;
      }
      await originalSet(items);
    });

    await user.click(screen.getByRole("button", { name: "Lưu để đồng bộ" }));
    await localWriteStarted;
    const remote = createPlainNote(
      "remote won the race",
      "another-device",
      null,
      Date.now() + 1_000,
    );
    await originalSet({ [noteStorageKey(remote.revision)]: remote });
    releaseLocalWrite();

    await screen.findByRole("heading", { name: "Có bản mới từ máy khác" });
    expect((screen.getByLabelText("Nội dung") as HTMLTextAreaElement).value).toBe(
      "local save in flight",
    );
    expect(screen.getByText("remote won the race")).not.toBeNull();
    await expect(getDraft()).resolves.toMatchObject({ text: "local save in flight" });
  });

  it("accepts a later remote update automatically after a clean successful Save", async () => {
    const user = userEvent.setup();
    render(<App />);
    const editor = await screen.findByLabelText("Nội dung");
    await user.type(editor, "clean local save");
    await user.click(screen.getByRole("button", { name: "Lưu để đồng bộ" }));
    await screen.findByText("Đã lưu trên máy này để Chrome đồng bộ");
    await expect(getDraft()).resolves.toBeNull();

    const current = await loadReadableState();
    await saveNote({
      text: "later remote value",
      baseEventRevision: current.eventRevision,
      now: Date.now() + 100,
    });

    await waitFor(() => expect((editor as HTMLTextAreaElement).value).toBe("later remote value"));
    expect(screen.queryByRole("heading", { name: "Có bản mới từ máy khác" })).toBeNull();
    await expect(getDraft()).resolves.toBeNull();
  });

  it("closes clear confirmation with Escape and restores focus", async () => {
    const user = userEvent.setup();
    await saveNote({ text: "clear me", baseEventRevision: null, now: Date.now() });
    render(<App />);
    await screen.findByDisplayValue("clear me");

    const clearButton = screen.getByRole("button", { name: "Xóa nội dung dùng chung" });
    await user.click(clearButton);
    await screen.findByRole("heading", { name: "Xóa nội dung dùng chung?" });
    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Xóa nội dung dùng chung?" })).toBeNull();
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Xóa nội dung dùng chung" }),
      );
    });
  });

  it("keeps protected content unread until the user successfully unlocks it", async () => {
    const user = userEvent.setup();
    const passphrase = "correct horse battery staple";
    await saveNote({ text: "protected incoming", baseEventRevision: null, now: Date.now() });
    await enableEncryption(passphrase);
    await lockSession();

    render(<App />);
    await screen.findByRole("heading", { name: "Nội dung đang được khóa" });
    expect(
      Object.keys(mock.local.snapshot()).some((key) => key.startsWith(READ_CURSOR_KEY_PREFIX)),
    ).toBe(false);

    await user.type(screen.getByLabelText("Passphrase"), passphrase);
    await user.click(screen.getByRole("button", { name: "Mở khóa" }));
    await screen.findByDisplayValue("protected incoming");
    await waitFor(() => {
      expect(
        Object.keys(mock.local.snapshot()).some((key) => key.startsWith(READ_CURSOR_KEY_PREFIX)),
      ).toBe(true);
    });
  });

  it("encrypts a sub-debounce draft before Lock and restores it after Unlock", async () => {
    const user = userEvent.setup();
    const passphrase = "correct horse battery staple";
    await saveNote({ text: "protected base", baseEventRevision: null, now: Date.now() });
    await enableEncryption(passphrase);

    render(<App />);
    const editor = await screen.findByDisplayValue("protected base");
    fireEvent.input(editor, { target: { value: "typed immediately before lock" } });
    await user.click(screen.getByRole("button", { name: "Khóa ngay" }));

    await screen.findByRole("heading", { name: "Nội dung đang được khóa" });
    expect(mock.session.snapshot()[STORAGE_KEYS.draft]).toMatchObject({ schemaVersion: 2 });
    expect(mock.session.snapshot()[STORAGE_KEYS.draft]).not.toHaveProperty("text");
    await expect(getDraft()).resolves.toBeNull();
    const unlockField = screen.getByLabelText("Passphrase");
    await user.type(unlockField, passphrase);
    await user.click(screen.getByRole("button", { name: "Mở khóa" }));

    await screen.findByDisplayValue("typed immediately before lock");
    await expect(getDraft()).resolves.toMatchObject({ text: "typed immediately before lock" });
  });

  it("preserves a session draft when sync arrives during initial load", async () => {
    await saveDraft({
      schemaVersion: 1,
      text: "draft from the previous popup",
      baseEventRevision: null,
      updatedAt: Date.now(),
    });
    type PromiseStorageGet = (
      keys?: string | string[] | Record<string, unknown> | null,
    ) => Promise<Record<string, unknown>>;
    const syncArea = mock.sync as unknown as { get: PromiseStorageGet };
    const originalGet = syncArea.get.bind(syncArea);
    let releaseInitialRead!: () => void;
    let signalInitialReadStarted!: () => void;
    let heldInitialRead = false;
    const initialReadStarted = new Promise<void>((resolve) => {
      signalInitialReadStarted = resolve;
    });
    const initialReadReleased = new Promise<void>((resolve) => {
      releaseInitialRead = resolve;
    });
    vi.spyOn(syncArea, "get").mockImplementation(async (keys) => {
      if (keys === null && !heldInitialRead) {
        heldInitialRead = true;
        signalInitialReadStarted();
        await initialReadReleased;
      }
      return originalGet(keys);
    });

    render(<App />);
    await initialReadStarted;
    const incoming = createPlainNote("arrived during load", "another-device", null, Date.now());
    await mock.sync.set({ [noteStorageKey(incoming.revision)]: incoming });

    const editor = await screen.findByLabelText("Nội dung");
    expect((editor as HTMLTextAreaElement).value).toBe("draft from the previous popup");
    expect(screen.getByRole("heading", { name: "Có bản mới từ máy khác" })).not.toBeNull();
    expect(screen.getByText("arrived during load")).not.toBeNull();
    expect(
      Object.keys(mock.local.snapshot()).some((key) => key.startsWith(READ_CURSOR_KEY_PREFIX)),
    ).toBe(true);

    releaseInitialRead();
    await waitFor(() => {
      expect((screen.getByLabelText("Nội dung") as HTMLTextAreaElement).value).toBe(
        "draft from the previous popup",
      );
    });
    await expect(getDraft()).resolves.toMatchObject({ text: "draft from the previous popup" });
  });
});
