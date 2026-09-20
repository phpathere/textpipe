import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  MAX_SESSION_DRAFT_BYTES,
  MAX_TEXT_BYTES,
  SESSION_DRAFT_DEBOUNCE_MS,
} from "../shared/constants";
import { utf8ByteLength } from "../shared/encoding";
import { ConflictError, LockedError } from "../shared/errors";
import {
  type ContextMenuErrorResult,
  isContextMenuResultChange,
  readContextMenuResult,
  removeContextMenuResults,
} from "../shared/context-menu-result";
import {
  clearCurrent,
  clearDraft,
  getDraft,
  getSettings,
  isRelevantSyncChange,
  loadReadableState,
  lockSession,
  saveDraft,
  saveNote,
  SettingsChangedError,
  unlockSession,
} from "../shared/extension-api";
import { markStateRead } from "../shared/action-badge";
import {
  createTranslator,
  getLanguage,
  getLocalizedErrorMessage,
  type Translate,
} from "../shared/i18n";
import type { ReadableRemoteState, StoredDraft, SyncSettings } from "../shared/types";
import {
  AlertIcon,
  BrandMark,
  CheckIcon,
  CopyIcon,
  LockIcon,
  SettingsIcon,
  TrashIcon,
} from "../ui/Icons";
import "../ui/base.css";
import "./popup.css";

type LoadStatus = "loading" | "ready" | "error";
type Operation = "idle" | "saving" | "clearing" | "unlocking" | "locking";
type Feedback = "none" | "saved" | "copied" | "remote" | "copy-error";

function contextMenuErrorMessage(result: ContextMenuErrorResult, t: Translate): string {
  if (result.errorCode === "LOCKED") return t("contextMenuLockedError");
  if (result.errorCode === "NOTE_TOO_LARGE") return t("tooLarge");
  if (result.errorCode === "SYNC_QUOTA") return t("syncQuota");
  if (result.errorCode === "SYNC_CONFLICT") return t("conflictError");
  if (result.errorCode === "SETTINGS_CHANGED") return t("settingsChanged");
  if (result.errorCode === "INVALID_STORAGE_DATA") return t("invalidStorageError");
  if (result.errorCode === "EMPTY_NOTE") return t("emptyNoteError");
  return t("contextMenuSaveError");
}

function emptyRemoteState(): ReadableRemoteState {
  return {
    eventRevision: null,
    eventAt: null,
    note: null,
    expired: false,
    invalidItemCount: 0,
    text: null,
    locked: false,
  };
}

