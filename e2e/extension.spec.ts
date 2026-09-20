import { expect, test, type BrowserContext } from "@playwright/test";
import { chromium } from "playwright";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const extensionPath = resolve(projectRoot, process.env.EXTENSION_PATH ?? "dist");
const expectedExtensionId = process.env.EXPECTED_EXTENSION_ID;
let context: BrowserContext;
let extensionId: string;
const hostilePayload = '<img src=x onerror="alert(1)"><script>alert(2)</script> · Tiếng Việt 😀';

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  let [serviceWorker] = context.serviceWorkers();
  serviceWorker ??= await context.waitForEvent("serviceworker");
  extensionId = new URL(serviceWorker.url()).host;
  if (expectedExtensionId && extensionId !== expectedExtensionId) {
    throw new Error(
      `Loaded extension ID ${extensionId}; expected pinned ID ${expectedExtensionId}.`,
    );
  }
});

test.afterAll(async () => {
  await context?.close();
});

test("loads the production package and shares inert text across popup instances", async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(page.getByRole("heading", { name: "Shared text" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page).toHaveTitle("Textpipe");
  const manifest = await page.evaluate(() => chrome.runtime.getManifest());
  expect(manifest.permissions).toEqual(["storage", "alarms", "contextMenus"]);
  expect(manifest.host_permissions).toBeUndefined();
  expect(manifest.content_scripts).toBeUndefined();
  expect(manifest.externally_connectable).toBeUndefined();

  await page.getByLabel("Content").fill(hostilePayload);
  await expect(page.getByText("Unsaved draft")).toBeVisible();
  await page.getByRole("button", { name: "Save to sync" }).click();
  await expect(page.getByText("Saved on this device for Chrome to sync")).toBeVisible();
  const images = page.locator("img");
  await expect(images).toHaveCount(1);
  await expect(images.first()).toHaveAttribute("src", "icons/icon-128.png");
  const logo = await images.first().evaluate((image: HTMLImageElement) => ({
    host: new URL(image.src).host,
    naturalHeight: image.naturalHeight,
    naturalWidth: image.naturalWidth,
    protocol: new URL(image.src).protocol,
  }));
  expect(logo).toEqual({
    host: extensionId,
    naturalHeight: 128,
    naturalWidth: 128,
    protocol: "chrome-extension:",
  });
  await expect(page.locator("script:not([type=module])")).toHaveCount(0);

  const receivingPopup = await context.newPage();
  await receivingPopup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(receivingPopup.getByLabel("Content")).toHaveValue(hostilePayload);
  await receivingPopup.close();
  await page.close();
});

test("shows one unread badge for a remote revision and clears it after reading", async () => {
  const harness = await context.newPage();
  await harness.goto(`chrome-extension://${extensionId}/options.html`);
  const remotePayload = "New text from the other device · Máy Windows";
  await harness.evaluate(async (content) => {
    const revision = crypto.randomUUID();
    const createdAt = Date.now() + 100;
    await chrome.storage.sync.set({
      [`textpipe.note.v1.${revision}`]: {
        schemaVersion: 1,
        revision,
        kind: "plain",
        content,
        sourceId: "e2e-remote-device",
        createdAt,
        updatedAt: createdAt,
        expiresAt: createdAt + 24 * 60 * 60 * 1_000,
      },
    });
  }, remotePayload);

  await expect.poll(() => harness.evaluate(() => chrome.action.getBadgeText({}))).toBe("1");
  await expect.poll(() => harness.evaluate(() => chrome.action.getTitle({}))).toContain("New");

  const receiver = await context.newPage();
  await receiver.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(receiver.getByLabel("Content")).toHaveValue(remotePayload);
  await expect.poll(() => receiver.evaluate(() => chrome.action.getBadgeText({}))).toBe("");

  // Restore the fixture expected by the private-mode migration test below.
  await receiver.getByLabel("Content").fill(hostilePayload);
  await receiver.getByRole("button", { name: "Save to sync" }).click();
  await expect(receiver.getByText("Saved on this device for Chrome to sync")).toBeVisible();
  await receiver.close();
  await harness.close();
});

test("opens the settings surface with transparent permission disclosures", async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(page.getByRole("heading", { name: "Textpipe settings" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page).toHaveTitle("Settings · Textpipe");
  await expect(page.getByText("1.0.0", { exact: true })).toBeVisible();
  await expect(page.getByText(extensionId, { exact: true })).toBeVisible();
  await expect(
    page.getByText("Chrome Sync controls latency and provides no receipt from the other device."),
  ).toBeVisible();
  await expect(page.getByText("No automatic website access")).toBeVisible();
  await expect(page.getByText("Storage", { exact: true })).toBeVisible();
  await expect(page.getByText("Alarms", { exact: true })).toBeVisible();
  await expect(page.getByText("Context menus", { exact: true })).toBeVisible();
});

test("migrates active content to the private epoch and encrypts private drafts", async () => {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.getByRole("button", { name: "Turn on private lock" }).click();
  await expect(options.getByLabel("New passphrase")).toBeFocused();
  await options.getByLabel("New passphrase").fill("correct horse battery staple");
  await options.getByLabel("Confirm passphrase").fill("correct horse battery staple");
  await options.getByRole("button", { name: "Turn on private lock" }).click();
  await expect(options.locator(".options-toast")).toContainText("Private lock is on.");

  const synced = await options.evaluate(async () => chrome.storage.sync.get(null));
  const activeSecurity = synced["textpipe.security.v2"] as { revision?: string } | undefined;
  expect(activeSecurity?.revision).toBeTruthy();
  const notes = Object.entries(synced)
    .filter(
      ([key, value]) =>
        key.startsWith("textpipe.note.v2.") &&
        (value as { securityRevision?: string }).securityRevision === activeSecurity?.revision,
    )
    .map(([, value]) => value as { kind?: string; content?: string; ciphertext?: string });
  expect(notes).toHaveLength(1);
  expect(notes[0]).toMatchObject({ kind: "encrypted" });
  expect(notes[0]).not.toHaveProperty("content");
  expect(JSON.stringify(notes)).not.toContain(hostilePayload);

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.locator("textarea#shared-text")).toHaveValue(hostilePayload);
  const unsavedPrivateDraft = `${hostilePayload} · unsaved private draft`;
  await popup.locator("textarea#shared-text").fill(unsavedPrivateDraft);
  await popup.getByRole("button", { name: "Lock now" }).click();
  await expect(popup.getByRole("heading", { name: "Content is locked" })).toBeVisible();
  const session = await popup.evaluate(async () => chrome.storage.session.get(null));
  expect(JSON.stringify(session)).not.toContain(unsavedPrivateDraft);
  await popup.getByLabel("Passphrase").fill("correct horse battery staple");
  await popup.getByRole("button", { name: "Unlock" }).click();
  await expect(popup.locator("textarea#shared-text")).toHaveValue(unsavedPrivateDraft);
});

test("has no horizontal overflow across popup and options breakpoints", async ({
  browserName: _browserName,
}, testInfo) => {
  const popup = await context.newPage();
  for (const width of [320, 360, 390, 430]) {
    await popup.setViewportSize({ width, height: 600 });
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popup.getByRole("button", { name: "Save to sync" })).toBeVisible();
    const overflows = await popup.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows, `popup overflows at ${width}px`).toBe(false);
  }

  await popup.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await popup.setViewportSize({ width: 380, height: 600 });
  await expect(popup.locator("body")).toHaveCSS("background-color", "rgb(13, 14, 18)");
  await expect(popup.getByLabel("Content")).toHaveCSS("color", "rgb(235, 236, 239)");
  await expect(popup.getByRole("button", { name: "Copy" })).toHaveCSS(
    "background-color",
    "rgb(30, 31, 37)",
  );
  await expect(popup.getByLabel("Content")).toHaveCSS("border-color", "rgb(41, 44, 50)");
  const fontAudit = await popup.evaluate(async () => {
    const sample = document.createElement("span");
    sample.textContent = "Textpipe · Ơ ư ế ệ ờ ợ · Ā";
    document.body.append(sample);
    sample.getBoundingClientRect();
    const loadedFaces = await document.fonts.load(
      '400 14px "Plus Jakarta Sans Variable"',
      sample.textContent,
    );
    await document.fonts.ready;
    const result = {
      loadedFaceCount: loadedFaces.length,
      loadedFaceStatuses: loadedFaces.map((face) => face.status),
      family: getComputedStyle(sample).fontFamily,
    };
    sample.remove();
    return result;
  });
  expect(fontAudit.loadedFaceCount).toBeGreaterThanOrEqual(2);
  expect(fontAudit.loadedFaceStatuses.every((status) => status === "loaded")).toBe(true);
  expect(fontAudit.family).toContain("Plus Jakarta Sans Variable");
  const actionOrder = await popup
    .locator(".action-bar button")
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("aria-label") || button.textContent?.trim()),
    );
  expect(actionOrder).toEqual(["Save to sync", "Copy", "Clear shared text"]);
  const undersizedTargets = await popup.locator("button:visible").evaluateAll((buttons) =>
    buttons
      .map((button) => ({
        height: button.getBoundingClientRect().height,
        text: button.getAttribute("aria-label") || button.textContent?.trim(),
        width: button.getBoundingClientRect().width,
      }))
      .filter(({ height, width }) => height < 44 || width < 44),
  );
  expect(undersizedTargets).toEqual([]);
  const reducedMotionAnimation = await popup.evaluate(() => {
    const spinner = document.createElement("span");
    spinner.className = "spinner";
    document.body.append(spinner);
    const animationName = getComputedStyle(spinner).animationName;
    spinner.remove();
    return animationName;
  });
  expect(reducedMotionAnimation).toBe("none");
  await popup.screenshot({ path: testInfo.outputPath("popup-dark.png"), fullPage: true });

  await popup.emulateMedia({ colorScheme: "light", forcedColors: "active" });
  expect(await popup.evaluate(() => matchMedia("(forced-colors: active)").matches)).toBe(true);
  await expect(popup.locator(".popup-header")).toHaveCSS("border-top-style", "solid");

  const options = await context.newPage();
  for (const width of [320, 360, 390, 430, 768, 1280]) {
    await options.setViewportSize({ width, height: 900 });
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await expect(options.getByRole("heading", { name: "Textpipe settings" })).toBeVisible();
    const overflows = await options.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows, `options page overflows at ${width}px`).toBe(false);
  }
  await options.setViewportSize({ width: 1280, height: 900 });
  await expect(options.getByLabel("Retention period")).toHaveCSS("border-color", "rgb(67, 70, 81)");
  const optionsLogo = await options
    .locator(".brand-mark__image")
    .evaluate((image: HTMLImageElement) => ({
      height: image.naturalHeight,
      width: image.naturalWidth,
    }));
  expect(optionsLogo).toEqual({ height: 128, width: 128 });
  await options.screenshot({ path: testInfo.outputPath("options-dark.png"), fullPage: true });
});
