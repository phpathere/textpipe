import { reconcileActionBadge } from "../shared/action-badge";
import { CONTEXT_MENU_ID } from "../shared/constants";
import { type ContextMenuErrorCode, storeContextMenuResult } from "../shared/context-menu-result";
import { AppError, ConflictError } from "../shared/errors";
import { clearDraft, loadReadableState, saveNote } from "../shared/extension-api";

export type ContextMenuSaveOutcome = "error" | "ignored" | "saved";

function runtimeError(): Error | null {
  const message = chrome.runtime.lastError?.message;
  return message ? new Error(message) : null;
}

export function installSelectionContextMenu(): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.contextMenus.removeAll(() => {
      const removeError = runtimeError();
      if (removeError) {
        reject(removeError);
        return;
      }
      chrome.contextMenus.create(
        {
          id: CONTEXT_MENU_ID,
          title: chrome.i18n.getMessage("contextMenuAddSelection") || "Add to Textpipe",
          contexts: ["selection"],
        },
        () => {
          const createError = runtimeError();
          if (createError) reject(createError);
          else resolve();
        },
      );
    });
  });
}

function errorCode(error: unknown): ContextMenuErrorCode {
  if (!(error instanceof AppError)) return "UNKNOWN";
  if (
    error.code === "EMPTY_NOTE" ||
    error.code === "INVALID_STORAGE_DATA" ||
    error.code === "LOCKED" ||
    error.code === "NOTE_TOO_LARGE" ||
    error.code === "SETTINGS_CHANGED" ||
    error.code === "SYNC_CONFLICT" ||
    error.code === "SYNC_QUOTA"
  ) {
    return error.code;
  }
  return "UNKNOWN";
}

async function openResultPopup(): Promise<void> {
  await chrome.action.openPopup().catch(() => undefined);
}

export async function handleSelectionContextMenuClick(
  info: Pick<chrome.contextMenus.OnClickData, "menuItemId" | "selectionText">,
): Promise<ContextMenuSaveOutcome> {
  if (
    info.menuItemId !== CONTEXT_MENU_ID ||
    typeof info.selectionText !== "string" ||
    info.selectionText.length === 0
  ) {
    return "ignored";
  }

  try {
    const operationId = crypto.randomUUID();
    const before = await loadReadableState();
    const saved = await saveNote({
      text: info.selectionText,
      baseEventRevision: before.eventRevision,
      force: true,
    });
    const canonical = await loadReadableState();
    const eventRevision = saved.eventRevision;
    if (eventRevision === null || canonical.eventRevision !== eventRevision) {
      throw new ConflictError();
    }

    // A successful context action deliberately replaces any older recovery
    // draft. Failure paths leave that draft untouched.
    await clearDraft().catch(() => undefined);
    await storeContextMenuResult({
      schemaVersion: 1,
      operationId,
      createdAt: Date.now(),
      status: "saved",
      eventRevision,
    });
    await reconcileActionBadge().catch(() => undefined);
    await openResultPopup();
    return "saved";
  } catch (error) {
    const operationId = crypto.randomUUID();
    await storeContextMenuResult({
      schemaVersion: 1,
      operationId,
      createdAt: Date.now(),
      status: "error",
      errorCode: errorCode(error),
    }).catch(() => undefined);
    await openResultPopup();
    return "error";
  }
}
