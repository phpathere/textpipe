import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONTEXT_MENU_ID } from "../src/shared/constants";
import { installChromeMock, type ChromeMock } from "./chrome-mock";

describe("service worker context-menu wiring", () => {
  let mock: ChromeMock;

  beforeEach(() => {
    vi.resetModules();
    mock = installChromeMock();
  });

  it("registers on install and routes a native click through the worker queue", async () => {
    await import("../src/background/index");
    mock.emitInstalled({ reason: "install" } as chrome.runtime.InstalledDetails);

    await vi.waitFor(() => {
      expect(mock.createdContextMenus).toEqual([
        {
          id: CONTEXT_MENU_ID,
          title: "Thêm vào Textpipe",
          contexts: ["selection"],
        },
      ]);
    });

    mock.emitContextMenuClick({
      menuItemId: CONTEXT_MENU_ID,
      selectionText: "saved through top-level listener",
      editable: false,
    });

    await vi.waitFor(() => {
      expect(chrome.action.openPopup).toHaveBeenCalledOnce();
      expect(JSON.stringify(mock.sync.snapshot())).toContain("saved through top-level listener");
    });
  });

  it("serializes two rapid selections so the second click becomes canonical", async () => {
    await import("../src/background/index");

    mock.emitContextMenuClick({
      menuItemId: CONTEXT_MENU_ID,
      selectionText: "first rapid selection",
      editable: false,
    });
    mock.emitContextMenuClick({
      menuItemId: CONTEXT_MENU_ID,
      selectionText: "second rapid selection",
      editable: false,
    });

    await vi.waitFor(() => expect(chrome.action.openPopup).toHaveBeenCalledTimes(2));
    const { loadReadableState } = await import("../src/shared/extension-api");
    await expect(loadReadableState()).resolves.toMatchObject({
      text: "second rapid selection",
    });
  });
});