export function App() {
  const language = useMemo(getLanguage, []);
  const t = useMemo(() => createTranslator(language), [language]);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("loading");
  const [operation, setOperation] = useState<Operation>("idle");
  const [feedback, setFeedback] = useState<Feedback>("none");
  const [errorMessage, setErrorMessage] = useState("");
  const [settings, setSettings] = useState<SyncSettings | null>(null);
  const [remote, setRemote] = useState<ReadableRemoteState>(emptyRemoteState);
  const [conflict, setConflict] = useState<ReadableRemoteState | null>(null);
  const [text, setText] = useState("");
  const [baseEventRevision, setBaseEventRevision] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [showUnlockPassphrase, setShowUnlockPassphrase] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cancelClearRef = useRef<HTMLButtonElement>(null);
  const clearButtonRef = useRef<HTMLButtonElement>(null);
  const textRef = useRef(text);
  const dirtyRef = useRef(dirty);
  const baseEventRef = useRef(baseEventRevision);
  const operationRef = useRef(operation);
  const refreshGenerationRef = useRef(0);
  const pendingSyncRefreshRef = useRef(false);
  const pendingContextRefreshRef = useRef(false);

  textRef.current = text;
  dirtyRef.current = dirty;
  baseEventRef.current = baseEventRevision;
  operationRef.current = operation;

  const byteLength = utf8ByteLength(text);
  const tooLarge = byteLength > MAX_TEXT_BYTES;
  const draftTooLarge = byteLength > MAX_SESSION_DRAFT_BYTES;
  const canSave =
    loadStatus === "ready" &&
    operation === "idle" &&
    dirty &&
    text.length > 0 &&
    !tooLarge &&
    !conflict &&
    !remote.locked;

  const persistCurrentDraft = useCallback(async (): Promise<void> => {
    if (
      !dirtyRef.current ||
      textRef.current.length === 0 ||
      utf8ByteLength(textRef.current) > MAX_SESSION_DRAFT_BYTES
    ) {
      return;
    }
    await saveDraft({
      schemaVersion: 1,
      text: textRef.current,
      baseEventRevision: baseEventRef.current,
      updatedAt: Date.now(),
    });
  }, []);

  const applyCleanRemote = useCallback((next: ReadableRemoteState, announce = false) => {
    const nextText = next.text ?? "";
    textRef.current = nextText;
    baseEventRef.current = next.eventRevision;
    dirtyRef.current = false;
    setRemote(next);
    setConflict(null);
    setText(nextText);
    setBaseEventRevision(next.eventRevision);
    setDirty(false);
    setFeedback(announce ? "remote" : "none");
    void clearDraft();
  }, []);

  const applyDraftRemote = useCallback(
    (draft: StoredDraft, next: ReadableRemoteState, announce = false) => {
      const remoteText = next.text ?? "";
      const draftIsDirty =
        draft.text !== remoteText || draft.baseEventRevision !== next.eventRevision;
      const hasRemoteConflict = draftIsDirty && draft.baseEventRevision !== next.eventRevision;
      textRef.current = draft.text;
      baseEventRef.current = draft.baseEventRevision;
      dirtyRef.current = draftIsDirty;
      setRemote(next);
      setText(draft.text);
      setBaseEventRevision(draft.baseEventRevision);
      setDirty(draftIsDirty);
      setConflict(hasRemoteConflict ? next : null);
      setFeedback(announce && hasRemoteConflict ? "remote" : "none");
    },
    [],
  );

  const load = useCallback(
    async (skipDraftPersistence = false) => {
      const generation = ++refreshGenerationRef.current;
      setLoadStatus("loading");
      setErrorMessage("");
      try {
        if (!skipDraftPersistence) await persistCurrentDraft().catch(() => undefined);
        const [nextRemote, nextSettings, draft, contextMenuResult] = await Promise.all([
          loadReadableState(),
          getSettings(),
          getDraft(),
          readContextMenuResult(),
        ]);
        if (generation !== refreshGenerationRef.current) return;
        if (!nextRemote.locked) await markStateRead(nextRemote).catch(() => undefined);
        if (generation !== refreshGenerationRef.current) return;

        setSettings(nextSettings);
        setRemote(nextRemote);

        const contextSaveConfirmed =
          contextMenuResult.result?.status === "saved" &&
          contextMenuResult.result.eventRevision === nextRemote.eventRevision &&
          !nextRemote.locked;

        if (nextRemote.locked) {
          setText("");
          setBaseEventRevision(nextRemote.eventRevision);
          setDirty(false);
          setConflict(null);
        } else if (contextSaveConfirmed) {
          applyCleanRemote(nextRemote);
          setFeedback("saved");
        } else if (draft) {
          applyDraftRemote(draft, nextRemote);
        } else {
          applyCleanRemote(nextRemote);
        }
        if (contextMenuResult.result?.status === "error") {
          setErrorMessage(contextMenuErrorMessage(contextMenuResult.result, t));
        }
        await removeContextMenuResults(contextMenuResult.keys).catch(() => undefined);
        setLoadStatus("ready");
      } catch (error) {
        if (generation !== refreshGenerationRef.current) return;
        setLoadStatus("error");
        setErrorMessage(getLocalizedErrorMessage(error, t));
      }
    },
    [applyCleanRemote, applyDraftRemote, persistCurrentDraft, t],
  );

  useEffect(() => {
    document.body.classList.add("popup-page");
    document.documentElement.lang = language;
    document.title = t("popupDocumentTitle");
    void load();
    return () => document.body.classList.remove("popup-page");
  }, [language, load, t]);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName === "session" && isContextMenuResultChange(changes)) {
        if (operationRef.current === "idle") void load(true);
        else {
          pendingSyncRefreshRef.current = true;
          pendingContextRefreshRef.current = true;
        }
        return;
      }
      if (areaName !== "sync" || !isRelevantSyncChange(changes)) return;
      if (operationRef.current !== "idle") {
        pendingSyncRefreshRef.current = true;
        return;
      }
      const generation = ++refreshGenerationRef.current;
      const draftPromise = (async () => {
        await persistCurrentDraft().catch(() => undefined);
        return getDraft();
      })();

      void Promise.all([loadReadableState(), getSettings(), draftPromise])
        .then(async ([nextRemote, nextSettings, draft]) => {
          if (generation !== refreshGenerationRef.current || operationRef.current !== "idle") {
            return;
          }
          if (!nextRemote.locked) await markStateRead(nextRemote).catch(() => undefined);
          if (generation !== refreshGenerationRef.current || operationRef.current !== "idle") {
            return;
          }

          setSettings(nextSettings);
          setErrorMessage("");
          setLoadStatus("ready");
          if (nextRemote.locked) {
            setRemote(nextRemote);
            setConflict(null);
            return;
          }
          if (dirtyRef.current && nextRemote.eventRevision !== baseEventRef.current) {
            setRemote(nextRemote);
            setConflict(nextRemote);
            setFeedback("remote");
            return;
          }
          if (!dirtyRef.current && draft) {
            applyDraftRemote(draft, nextRemote, true);
            return;
          }
          if (!dirtyRef.current) applyCleanRemote(nextRemote, true);
        })
        .catch((error: unknown) => {
          if (generation !== refreshGenerationRef.current || operationRef.current !== "idle") {
            return;
          }
          setErrorMessage(getLocalizedErrorMessage(error, t));
          setLoadStatus("error");
        });
    };

    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [applyCleanRemote, applyDraftRemote, load, persistCurrentDraft, t]);

  useEffect(() => {
    if (loadStatus !== "ready" || !dirty || remote.locked || draftTooLarge) return;
    const timer = window.setTimeout(() => {
      void saveDraft({
        schemaVersion: 1,
        text,
        baseEventRevision,
        updatedAt: Date.now(),
      });
    }, SESSION_DRAFT_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [baseEventRevision, dirty, draftTooLarge, loadStatus, remote.locked, text]);

  useEffect(() => {
    const flushDraft = () => {
      if (
        !dirtyRef.current ||
        textRef.current.length === 0 ||
        utf8ByteLength(textRef.current) > MAX_SESSION_DRAFT_BYTES
      ) {
        return;
      }
      void saveDraft({
        schemaVersion: 1,
        text: textRef.current,
        baseEventRevision: baseEventRef.current,
        updatedAt: Date.now(),
      });
    };
    window.addEventListener("pagehide", flushDraft);
    return () => {
      window.removeEventListener("pagehide", flushDraft);
      flushDraft();
    };
  }, []);

  useEffect(() => {
    if (confirmingClear) cancelClearRef.current?.focus();
  }, [confirmingClear]);

  useEffect(() => {
    if (!confirmingClear) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setConfirmingClear(false);
      requestAnimationFrame(() => clearButtonRef.current?.focus());
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [confirmingClear]);

  useEffect(() => {
    if (
      loadStatus === "ready" &&
      !remote.locked &&
      text.length === 0 &&
      document.activeElement === document.body
    ) {
      textareaRef.current?.focus();
    }
  }, [loadStatus, remote.locked, text.length]);

  async function performSave(force = false): Promise<void> {
    if (tooLarge || text.length === 0 || remote.locked) return;
    const snapshot = text;
    refreshGenerationRef.current += 1;
    operationRef.current = "saving";
    setOperation("saving");
    setFeedback("none");
    setErrorMessage("");
    try {
      await saveDraft({
        schemaVersion: 1,
        text: snapshot,
        baseEventRevision,
        updatedAt: Date.now(),
      });
      const savedState = await saveNote({
        text: snapshot,
        baseEventRevision,
        force,
      });
      pendingSyncRefreshRef.current = false;
      const [latest, latestSettings] = await Promise.all([loadReadableState(), getSettings()]);
      setSettings(latestSettings);

      if (latest.eventRevision !== savedState.eventRevision) {
        const preservedText = textRef.current === snapshot ? snapshot : textRef.current;
        setRemote(latest);
        setConflict(latest);
        setText(preservedText);
        textRef.current = preservedText;
        setBaseEventRevision(savedState.eventRevision);
        baseEventRef.current = savedState.eventRevision;
        setDirty(true);
        dirtyRef.current = true;
        setFeedback("remote");
        await saveDraft({
          schemaVersion: 1,
          text: preservedText,
          baseEventRevision: savedState.eventRevision,
          updatedAt: Date.now(),
        });
      } else {
        setRemote(savedState);
        setBaseEventRevision(savedState.eventRevision);
        baseEventRef.current = savedState.eventRevision;
        setConflict(null);
        if (textRef.current === snapshot) {
          dirtyRef.current = false;
          setDirty(false);
          setFeedback("saved");
          await clearDraft().catch(() => undefined);
        } else {
          setDirty(true);
          void saveDraft({
            schemaVersion: 1,
            text: textRef.current,
            baseEventRevision: savedState.eventRevision,
            updatedAt: Date.now(),
          });
        }
      }
    } catch (error) {
      if (error instanceof ConflictError) {
        try {
          const latest = await loadReadableState();
          setRemote(latest);
          setConflict(latest);
        } catch (reloadError) {
          setErrorMessage(getLocalizedErrorMessage(reloadError, t));
        }
      } else if (error instanceof LockedError || error instanceof SettingsChangedError) {
        await load();
        setErrorMessage(getLocalizedErrorMessage(error, t));
      } else {
        setErrorMessage(getLocalizedErrorMessage(error, t));
      }
    } finally {
      finishOperation();
    }
  }

  async function handleCopy(): Promise<void> {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setFeedback("copied");
    } catch {
      textareaRef.current?.focus();
      textareaRef.current?.select();
      setFeedback("copy-error");
    }
  }

  async function handleClear(): Promise<void> {
    refreshGenerationRef.current += 1;
    operationRef.current = "clearing";
    setOperation("clearing");
    setErrorMessage("");
    try {
      await clearCurrent(remote.eventRevision);
      const next = await loadReadableState();
      applyCleanRemote(next);
      setConfirmingClear(false);
    } catch (error) {
      setErrorMessage(getLocalizedErrorMessage(error, t));
    } finally {
      finishOperation();
    }
  }

  async function handleUnlock(event: Event): Promise<void> {
    event.preventDefault();
    refreshGenerationRef.current += 1;
    operationRef.current = "unlocking";
    setOperation("unlocking");
    setErrorMessage("");
    try {
      await unlockSession(passphrase);
      setPassphrase("");
      setShowUnlockPassphrase(false);
      setCapsLock(false);
      await load();
    } catch (error) {
      setErrorMessage(getLocalizedErrorMessage(error, t));
    } finally {
      finishOperation();
    }
  }

  async function handleLockNow(): Promise<void> {
    refreshGenerationRef.current += 1;
    operationRef.current = "locking";
    setOperation("locking");
    setErrorMessage("");
    try {
      await persistCurrentDraft();
      await lockSession();
      setShowUnlockPassphrase(false);
      setCapsLock(false);
      await load();
    } catch (error) {
      setErrorMessage(getLocalizedErrorMessage(error, t));
    } finally {
      finishOperation();
    }
  }

  function useIncoming(): void {
    if (!conflict || conflict.locked) return;
    applyCleanRemote(conflict);
  }

  function handleTextInput(value: string): void {
    textRef.current = value;
    dirtyRef.current = value !== (remote.text ?? "");
    setText(value);
    setDirty(dirtyRef.current);
    setFeedback("none");
  }

  function handleEditorKeyDown(event: KeyboardEvent): void {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (canSave) void performSave();
    }
  }

  function updateCapsLock(event: KeyboardEvent): void {
    setCapsLock(event.getModifierState("CapsLock"));
  }

  function finishOperation(): void {
    operationRef.current = "idle";
    setOperation("idle");
    if (!pendingSyncRefreshRef.current) return;
    pendingSyncRefreshRef.current = false;
    const skipDraftPersistence = pendingContextRefreshRef.current;
    pendingContextRefreshRef.current = false;
    // A Sync event can arrive while any mutation is in flight, not only Save.
    // Reconcile once after the operation so Clear/Lock/Unlock cannot leave a
    // stale screen waiting for another event.
    queueMicrotask(() => void load(skipDraftPersistence));
  }

  function cancelClear(): void {
    setConfirmingClear(false);
    requestAnimationFrame(() => clearButtonRef.current?.focus());
  }

  function formatSavedTime(timestamp: number | null): string {
    if (timestamp === null) return "";
    return new Intl.DateTimeFormat(language, { hour: "2-digit", minute: "2-digit" }).format(
      timestamp,
    );
  }

  let statusText = "";
  if (operation === "saving") statusText = t("saving");
  else if (feedback === "copied") statusText = t("copied");
  else if (feedback === "copy-error") statusText = t("copyFailure");
  else if (feedback === "remote") statusText = t("updatedRemote");
  else if (feedback === "saved") statusText = online ? t("saved") : t("savedOffline");
  else if (dirty) statusText = t("dirty");
  else if (remote.eventAt) statusText = `${t("savedAt")} ${formatSavedTime(remote.eventAt)}`;

  return (
    <main class="popup-shell" aria-busy={operation !== "idle" || loadStatus === "loading"}>
      <header class="popup-header">
        <div class="brand-block">
          <span class="brand-mark">
            <BrandMark size={36} />
          </span>
          <div>
            <h1>{t("sharedText")}</h1>
            <div class={`sync-chip ${online ? "" : "sync-chip--offline"}`}>
              <span class="sync-chip__dot" aria-hidden="true" />
              {online ? t("networkOnline") : t("networkOffline")}
            </div>
          </div>
        </div>
        <div class="header-actions">
          {settings?.encryption.enabled && !remote.locked && (
            <button
              class="icon-button"
              type="button"
              aria-label={t("lockNow")}
              disabled={operation !== "idle"}
              onClick={handleLockNow}
            >
              <LockIcon />
            </button>
          )}
          <button
            class="icon-button"
            type="button"
            aria-label={t("openSettings")}
            disabled={operation !== "idle"}
            onClick={() => void chrome.runtime.openOptionsPage()}
          >
            <SettingsIcon />
          </button>
        </div>
      </header>

      {!online && (
        <div class="notice notice--warning" role="status">
          <AlertIcon size={18} />
          <span>{t("offline")}</span>
        </div>
      )}

      {remote.invalidItemCount > 0 && (
        <div class="notice notice--warning" role="status">
          <AlertIcon size={18} />
          <span>{t("invalidData")}</span>
        </div>
      )}

      {loadStatus === "loading" && (
        <div class="loading-state" role="status" aria-live="polite">
          <span class="spinner" aria-hidden="true" />
          {t("loading")}
        </div>
      )}

      {loadStatus === "error" && (
        <div class="error-state" role="alert">
          <AlertIcon size={22} />
          <div>
            <strong>{t("loadError")}</strong>
            <p>{errorMessage}</p>
            <button class="button button--secondary" type="button" onClick={() => void load()}>
              {t("retry")}
            </button>
          </div>
        </div>
      )}

      {loadStatus === "ready" && remote.locked && (
        <section class="locked-state" aria-labelledby="locked-title">
          <span class="locked-state__icon">
            <LockIcon size={24} />
          </span>
          <h2 id="locked-title">{t("lockedTitle")}</h2>
          <p id="locked-help">{t("lockedBody")}</p>
          <form aria-busy={operation === "unlocking"} onSubmit={handleUnlock}>
            <label for="unlock-passphrase">{t("passphrase")}</label>
            <input
              id="unlock-passphrase"
              type={showUnlockPassphrase ? "text" : "password"}
              value={passphrase}
              onInput={(event) => setPassphrase(event.currentTarget.value)}
              onKeyDown={updateCapsLock}
              onKeyUp={updateCapsLock}
              autocomplete="current-password"
              autocapitalize="off"
              spellcheck={false}
              required
              autofocus
              disabled={operation === "unlocking"}
              aria-invalid={Boolean(errorMessage)}
              aria-describedby="locked-help unlock-state"
            />
            <button
              class="unlock-visibility"
              type="button"
              aria-pressed={showUnlockPassphrase}
              disabled={operation === "unlocking"}
              onClick={() => setShowUnlockPassphrase((visible) => !visible)}
            >
              {showUnlockPassphrase ? t("hidePassphrase") : t("showPassphrase")}
            </button>
            <div id="unlock-state">
              {capsLock && <p class="field-warning">{t("capsLockOn")}</p>}
              {errorMessage && (
                <p class="field-error" role="alert">
                  {errorMessage}
                </p>
              )}
            </div>
            <button
              class="button button--primary button--full"
              type="submit"
              disabled={!passphrase || operation === "unlocking"}
            >
              {operation === "unlocking" && <span class="spinner" aria-hidden="true" />}
              {operation === "unlocking" ? t("unlocking") : t("unlock")}
            </button>
          </form>
        </section>
      )}

      {loadStatus === "ready" && !remote.locked && (
        <div class="popup-content">
          <section class="editor-section">
            <div class="field-heading">
              <label for="shared-text">{t("content")}</label>
              <span
                id="editor-counter"
                class={`byte-counter ${tooLarge ? "byte-counter--error" : ""}`}
              >
                {byteLength.toLocaleString(language)} / {MAX_TEXT_BYTES.toLocaleString(language)}{" "}
                {t("byteUnit")}
              </span>
            </div>
            <textarea
              ref={textareaRef}
              id="shared-text"
              value={text}
              dir="auto"
              rows={7}
              placeholder={t("placeholder")}
              aria-describedby="editor-help editor-counter editor-status"
              aria-invalid={tooLarge}
              disabled={operation === "clearing" || operation === "locking"}
              autocomplete="off"
              autocapitalize="off"
              spellcheck={false}
              onInput={(event) => handleTextInput(event.currentTarget.value)}
              onKeyDown={handleEditorKeyDown}
            />
            <div id="editor-help" class="editor-helper">
              {text.length === 0 && !dirty ? t("emptyHelper") : "⌘/Ctrl + Enter"}
            </div>
            {tooLarge && (
              <p class="field-error" role="alert">
                {t("tooLarge")}
              </p>
            )}
            {draftTooLarge && (
              <p class="field-error" role="alert">
                {t("draftTooLarge")}
              </p>
            )}
          </section>

          {conflict && (
            <section class="conflict-panel" aria-labelledby="conflict-title">
              <div class="conflict-panel__heading">
                <AlertIcon size={20} />
                <div>
                  <h2 id="conflict-title">{t("conflictTitle")}</h2>
                  <p>{t("conflictBody")}</p>
                </div>
              </div>
              <div class="incoming-preview">
                <span>{t("incoming")}</span>
                <pre dir="auto">{conflict.text || t("incomingEmpty")}</pre>
              </div>
              <div class="conflict-actions">
                <button
                  class="button button--secondary"
                  type="button"
                  disabled={operation !== "idle"}
                  onClick={useIncoming}
                >
                  {t("useIncoming")}
                </button>
                <button
                  class="button button--primary"
                  type="button"
                  disabled={tooLarge || text.length === 0 || operation !== "idle"}
                  onClick={() => void performSave(true)}
                >
                  {t("keepMine")}
                </button>
              </div>
            </section>
          )}

          {errorMessage && (
            <div class="inline-error" role="alert">
              <AlertIcon size={18} />
              <span>{errorMessage}</span>
            </div>
          )}

          <div
            id="editor-status"
            class="status-line"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {feedback === "saved" && <CheckIcon size={17} />}
            <span>{statusText}</span>
          </div>

          {confirmingClear ? (
            <section
              class="clear-confirm"
              aria-labelledby="clear-title"
              aria-busy={operation === "clearing"}
            >
              <div>
                <h2 id="clear-title">{t("clearTitle")}</h2>
                <p>{t("clearDetail")}</p>
              </div>
              <div class="clear-confirm__actions">
                <button
                  ref={cancelClearRef}
                  class="button button--secondary"
                  type="button"
                  disabled={operation !== "idle"}
                  onClick={cancelClear}
                >
                  {t("cancel")}
                </button>
                <button
                  class="button button--danger"
                  type="button"
                  disabled={operation === "clearing"}
                  onClick={() => void handleClear()}
                >
                  {t("confirmClear")}
                </button>
              </div>
            </section>
          ) : (
            <div class="action-bar">
              <button
                class="button button--primary action-bar__primary"
                type="button"
                disabled={!canSave}
                onClick={() => void performSave()}
              >
                {operation === "saving" ? (
                  <span class="spinner" aria-hidden="true" />
                ) : (
                  <CheckIcon size={18} />
                )}
                {operation === "saving" ? t("saving") : t("save")}
              </button>
              <button
                class="button button--secondary action-bar__copy"
                type="button"
                disabled={!text || operation !== "idle"}
                onClick={() => void handleCopy()}
              >
                <CopyIcon size={18} />
                {t("copy")}
              </button>
              {(text || remote.note) && (
                <button
                  ref={clearButtonRef}
                  class="icon-button action-bar__clear"
                  type="button"
                  aria-label={t("clear")}
                  disabled={operation !== "idle"}
                  onClick={() => setConfirmingClear(true)}
                >
                  <TrashIcon />
                </button>
              )}
            </div>
          )}

          <footer
            class={`security-note ${settings?.encryption.enabled ? "security-note--private" : ""}`}
          >
            {settings?.encryption.enabled ? <LockIcon size={16} /> : <AlertIcon size={16} />}
            <span>
              {settings?.encryption.enabled ? t("privateSecurity") : t("standardSecurity")}
            </span>
          </footer>
        </div>
      )}
    </main>
  );
}
