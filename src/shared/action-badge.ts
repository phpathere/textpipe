import { READ_CURSOR_KEY_PREFIX, RECONCILE_BADGE_MESSAGE } from "./constants";
import { getOrCreateDeviceId, loadRemoteState } from "./extension-api";
import { compareEventOrder } from "./note-domain";
import type { RemoteState } from "./types";

interface ReadCursor {
  schemaVersion: 1;
  eventRevision: string;
  eventAt: number;
}

type EventState = Pick<RemoteState, "eventRevision" | "eventAt"> & {
  eventRevision: string;
  eventAt: number;
};

const BADGE_BACKGROUND = "#0B57D0";
const BADGE_TEXT = "1";

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseReadCursor(value: unknown): ReadCursor | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = value as Partial<ReadCursor>;
  if (
    candidate.schemaVersion !== 1 ||
    typeof candidate.eventRevision !== "string" ||
    candidate.eventRevision.length < 1 ||
    candidate.eventRevision.length > 256 ||
    !isTimestamp(candidate.eventAt)
  ) {
    return null;
  }
  return {
    schemaVersion: 1,
    eventRevision: candidate.eventRevision,
    eventAt: candidate.eventAt,
  };
}

function hasEvent(state: Pick<RemoteState, "eventRevision" | "eventAt">): state is EventState {
  return typeof state.eventRevision === "string" && isTimestamp(state.eventAt);
}

function cursorFor(state: EventState): ReadCursor {
  return {
    schemaVersion: 1,
    eventRevision: state.eventRevision,
    eventAt: state.eventAt,
  };
}

function cursorCovers(
  cursor: ReadCursor | null,
  state: Pick<RemoteState, "eventRevision" | "eventAt">,
): boolean {
  return cursor !== null && hasEvent(state) && compareEventOrder(cursor, state) >= 0;
}

function readCursorStorageKey(eventRevision: string): string {
  return `${READ_CURSOR_KEY_PREFIX}${eventRevision}`;
}

async function getReadCursor(): Promise<ReadCursor | null> {
  const stored = await chrome.storage.local.get(null);
  let latest: ReadCursor | null = null;

  for (const [key, value] of Object.entries(stored)) {
    if (!key.startsWith(READ_CURSOR_KEY_PREFIX)) continue;
    const candidate = parseReadCursor(value);
    if (
      candidate === null ||
      key !== readCursorStorageKey(candidate.eventRevision) ||
      (latest !== null && compareEventOrder(candidate, latest) <= 0)
    ) {
      continue;
    }
    latest = candidate;
  }

  return latest;
}

async function setBadgeVisual(unread: boolean): Promise<void> {
  const title = unread
    ? chrome.i18n.getMessage("newContentTitle") || "Textpipe · Có nội dung mới"
    : chrome.i18n.getMessage("actionTitle") || "Mở Textpipe";
  if (unread) {
    await Promise.all([
      chrome.action.setBadgeBackgroundColor({ color: BADGE_BACKGROUND }),
      chrome.action.setBadgeTextColor({ color: "#FFFFFF" }),
      chrome.action.setBadgeText({ text: BADGE_TEXT }),
      chrome.action.setTitle({ title }),
    ]);
    return;
  }
  await Promise.all([chrome.action.setBadgeText({ text: "" }), chrome.action.setTitle({ title })]);
}

async function pruneReadCursors(): Promise<void> {
  const stored = await chrome.storage.local.get(null);
  let latestKey: string | null = null;
  let latest: ReadCursor | null = null;
  const cursorKeys: string[] = [];

  for (const [key, value] of Object.entries(stored)) {
    if (!key.startsWith(READ_CURSOR_KEY_PREFIX)) continue;
    cursorKeys.push(key);
    const candidate = parseReadCursor(value);
    if (candidate === null || key !== readCursorStorageKey(candidate.eventRevision)) continue;
    if (latest === null || compareEventOrder(candidate, latest) > 0) {
      latest = candidate;
      latestKey = key;
    }
  }

  const obsoleteKeys = cursorKeys.filter((key) => key !== latestKey);
  if (obsoleteKeys.length > 0) await chrome.storage.local.remove(obsoleteKeys);
}

async function persistCursor(state: Pick<RemoteState, "eventRevision" | "eventAt">): Promise<void> {
  if (!hasEvent(state)) return;
  await chrome.storage.local.set({
    [readCursorStorageKey(state.eventRevision)]: cursorFor(state),
  });
  await pruneReadCursors();
}

/**
 * Derives the toolbar badge from the canonical shared state and this device's
 * durable read cursor. This avoids treating a stale storage delta as new data.
 */
export async function reconcileActionBadge(): Promise<void> {
  const [state, deviceId, storedCursor] = await Promise.all([
    loadRemoteState(),
    getOrCreateDeviceId(),
    getReadCursor(),
  ]);
  const cameFromAnotherDevice = state.note !== null && state.note.sourceId !== deviceId;
  let effectiveCursor = storedCursor;

  // Empty/expired/cleared states and content created on this device are already
  // observed locally, so advance the monotonic cursor without a self-notification.
  if (!cameFromAnotherDevice && hasEvent(state) && !cursorCovers(storedCursor, state)) {
    await persistCursor(state);
    effectiveCursor = await getReadCursor();
  }

  await setBadgeVisual(cameFromAnotherDevice && !cursorCovers(effectiveCursor, state));
}

/** Records exactly the revision rendered by the popup. Toolbar writes are
 * delegated to the service worker so every visual update shares one queue. */
export async function markStateRead(
  state: Pick<RemoteState, "eventRevision" | "eventAt">,
): Promise<void> {
  const cursor = await getReadCursor();
  if (hasEvent(state) && !cursorCovers(cursor, state)) await persistCursor(state);
  await chrome.runtime.sendMessage({ type: RECONCILE_BADGE_MESSAGE });
}

export function isReadCursorChange(changes: Record<string, chrome.storage.StorageChange>): boolean {
  return Object.keys(changes).some((key) => key.startsWith(READ_CURSOR_KEY_PREFIX));
}
