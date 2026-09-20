import type {
  RetentionMinutes,
  RetentionSettingsRecord,
  SecuritySettingsRecord,
  SyncSettings,
} from "./types";

export const PRODUCT_NAME = "Textpipe";
export const LEGACY_STANDARD_SECURITY_REVISION = "legacy-standard-v1";

export const STORAGE_KEYS = {
  // Legacy combined settings are read during the v1 -> v2 migration and kept
  // as a compatibility mirror for clients that have not upgraded yet.
  settings: "textpipe.settings.v1",
  retentionSettings: "textpipe.retention.v2",
  securitySettings: "textpipe.security.v2",
  deviceId: "textpipe.device-id.v1",
  draft: "textpipe.draft.v1",
  sessionKey: "textpipe.session-key.v1",
} as const;

export const CONTEXT_MENU_ID = "textpipe.add-selection.v1";
export const CONTEXT_MENU_RESULT_KEY_PREFIX = "textpipe.context-menu-result.v1.";
export const READ_CURSOR_KEY_PREFIX = "textpipe.read-cursor.v1.";
export const ORPHAN_SEEN_KEY_PREFIX = "textpipe.orphan-seen.v1.";
export const STATE_SEEN_KEY_PREFIX = "textpipe.state-seen.v1.";
export const TRANSITION_INTENT_KEY_PREFIX = "textpipe.transition-intent.v1.";
export const RETIRED_EPOCH_KEY_PREFIX = "textpipe.retired-epoch.v1.";
export const LEGACY_NOTE_KEY_PREFIX = "textpipe.note.v1.";
export const LEGACY_TOMBSTONE_KEY_PREFIX = "textpipe.tomb.v1.";
export const LEGACY_CLEAR_MARKER_KEY_PREFIX = "textpipe.clear.v1.";
export const NOTE_KEY_PREFIX = "textpipe.note.v2.";
export const TOMBSTONE_KEY_PREFIX = "textpipe.tomb.v2.";
export const CLEAR_MARKER_KEY_PREFIX = "textpipe.clear.v2.";
export const LEGACY_STATE_RECORD_SCHEMA_VERSION = 1;
export const NOTE_SCHEMA_VERSION = 2;
export const TOMBSTONE_SCHEMA_VERSION = 2;
export const CLEAR_MARKER_SCHEMA_VERSION = 2;
export const SETTINGS_SCHEMA_VERSION = 1;
export const RETENTION_SETTINGS_SCHEMA_VERSION = 2;
export const SECURITY_SETTINGS_SCHEMA_VERSION = 2;

// The encrypted representation grows by roughly 4/3 because it is base64 encoded.
// Keeping the source at 5 KB leaves room for authenticated metadata under Chrome's
// hard 8,192-byte quota for one storage.sync item.
export const MAX_TEXT_BYTES = 5_000;
export const MAX_SESSION_DRAFT_BYTES = 100_000;
export const CHROME_SYNC_ITEM_LIMIT_BYTES = 8_192;
export const CHROME_SYNC_TOTAL_LIMIT_BYTES = 102_400;
export const CHROME_SYNC_MAX_ITEMS = 512;
export const SYNC_WRITE_RESERVE_BYTES = 16_384;
export const SYNC_WRITE_RESERVE_ITEMS = 64;
export const EMERGENCY_SYNC_RESERVE_BYTES = 4_096;
export const EMERGENCY_SYNC_RESERVE_ITEMS = 8;
export const PBKDF2_ITERATIONS = 600_000;
export const SESSION_DRAFT_DEBOUNCE_MS = 300;
export const CONTEXT_MENU_RESULT_TTL_MS = 10 * 60 * 1_000;
export const CLEANUP_ALARM_NAME = "textpipe.cleanup-expired.v1";
export const RECONCILE_BADGE_MESSAGE = "textpipe.reconcile-badge.v1";
export const CLEANUP_PERIOD_MINUTES = 30;
export const TRANSITION_INTENT_TTL_MS = 10 * 60 * 1_000;
// A note for a new security epoch can arrive before its settings record because
// Chrome Sync does not promise cross-key ordering. Start this grace period when
// the receiving device first observes an incompatible note, not at its remote
// timestamp, so a device reconnecting after days cannot delete it immediately.
export const ORPHAN_GRACE_PERIOD_MS = 24 * 60 * 60 * 1_000;
export const TOMBSTONE_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
export const MAX_RETAINED_TOMBSTONES = 48;
export const MAX_TOMBSTONES_PER_CLEANUP_BATCH = 64;
// Clear markers are immutable and uniquely keyed. Cleanup keeps the newest one
// indefinitely so a deleted older note cannot become current again after its
// short-lived per-note tombstone is collected.
export const MAX_RETAINED_CLEAR_MARKERS = 1;
export const MAX_FUTURE_CLOCK_SKEW_MS = 24 * 60 * 60 * 1_000;

export const RETENTION_OPTIONS: ReadonlyArray<{
  value: RetentionMinutes;
  label: string;
  description: string;
}> = [
  { value: 60, label: "1 giờ", description: "Phù hợp cho nội dung dùng một lần" },
  { value: 1_440, label: "24 giờ", description: "Khuyến nghị" },
  { value: 10_080, label: "7 ngày", description: "Giữ lâu hơn trên các máy" },
  { value: null, label: "Không tự xóa", description: "Chỉ xóa khi bạn yêu cầu" },
];

export const DEFAULT_SETTINGS: SyncSettings = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  revision: "default",
  retentionMinutes: 1_440,
  encryption: { enabled: false },
};

export const DEFAULT_RETENTION_SETTINGS: RetentionSettingsRecord = {
  schemaVersion: RETENTION_SETTINGS_SCHEMA_VERSION,
  revision: "default",
  retentionMinutes: DEFAULT_SETTINGS.retentionMinutes,
};

export const DEFAULT_SECURITY_SETTINGS: SecuritySettingsRecord = {
  schemaVersion: SECURITY_SETTINGS_SCHEMA_VERSION,
  revision: LEGACY_STANDARD_SECURITY_REVISION,
  encryption: DEFAULT_SETTINGS.encryption,
  targetEventRevision: null,
  targetEventAt: null,
};
