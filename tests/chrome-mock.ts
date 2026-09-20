import { vi } from "vitest";

type ChangeListener = (
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string,
) => void;

interface MockArea extends chrome.storage.StorageArea {
  snapshot(): Record<string, unknown>;
}

function createStorageArea(areaName: string, listeners: Set<ChangeListener>): MockArea {
  const values = new Map<string, unknown>();

  const area = {
    async get(keys?: string | string[] | Record<string, unknown> | null) {
      if (keys === null || keys === undefined) return Object.fromEntries(values);
      if (typeof keys === "string") return { [keys]: values.get(keys) };
      if (Array.isArray(keys)) {
        return Object.fromEntries(keys.map((key) => [key, values.get(key)]));
      }
      return Object.fromEntries(
        Object.entries(keys).map(([key, fallback]) => [
          key,
          values.has(key) ? values.get(key) : fallback,
        ]),
      );
    },
    async set(items: Record<string, unknown>) {
      const changes: Record<string, chrome.storage.StorageChange> = {};
      for (const [key, value] of Object.entries(items)) {
        changes[key] = { oldValue: values.get(key), newValue: structuredClone(value) };
        values.set(key, structuredClone(value));
      }
      for (const listener of listeners) listener(changes, areaName);
    },
    async remove(keys: string | string[]) {
      const list = Array.isArray(keys) ? keys : [keys];
      const changes: Record<string, chrome.storage.StorageChange> = {};
      for (const key of list) {
        if (!values.has(key)) continue;
        changes[key] = { oldValue: values.get(key), newValue: undefined };
        values.delete(key);
      }
      if (Object.keys(changes).length > 0) {
        for (const listener of listeners) listener(changes, areaName);
      }
    },
    async clear() {
      const changes: Record<string, chrome.storage.StorageChange> = {};
      for (const [key, value] of values) changes[key] = { oldValue: value };
      values.clear();
      for (const listener of listeners) listener(changes, areaName);
    },
    async getBytesInUse(keys?: string | string[] | null) {
      const selectedKeys =
        keys === null || keys === undefined
          ? [...values.keys()]
          : typeof keys === "string"
            ? [keys]
            : keys;
      return selectedKeys.reduce((total, key) => {
        if (!values.has(key)) return total;
        return (
          total +
          new TextEncoder().encode(key).byteLength +
          new TextEncoder().encode(JSON.stringify(values.get(key))).byteLength
        );
      }, 0);
    },
    async setAccessLevel() {},
    snapshot() {
      return structuredClone(Object.fromEntries(values));
    },
    QUOTA_BYTES: 102_400,
  } as unknown as MockArea;

  return area;
}

export interface ChromeMock {
  chrome: typeof chrome;
  sync: MockArea;
  local: MockArea;
  session: MockArea;
  createdContextMenus: chrome.contextMenus.CreateProperties[];
  emitSync(changes: Record<string, chrome.storage.StorageChange>): void;
  emitContextMenuClick(info: chrome.contextMenus.OnClickData): void;
  emitInstalled(details: chrome.runtime.InstalledDetails): void;
}

export function installChromeMock(): ChromeMock {
  const listeners = new Set<ChangeListener>();
  const sync = createStorageArea("sync", listeners);
  const local = createStorageArea("local", listeners);
  const session = createStorageArea("session", listeners);
  const contextMenuListeners = new Set<
    (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => void
  >();
  const installedListeners = new Set<(details: chrome.runtime.InstalledDetails) => void>();
  const createdContextMenus: chrome.contextMenus.CreateProperties[] = [];

  const chromeMock = {
    storage: {
      sync,
      local,
      session,
      onChanged: {
        addListener: (listener: ChangeListener) => listeners.add(listener),
        removeListener: (listener: ChangeListener) => listeners.delete(listener),
        hasListener: (listener: ChangeListener) => listeners.has(listener),
      },
    },
    runtime: {
      id: "khdimndigbjmblggkgjpbhkokechiedd",
      getManifest: vi.fn(() => ({ version: "1.0.0" })),
      sendMessage: vi.fn().mockResolvedValue({ ok: true }),
      openOptionsPage: vi.fn().mockResolvedValue(undefined),
      onInstalled: {
        addListener: (listener: (details: chrome.runtime.InstalledDetails) => void) =>
          installedListeners.add(listener),
        removeListener: (listener: (details: chrome.runtime.InstalledDetails) => void) =>
          installedListeners.delete(listener),
        hasListener: (listener: (details: chrome.runtime.InstalledDetails) => void) =>
          installedListeners.has(listener),
      },
      onStartup: { addListener: vi.fn() },
      onMessage: { addListener: vi.fn() },
    },
    action: {
      setBadgeText: vi.fn().mockResolvedValue(undefined),
      setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
      setBadgeTextColor: vi.fn().mockResolvedValue(undefined),
      setTitle: vi.fn().mockResolvedValue(undefined),
      openPopup: vi.fn().mockResolvedValue(undefined),
    },
    i18n: {
      getUILanguage: vi.fn(() => "vi-VN"),
      getMessage: vi.fn((key: string) => {
        if (key === "newContentTitle") return "Textpipe · Có nội dung mới";
        if (key === "actionTitle") return "Mở Textpipe";
        if (key === "contextMenuAddSelection") return "Thêm vào Textpipe";
        return "";
      }),
    },
    alarms: {
      get: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockResolvedValue(undefined),
      onAlarm: { addListener: vi.fn() },
    },
    contextMenus: {
      create: vi.fn((properties: chrome.contextMenus.CreateProperties, callback?: () => void) => {
        createdContextMenus.push(structuredClone(properties));
        callback?.();
        return properties.id ?? createdContextMenus.length;
      }),
      removeAll: vi.fn((callback?: () => void) => {
        createdContextMenus.splice(0);
        if (callback) callback();
        else return Promise.resolve();
      }),
      onClicked: {
        addListener: (
          listener: (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => void,
        ) => contextMenuListeners.add(listener),
        removeListener: (
          listener: (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => void,
        ) => contextMenuListeners.delete(listener),
        hasListener: (
          listener: (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => void,
        ) => contextMenuListeners.has(listener),
      },
    },
  } as unknown as typeof chrome;

  vi.stubGlobal("chrome", chromeMock);
  return {
    chrome: chromeMock,
    sync,
    local,
    session,
    createdContextMenus,
    emitSync(changes) {
      for (const listener of listeners) listener(changes, "sync");
    },
    emitContextMenuClick(info) {
      for (const listener of contextMenuListeners) listener(info);
    },
    emitInstalled(details) {
      for (const listener of installedListeners) listener(details);
    },
  };
}
