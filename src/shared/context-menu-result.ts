import {
  CONTEXT_MENU_RESULT_KEY_PREFIX,
  CONTEXT_MENU_RESULT_TTL_MS,
  MAX_FUTURE_CLOCK_SKEW_MS,
} from "./constants";

export type ContextMenuErrorCode =
  | "EMPTY_NOTE"
  | "INVALID_STORAGE_DATA"
  | "LOCKED"
  | "NOTE_TOO_LARGE"
  | "SETTINGS_CHANGED"
  | "SYNC_CONFLICT"
  | "SYNC_QUOTA"
  | "UNKNOWN";

interface ContextMenuResultBase {
  schemaVersion: 1;
  operationId: string;
  createdAt: number;
}

export interface ContextMenuSavedResult extends ContextMenuResultBase {
  status: "saved";
  eventRevision: string;
}

export interface ContextMenuErrorResult extends ContextMenuResultBase {
  status: "error";
  errorCode: ContextMenuErrorCode;
}

export type ContextMenuResult = ContextMenuSavedResult | ContextMenuErrorResult;

export interface ContextMenuResultSnapshot {
  result: ContextMenuResult | null;
  keys: string[];
}

function isSafeTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isOperationId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f-]{36}$/u.test(value);
}

function isErrorCode(value: unknown): value is ContextMenuErrorCode {
  return (
    value === "EMPTY_NOTE" ||
    value === "INVALID_STORAGE_DATA" ||
    value === "LOCKED" ||
    value === "NOTE_TOO_LARGE" ||
    value === "SETTINGS_CHANGED" ||
    value === "SYNC_CONFLICT" ||
    value === "SYNC_QUOTA" ||
    value === "UNKNOWN"
  );
}

function parseResult(value: unknown, key: string): ContextMenuResult | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = value as Partial<ContextMenuResult>;
  if (
    candidate.schemaVersion !== 1 ||
    !isOperationId(candidate.operationId) ||
    key !== `${CONTEXT_MENU_RESULT_KEY_PREFIX}${candidate.operationId}` ||
    !isSafeTimestamp(candidate.createdAt)
  ) {
    return null;
  }
  if (
    candidate.status === "saved" &&
    typeof candidate.eventRevision === "string" &&
    candidate.eventRevision.length >= 1 &&
    candidate.eventRevision.length <= 256
  ) {
    return {
      schemaVersion: 1,
      operationId: candidate.operationId,
      createdAt: candidate.createdAt,
      status: "saved",
      eventRevision: candidate.eventRevision,
    };
  }
  if (candidate.status === "error" && isErrorCode(candidate.errorCode)) {
    return {
      schemaVersion: 1,
      operationId: candidate.operationId,
      createdAt: candidate.createdAt,
      status: "error",
      errorCode: candidate.errorCode,
    };
  }
  return null;
}

function resultKey(operationId: string): string {
  return `${CONTEXT_MENU_RESULT_KEY_PREFIX}${operationId}`;
}

export async function storeContextMenuResult(result: ContextMenuResult): Promise<void> {
  const current = await chrome.storage.session.get(null);
  const oldKeys = Object.keys(current).filter((key) =>
    key.startsWith(CONTEXT_MENU_RESULT_KEY_PREFIX),
  );
  if (oldKeys.length > 0) await chrome.storage.session.remove(oldKeys);
  await chrome.storage.session.set({ [resultKey(result.operationId)]: result });
}

export async function readContextMenuResult(now = Date.now()): Promise<ContextMenuResultSnapshot> {
  const current = await chrome.storage.session.get(null);
  const entries = Object.entries(current).filter(([key]) =>
    key.startsWith(CONTEXT_MENU_RESULT_KEY_PREFIX),
  );
  let latest: ContextMenuResult | null = null;

  for (const [key, value] of entries) {
    const candidate = parseResult(value, key);
    if (
      candidate === null ||
      candidate.createdAt > now + MAX_FUTURE_CLOCK_SKEW_MS ||
      now - candidate.createdAt > CONTEXT_MENU_RESULT_TTL_MS
    ) {
      continue;
    }
    if (
      latest === null ||
      candidate.createdAt > latest.createdAt ||
      (candidate.createdAt === latest.createdAt && candidate.operationId > latest.operationId)
    ) {
      latest = candidate;
    }
  }

  return { result: latest, keys: entries.map(([key]) => key) };
}

export async function removeContextMenuResults(keys: readonly string[]): Promise<void> {
  if (keys.length > 0) await chrome.storage.session.remove([...keys]);
}

export function isContextMenuResultChange(
  changes: Record<string, chrome.storage.StorageChange>,
): boolean {
  return Object.entries(changes).some(
    ([key, change]) =>
      key.startsWith(CONTEXT_MENU_RESULT_KEY_PREFIX) && change.newValue !== undefined,
  );
}
