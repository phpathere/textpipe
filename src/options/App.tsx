import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { RETENTION_OPTIONS, STORAGE_KEYS } from "../shared/constants";
import { normalizePassphrase } from "../shared/crypto";
import {
  disableEncryption,
  enableEncryption,
  getCachedSessionKey,
  getSettings,
  lockSession,
  resetSyncedData,
  updateRetention,
} from "../shared/extension-api";
import { createTranslator, getLanguage, getLocalizedErrorMessage } from "../shared/i18n";
import type { RetentionMinutes, SyncSettings } from "../shared/types";
import { AlertIcon, BrandMark, CheckIcon, LockIcon } from "../ui/Icons";
import "../ui/base.css";
import "./options.css";

type ModeForm = "none" | "enable" | "disable";
type BusyState = "idle" | "loading" | "retention" | "enable" | "disable" | "lock" | "reset";

export function App() {
  const language = useMemo(getLanguage, []);
  const t = useMemo(() => createTranslator(language), [language]);
  const [settings, setSettings] = useState<SyncSettings | null>(null);
  const [modeForm, setModeForm] = useState<ModeForm>("none");
  const [busy, setBusy] = useState<BusyState>("loading");
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [keyCached, setKeyCached] = useState(false);
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);

  const firstPassphraseRef = useRef<HTMLInputElement>(null);
  const enableTriggerRef = useRef<HTMLButtonElement>(null);
  const disableTriggerRef = useRef<HTMLButtonElement>(null);
  const lastModeRef = useRef<Exclude<ModeForm, "none">>("enable");
  const restoreModeFocusRef = useRef(false);
  const privacyTitleRef = useRef<HTMLHeadingElement>(null);
  const loadGenerationRef = useRef(0);
  const busyRef = useRef<BusyState>(busy);
  const pendingSettingsRefreshRef = useRef(false);
  const runtimeId = chrome.runtime.id;
  const runtimeVersion = chrome.runtime.getManifest().version;

  function setBusyState(next: BusyState): void {
    busyRef.current = next;
    setBusy(next);
  }

  const refreshSettings = useCallback(
    async (showLoading = false): Promise<boolean> => {
      const generation = ++loadGenerationRef.current;
      if (showLoading) setBusyState("loading");
      setLoadError("");
      try {
        const nextSettings = await getSettings();
        const nextKeyCached = nextSettings.encryption.enabled
          ? Boolean(await getCachedSessionKey(nextSettings.encryption))
          : false;
        if (generation !== loadGenerationRef.current) return false;
        setSettings(nextSettings);
        setKeyCached(nextKeyCached);
        return true;
      } catch (loadFailure) {
        if (generation !== loadGenerationRef.current) return false;
        setLoadError(getLocalizedErrorMessage(loadFailure, t));
        return false;
      } finally {
        if (showLoading && generation === loadGenerationRef.current) setBusyState("idle");
      }
    },
    [t],
  );

  useEffect(() => {
    document.body.classList.add("options-page");
    document.documentElement.lang = language;
    document.title = t("optionsDocumentTitle");
    void refreshSettings(true);
    return () => document.body.classList.remove("options-page");
  }, [language, refreshSettings, t]);

  useEffect(() => {
    const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      const settingsChanged =
        areaName === "sync" &&
        [STORAGE_KEYS.settings, STORAGE_KEYS.retentionSettings, STORAGE_KEYS.securitySettings].some(
          (key) => Object.hasOwn(changes, key),
        );
      const sessionKeyChanged =
        areaName === "session" && Object.hasOwn(changes, STORAGE_KEYS.sessionKey);
      if (!settingsChanged && !sessionKeyChanged) return;
      if (busyRef.current !== "idle") {
        pendingSettingsRefreshRef.current = true;
        return;
      }
      void refreshSettings().then((updated) => {
        if (updated) {
          setError("");
          setMessage(t("settingsUpdatedRemote"));
        }
      });
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [refreshSettings, t]);

  useEffect(() => {
    busyRef.current = busy;
    if (busy !== "idle" || !pendingSettingsRefreshRef.current) return;
    pendingSettingsRefreshRef.current = false;
    // A local settings write fires storage.onChanged before its promise settles.
    // Reconcile queued changes silently so a truthful success message is not
    // replaced with the misleading "changed elsewhere" status.
    void refreshSettings();
  }, [busy, refreshSettings]);

  useEffect(() => {
    if (modeForm !== "none") {
      requestAnimationFrame(() => firstPassphraseRef.current?.focus());
      return;
    }
    if (!restoreModeFocusRef.current) return;
    restoreModeFocusRef.current = false;
    const trigger =
      lastModeRef.current === "enable" ? enableTriggerRef.current : disableTriggerRef.current;
    trigger?.focus();
  }, [modeForm]);

  useEffect(() => {
    if (!settings) return;
    const staleEnableForm = modeForm === "enable" && settings.encryption.enabled;
    const staleDisableForm = modeForm === "disable" && !settings.encryption.enabled;
    if (!staleEnableForm && !staleDisableForm) return;
    setModeForm("none");
    setPassphrase("");
    setConfirmation("");
    setShowPassphrase(false);
    setCapsLock(false);
    setError("");
    requestAnimationFrame(() => privacyTitleRef.current?.focus());
  }, [modeForm, settings]);

  function resetForm(restoreFocus = false): void {
    restoreModeFocusRef.current = restoreFocus;
    setModeForm("none");
    setPassphrase("");
    setConfirmation("");
    setShowPassphrase(false);
    setCapsLock(false);
    setError("");
  }

  function finishModeSuccess(): void {
    resetForm();
    requestAnimationFrame(() => privacyTitleRef.current?.focus());
  }

  function openMode(mode: Exclude<ModeForm, "none">): void {
    lastModeRef.current = mode;
    setMessage("");
    setError("");
    setModeForm(mode);
  }

  function updateCapsLock(event: KeyboardEvent): void {
    setCapsLock(event.getModifierState("CapsLock"));
  }

  function retentionCopy(value: RetentionMinutes): string {
    if (value === 60) return `${t("retentionOneHour")} · ${t("retentionOneHourBody")}`;
    if (value === 1_440) return `${t("retentionOneDay")} · ${t("retentionRecommended")}`;
    if (value === 10_080) return `${t("retentionOneWeek")} · ${t("retentionOneWeekBody")}`;
    return `${t("retentionNever")} · ${t("retentionNeverBody")}`;
  }

  async function handleRetention(value: string): Promise<void> {
    const retention = value === "never" ? null : (Number(value) as RetentionMinutes);
    setBusyState("retention");
    setError("");
    setMessage("");
    try {
      const next = await updateRetention(retention);
      setSettings(next);
      setMessage(t("retentionSaved"));
    } catch (saveError) {
      setError(getLocalizedErrorMessage(saveError, t));
    } finally {
      setBusyState("idle");
    }
  }

  async function handleEnable(event: Event): Promise<void> {
    event.preventDefault();
    if (normalizePassphrase(passphrase) !== normalizePassphrase(confirmation)) {
      setError(t("passphraseMismatch"));
      return;
    }
    setBusyState("enable");
    setError("");
    setMessage("");
    try {
      const next = await enableEncryption(passphrase);
      setSettings(next);
      setKeyCached(
        next.encryption.enabled
          ? Boolean(await getCachedSessionKey(next.encryption).catch(() => null))
          : false,
      );
      setMessage(t("privateEnabled"));
      finishModeSuccess();
    } catch (enableError) {
      setError(getLocalizedErrorMessage(enableError, t));
    } finally {
      setBusyState("idle");
    }
  }

  async function handleDisable(event: Event): Promise<void> {
    event.preventDefault();
    setBusyState("disable");
    setError("");
    setMessage("");
    try {
      const next = await disableEncryption(passphrase);
      setSettings(next);
      setKeyCached(false);
      setMessage(t("privateDisabled"));
      finishModeSuccess();
    } catch (disableError) {
      setError(getLocalizedErrorMessage(disableError, t));
    } finally {
      setBusyState("idle");
    }
  }

  async function handleLock(): Promise<void> {
    setBusyState("lock");
    setError("");
    setMessage("");
    try {
      await lockSession();
      setKeyCached(false);
      setMessage(t("lockSessionDone"));
    } catch (lockError) {
      setError(getLocalizedErrorMessage(lockError, t));
    } finally {
      setBusyState("idle");
    }
  }

  async function handleCopyId(): Promise<void> {
    setError("");
    try {
      await navigator.clipboard.writeText(runtimeId);
      setMessage(t("idCopied"));
    } catch (copyError) {
      setError(getLocalizedErrorMessage(copyError, t));
    }
  }

  async function handleReset(): Promise<void> {
    setBusyState("reset");
    setError("");
    try {
      const next = await resetSyncedData();
      setSettings(next);
      setKeyCached(false);
      setLoadError("");
      setConfirmReset(false);
      setMessage(t("resetDone"));
    } catch (resetError) {
      setError(getLocalizedErrorMessage(resetError, t));
    } finally {
      setBusyState("idle");
    }
  }

  if (!settings && busy === "loading" && !loadError) {
    return (
      <main class="options-shell options-shell--loading" role="status">
        <span class="spinner" aria-hidden="true" />
        {t("loading")}
      </main>
    );
  }

  return (
    <main class="options-shell" aria-busy={busy !== "idle"}>
      <header class="options-header">
        <div class="options-brand">
          <span class="brand-mark">
            <BrandMark size={44} />
          </span>
          <div>
            <h1>{t("optionsTitle")}</h1>
            <p>{t("optionsSubtitle")}</p>
          </div>
        </div>
        <button
          class="button button--secondary"
          type="button"
          disabled={busy !== "idle"}
          onClick={() => window.close()}
        >
          {t("done")}
        </button>
      </header>

      {message && (
        <div class="options-toast" role="status" aria-live="polite">
          <CheckIcon size={18} />
          <span>{message}</span>
        </div>
      )}
      {(loadError || (error && modeForm === "none")) && (
        <div class="options-error" role="alert">
          <AlertIcon size={18} />
          <div>
            <strong>{loadError ? t("optionsLoadError") : error}</strong>
            {loadError && <p>{error || loadError}</p>}
            {loadError && !confirmReset && (
              <div class="recovery-actions">
                <button
                  class="button button--secondary"
                  type="button"
                  disabled={busy !== "idle"}
                  onClick={() => void refreshSettings(true)}
                >
                  {t("retry")}
                </button>
                <button
                  class="button button--secondary button--danger-text"
                  type="button"
                  disabled={busy !== "idle"}
                  onClick={() => setConfirmReset(true)}
                >
                  {t("resetData")}
                </button>
              </div>
            )}
            {loadError && confirmReset && (
              <div class="recovery-confirm">
                <strong>{t("resetDataTitle")}</strong>
                <p>{t("resetDataBody")}</p>
                <div class="recovery-actions">
                  <button
                    class="button button--secondary"
                    type="button"
                    disabled={busy !== "idle"}
                    onClick={() => setConfirmReset(false)}
                  >
                    {t("cancel")}
                  </button>
                  <button
                    class="button button--danger"
                    type="button"
                    disabled={busy !== "idle"}
                    onClick={() => void handleReset()}
                  >
                    {t("confirmResetData")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {settings && (
        <div class="settings-grid">
          <section class="settings-card settings-card--sync" aria-labelledby="sync-setup-title">
            <div class="settings-card__heading">
              <div>
                <h2 id="sync-setup-title">{t("syncSetupTitle")}</h2>
                <p>{t("syncSetupBody")}</p>
              </div>
            </div>
            <ol class="setup-list">
              <li>{t("syncStepAccount")}</li>
              <li>{t("syncStepEnabled")}</li>
              <li>{t("syncStepRelease")}</li>
            </ol>
            <dl class="diagnostics-list">
              <div>
                <dt>{t("extensionVersion")}</dt>
                <dd>
                  <code>{runtimeVersion}</code>
                </dd>
              </div>
              <div>
                <dt>{t("extensionId")}</dt>
                <dd class="diagnostic-id">
                  <code dir="ltr">{runtimeId}</code>
                  <button
                    class="button button--secondary button--compact"
                    type="button"
                    disabled={busy !== "idle"}
                    onClick={() => void handleCopyId()}
                  >
                    {t("copyId")}
                  </button>
                </dd>
              </div>
            </dl>
            <p class="delivery-note">
              <AlertIcon size={16} />
              <span>{t("deliveryLimit")}</span>
            </p>
          </section>

          <section class="settings-card settings-card--retention" aria-labelledby="retention-title">
            <div class="settings-card__heading">
              <div>
                <h2 id="retention-title">{t("retentionTitle")}</h2>
                <p>{t("retentionBody")}</p>
              </div>
            </div>
            <label class="select-field" for="retention-select">
              <span>{t("retentionLabel")}</span>
              <select
                id="retention-select"
                value={
                  settings.retentionMinutes === null ? "never" : String(settings.retentionMinutes)
                }
                disabled={busy !== "idle"}
                onChange={(event) => void handleRetention(event.currentTarget.value)}
              >
                {RETENTION_OPTIONS.map((option) => (
                  <option
                    key={String(option.value)}
                    value={option.value === null ? "never" : option.value}
                  >
                    {retentionCopy(option.value)}
                  </option>
                ))}
              </select>
            </label>
          </section>

          <section class="settings-card settings-card--privacy" aria-labelledby="privacy-title">
            <div class="settings-card__heading settings-card__heading--icon">
              <span
                class={`feature-icon ${settings.encryption.enabled ? "feature-icon--active" : ""}`}
              >
                <LockIcon size={22} />
              </span>
              <div>
                <h2 id="privacy-title" ref={privacyTitleRef} tabindex={-1}>
                  {t("privacyTitle")}
                </h2>
                <p>{settings.encryption.enabled ? t("privateModeBody") : t("standardModeBody")}</p>
              </div>
            </div>

            <div class="mode-status">
              <span
                class={`mode-status__dot ${settings.encryption.enabled ? "mode-status__dot--active" : ""}`}
                aria-hidden="true"
              />
              <strong>{settings.encryption.enabled ? t("privateMode") : t("standardMode")}</strong>
              {settings.encryption.enabled && (
                <span class="session-state">{keyCached ? t("unlocked") : t("lockedTitle")}</span>
              )}
            </div>

            {modeForm === "none" && !settings.encryption.enabled && (
              <div class="card-actions">
                <button
                  ref={enableTriggerRef}
                  class="button button--primary"
                  type="button"
                  disabled={busy !== "idle"}
                  onClick={() => openMode("enable")}
                >
                  <LockIcon size={18} />
                  {t("enablePrivate")}
                </button>
              </div>
            )}

            {modeForm === "none" && settings.encryption.enabled && (
              <div class="card-actions card-actions--split">
                <button
                  class="button button--secondary"
                  type="button"
                  disabled={!keyCached || busy !== "idle"}
                  onClick={() => void handleLock()}
                >
                  {t("lockNow")}
                </button>
                <button
                  ref={disableTriggerRef}
                  class="button button--secondary button--danger-text"
                  type="button"
                  disabled={busy !== "idle"}
                  onClick={() => openMode("disable")}
                >
                  {t("disablePrivate")}
                </button>
              </div>
            )}

            {modeForm === "enable" && (
              <form class="security-form" aria-busy={busy === "enable"} onSubmit={handleEnable}>
                <div class="form-intro">
                  <strong>{t("enablePrivateTitle")}</strong>
                  <p>{t("enablePrivateBody")}</p>
                </div>
                <label for="new-passphrase">
                  <span>{t("newPassphrase")}</span>
                  <input
                    ref={firstPassphraseRef}
                    id="new-passphrase"
                    type={showPassphrase ? "text" : "password"}
                    value={passphrase}
                    minlength={12}
                    maxlength={128}
                    autocomplete="new-password"
                    autocapitalize="off"
                    spellcheck={false}
                    required
                    aria-invalid={Boolean(error)}
                    aria-describedby="passphrase-hint passphrase-state"
                    disabled={busy !== "idle"}
                    onInput={(event) => setPassphrase(event.currentTarget.value)}
                    onKeyDown={updateCapsLock}
                    onKeyUp={updateCapsLock}
                  />
                </label>
                <label for="confirm-passphrase">
                  <span>{t("confirmPassphrase")}</span>
                  <input
                    id="confirm-passphrase"
                    type={showPassphrase ? "text" : "password"}
                    value={confirmation}
                    minlength={12}
                    maxlength={128}
                    autocomplete="new-password"
                    autocapitalize="off"
                    spellcheck={false}
                    required
                    aria-invalid={Boolean(error)}
                    aria-describedby="passphrase-hint passphrase-state"
                    disabled={busy !== "idle"}
                    onInput={(event) => setConfirmation(event.currentTarget.value)}
                    onKeyDown={updateCapsLock}
                    onKeyUp={updateCapsLock}
                  />
                </label>
                <button
                  class="password-visibility"
                  type="button"
                  aria-pressed={showPassphrase}
                  disabled={busy !== "idle"}
                  onClick={() => setShowPassphrase((visible) => !visible)}
                >
                  {showPassphrase ? t("hidePassphrase") : t("showPassphrase")}
                </button>
                <p id="passphrase-hint" class="form-hint">
                  {t("passphraseHint")}
                </p>
                <div id="passphrase-state">
                  {capsLock && <p class="form-warning">{t("capsLockOn")}</p>}
                  {error && (
                    <p class="form-error" role="alert">
                      {error}
                    </p>
                  )}
                </div>
                <div class="form-actions">
                  <button
                    class="button button--secondary"
                    type="button"
                    disabled={busy !== "idle"}
                    onClick={() => resetForm(true)}
                  >
                    {t("cancel")}
                  </button>
                  <button class="button button--primary" type="submit" disabled={busy !== "idle"}>
                    {busy === "enable" && <span class="spinner" aria-hidden="true" />}
                    {busy === "enable" ? t("enablingPrivate") : t("enablePrivate")}
                  </button>
                </div>
              </form>
            )}

            {modeForm === "disable" && (
              <form
                class="security-form security-form--danger"
                aria-busy={busy === "disable"}
                onSubmit={handleDisable}
              >
                <div class="form-intro">
                  <strong>{t("disablePrivateTitle")}</strong>
                  <p>{t("disablePrivateBody")}</p>
                </div>
                <label for="current-passphrase">
                  <span>{t("currentPassphrase")}</span>
                  <input
                    ref={firstPassphraseRef}
                    id="current-passphrase"
                    type={showPassphrase ? "text" : "password"}
                    value={passphrase}
                    minlength={12}
                    maxlength={128}
                    autocomplete="current-password"
                    autocapitalize="off"
                    spellcheck={false}
                    required
                    aria-invalid={Boolean(error)}
                    aria-describedby="disable-passphrase-state"
                    disabled={busy !== "idle"}
                    onInput={(event) => setPassphrase(event.currentTarget.value)}
                    onKeyDown={updateCapsLock}
                    onKeyUp={updateCapsLock}
                  />
                </label>
                <button
                  class="password-visibility"
                  type="button"
                  aria-pressed={showPassphrase}
                  disabled={busy !== "idle"}
                  onClick={() => setShowPassphrase((visible) => !visible)}
                >
                  {showPassphrase ? t("hidePassphrase") : t("showPassphrase")}
                </button>
                <div id="disable-passphrase-state">
                  {capsLock && <p class="form-warning">{t("capsLockOn")}</p>}
                  {error && (
                    <p class="form-error" role="alert">
                      {error}
                    </p>
                  )}
                </div>
                <div class="form-actions">
                  <button
                    class="button button--secondary"
                    type="button"
                    disabled={busy !== "idle"}
                    onClick={() => resetForm(true)}
                  >
                    {t("cancel")}
                  </button>
                  <button class="button button--danger" type="submit" disabled={busy !== "idle"}>
                    {busy === "disable" ? t("disablingPrivate") : t("disablePrivate")}
                  </button>
                </div>
              </form>
            )}
          </section>

          <section class="settings-card settings-card--data" aria-labelledby="data-title">
            <div class="settings-card__heading">
              <div>
                <h2 id="data-title">{t("dataTitle")}</h2>
                <p>{t("dataBody")}</p>
              </div>
            </div>
            <dl class="permission-list">
              <div>
                <dt>{t("storagePermission")}</dt>
                <dd>{t("storagePermissionBody")}</dd>
              </div>
              <div>
                <dt>{t("alarmsPermission")}</dt>
                <dd>{t("alarmsPermissionBody")}</dd>
              </div>
              <div>
                <dt>{t("contextMenusPermission")}</dt>
                <dd>{t("contextMenusPermissionBody")}</dd>
              </div>
              <div>
                <dt>{t("noSiteAccess")}</dt>
                <dd>{t("noSiteAccessBody")}</dd>
              </div>
            </dl>
          </section>

          <section
            class="settings-card settings-card--limitations"
            aria-labelledby="limitations-title"
          >
            <div class="settings-card__heading">
              <div>
                <h2 id="limitations-title">{t("limitationsTitle")}</h2>
              </div>
            </div>
            <ul class="limitations-list">
              <li>{t("limitationSync")}</li>
              <li>{t("limitationDelete")}</li>
            </ul>
            {!loadError && (
              <div class="data-reset">
                <p>{t("resetDataHint")}</p>
                {!confirmReset ? (
                  <button
                    class="button button--secondary button--danger-text"
                    type="button"
                    disabled={busy !== "idle"}
                    onClick={() => setConfirmReset(true)}
                  >
                    {t("resetData")}
                  </button>
                ) : (
                  <div class="recovery-confirm">
                    <strong>{t("resetDataTitle")}</strong>
                    <p>{t("resetDataBody")}</p>
                    <div class="recovery-actions">
                      <button
                        class="button button--secondary"
                        type="button"
                        disabled={busy !== "idle"}
                        onClick={() => setConfirmReset(false)}
                      >
                        {t("cancel")}
                      </button>
                      <button
                        class="button button--danger"
                        type="button"
                        disabled={busy !== "idle"}
                        onClick={() => void handleReset()}
                      >
                        {t("confirmResetData")}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
