import { isReadCursorChange, reconcileActionBadge } from "../shared/action-badge";
import {
  CLEANUP_ALARM_NAME,
  CLEANUP_PERIOD_MINUTES,
  RECONCILE_BADGE_MESSAGE,
} from "../shared/constants";
import {
  cleanupStorage,
  configureStorageAccess,
  getOrCreateDeviceId,
  isRelevantSyncChange,
  reconcileSessionSecurity,
} from "../shared/extension-api";
import { handleSelectionContextMenuClick, installSelectionContextMenu } from "./context-menu";

let workQueue: Promise<void> = Promise.resolve();

function enqueue(work: () => Promise<void>): Promise<void> {
  const next = workQueue.then(work, work);
  workQueue = next.catch(() => undefined);
  return next;
}

async function ensureCleanupAlarm(): Promise<void> {
  const alarm = await chrome.alarms.get(CLEANUP_ALARM_NAME);
  if (!alarm) {
    await chrome.alarms.create(CLEANUP_ALARM_NAME, {
      delayInMinutes: CLEANUP_PERIOD_MINUTES,
      periodInMinutes: CLEANUP_PERIOD_MINUTES,
    });
  }
}

async function initialize(): Promise<void> {
  await configureStorageAccess();
  await ensureCleanupAlarm();
  await getOrCreateDeviceId();
  await reconcileSessionSecurity().catch(() => undefined);
  await cleanupStorage();
  await reconcileActionBadge();
}

async function cleanupAndReconcile(): Promise<void> {
  await reconcileSessionSecurity().catch(() => undefined);
  await cleanupStorage();
  await reconcileActionBadge();
}

function runInitialize(): void {
  void enqueue(initialize).catch(() => undefined);
}

chrome.runtime.onInstalled.addListener(() => {
  void enqueue(async () => {
    await installSelectionContextMenu().catch(() => undefined);
    await initialize();
  }).catch(() => undefined);
});

chrome.runtime.onStartup.addListener(runInitialize);

chrome.contextMenus.onClicked.addListener((info) => {
  void enqueue(() => handleSelectionContextMenuClick(info).then(() => undefined)).catch(
    () => undefined,
  );
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CLEANUP_ALARM_NAME) {
    void enqueue(cleanupAndReconcile).catch(() => undefined);
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync" && isRelevantSyncChange(changes)) {
    void enqueue(cleanupAndReconcile).catch(() => undefined);
  }
  if (areaName === "local" && isReadCursorChange(changes)) {
    void enqueue(reconcileActionBadge).catch(() => undefined);
  }
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (
    typeof message !== "object" ||
    message === null ||
    !("type" in message) ||
    (message.type !== CLEANUP_ALARM_NAME && message.type !== RECONCILE_BADGE_MESSAGE)
  ) {
    return false;
  }

  const work = message.type === CLEANUP_ALARM_NAME ? cleanupAndReconcile : reconcileActionBadge;
  enqueue(work).then(
    () => sendResponse({ ok: true }),
    () => sendResponse({ ok: false }),
  );
  return true;
});

runInitialize();
