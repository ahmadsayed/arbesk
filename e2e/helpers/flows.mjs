import { expect } from "@playwright/test";
import { injectHardhatProvider } from "../fixtures/hardhat-provider.mjs";
import { HARDHAT_ACCOUNTS } from "../fixtures/multi-wallet.mjs";
import { SELECTORS } from "./studio-selectors.mjs";
import { MANIFEST_URL_REGEX, manifestCidFromUrl } from "./manifest.mjs";

/**
 * @typedef {import('@playwright/test').Page} Page
 * @typedef {import('@playwright/test').Locator} Locator
 */

const DEFAULT_PROMPT = "cowboy";

/**
 * Open the studio with the Hardhat dev wallet injected, click Login / Signup,
 * select the injected wallet, and wait until authenticated (the connect button
 * hides; the wallet button stops showing "Sign In").
 *
 * @param {Page} page
 */
export async function connectStudio(page) {
  await injectHardhatProvider(page);
  await page.goto("/studio");

  // The Studio auto-connects a previously authorized / injected wallet on page
  // load. Wait briefly for the connect button to disappear; if it does not,
  // fall back to the manual Login / Signup flow.
  const connectBtn = page.locator(SELECTORS.connectWalletBtn);
  try {
    await expect(connectBtn).toBeHidden({ timeout: 8000 });
  } catch {
    await connectBtn.click();
    await page.locator(SELECTORS.hardhatWalletOption).click();
    await expect(connectBtn).toBeHidden();
  }

  await expect(page.locator(SELECTORS.disconnectWalletBtn)).not.toContainText(
    "Sign In",
  );
}

/**
 * Connect the Studio as a specific Hardhat dev account (index 0, 1, 2…).
 * Useful for multi-wallet E2E scenarios where each wallet needs its own
 * browser context to keep sessions and localStorage isolated.
 *
 * @param {Page} page
 * @param {number} accountIndex
 */
export async function connectStudioAs(page, accountIndex) {
  const account = HARDHAT_ACCOUNTS[accountIndex];
  if (!account) {
    throw new Error(`Unknown Hardhat account index ${accountIndex}`);
  }
  await injectHardhatProvider(page, { accountIndex });
  await page.goto("/studio");

  // Auto-connect on page load: wait for the connect button to hide; if it
  // stays visible, use the manual Login / Signup fallback.
  const connectBtn = page.locator(SELECTORS.connectWalletBtn);
  try {
    await expect(connectBtn).toBeHidden({ timeout: 8000 });
  } catch {
    await connectBtn.click();
    await page.locator(SELECTORS.hardhatWalletOption).click();
    await expect(connectBtn).toBeHidden();
  }

  // Wait for SIWE auth to complete (button no longer shows "Sign In")…
  await expect(page.locator(SELECTORS.disconnectWalletBtn)).not.toContainText(
    "Sign In",
  );
  // …and confirm we connected as the expected account.
  await expect(page.locator(SELECTORS.disconnectWalletBtn)).toContainText(
    truncateAddress(account.address),
  );
}

/**
 * Ensure the Studio is connected on the current page. The Studio no longer
 * auto-connects EOA wallets on page load, so tests that navigate to a fresh
 * Studio tab must explicitly connect after the navigation.
 *
 * @param {Page} page
 */
export async function ensureStudioConnected(page) {
  const connectBtn = page.locator(SELECTORS.connectWalletBtn);
  try {
    await expect(connectBtn).toBeHidden({ timeout: 3000 });
    return;
  } catch {
    // not connected - use the manual Login / Signup flow
  }
  await connectBtn.click();
  await page.locator(SELECTORS.hardhatWalletOption).click();
  await expect(connectBtn).toBeHidden();
  await expect(page.locator(SELECTORS.disconnectWalletBtn)).not.toContainText(
    "Sign In",
  );
}

/**
 * Ensure the Library is connected on the current page. Like the Studio, the
 * Library no longer auto-connects EOA wallets on page load.
 *
 * @param {Page} page
 */
export async function ensureLibraryConnected(page) {
  const libraryGate = page.locator(SELECTORS.libraryGate);
  try {
    await expect(libraryGate).toBeHidden({ timeout: 3000 });
    return;
  } catch {
    // not connected - use the library's connect button
  }
  await page.locator(SELECTORS.libraryConnectBtn).click();
  await page.locator(SELECTORS.hardhatWalletOption).click();
  await expect(libraryGate).toBeHidden();
  await expect(page.locator(SELECTORS.libraryMain)).toBeVisible();
}

/**
 * Seed the wallet-derived Default collection on the shared Hardhat chain.
 * Serial library specs can call this in test.beforeAll so they no longer
 * depend on earlier specs having published first.
 *
 * @param {import('@playwright/test').Browser} browser
 * @param {string} [name]
 * @param {string} [prompt]
 * @returns {Promise<string|null>} token id (hex) of the published collection
 */
export async function seedDefaultCollection(
  browser,
  name = uniqueAssetName("Seed Asset"),
  prompt = DEFAULT_PROMPT,
) {
  const page = await browser.newPage();
  try {
    await injectHardhatProvider(page);
    await page.goto("/studio");
    await ensureStudioConnected(page);
    const tokenIdHex = await generateSaveAndPublish(page, name, prompt);
    return tokenIdHex;
  } finally {
    await page.close();
  }
}

/**
 * @param {string} address
 * @returns {string}
 */
function truncateAddress(address) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Generate a mock asset and return the resulting generation manifest CID. The
 * `?manifest=` URL is the durable completion signal - the screen-reader status
 * text is transient and gets overwritten.
 *
 * @param {Page} page
 * @param {string} [prompt]
 * @returns {Promise<string>}
 */
export async function generate(page, prompt = DEFAULT_PROMPT) {
  await page.fill(SELECTORS.promptInput, prompt);
  await page.click(SELECTORS.generateBtn);
  await expect(page.locator(SELECTORS.chatHistoryList)).toContainText(
    "Model carved via mock",
  );
  await page.waitForURL(MANIFEST_URL_REGEX);
  return manifestCidFromUrl(page.url()) || "";
}

/**
 * Save the current draft and return the new manifest CID. Save flips the
 * `?manifest=` CID to a fresh value; that change is the durable signal the save
 * landed (no rename dialog - a draft keeps its current name).
 *
 * @param {Page} page
 * @param {string} prevCid
 * @returns {Promise<string>}
 */
export async function saveDraft(page, prevCid) {
  await page.click(SELECTORS.saveAssetBtn);
  await page.waitForURL(/** @type {(url: URL) => boolean} */ ((url) => {
    const cid = manifestCidFromUrl(url.toString());
    return Boolean(cid) && cid !== prevCid;
  }));
  return manifestCidFromUrl(page.url()) || "";
}

/**
 * First-time publish: confirm the name dialog and wait for the on-chain token
 * anchor. Returns the token id in HEX (publish derives it as a hash of the CID;
 * the gallery lists the same token in DECIMAL - compare numerically, never as
 * strings).
 *
 * @param {Page} page
 * @param {string} name
 * @returns {Promise<string | null>}
 */
export async function publishWithName(page, name) {
  await page.click(SELECTORS.publishAssetBtn);
  await expect(page.locator(SELECTORS.dialogInput)).toBeVisible();
  await page.fill(SELECTORS.dialogInput, name);
  await page.click(SELECTORS.dialogConfirmBtn);
  await page.waitForURL(/[?&]asset=0x[0-9a-fA-F]+/, { timeout: 30000 });
  return tokenIdHexFromUrl(page.url());
}

/**
 * Run the proven generate → save → publish path and return the token id (hex).
 *
 * @param {Page} page
 * @param {string} name
 * @param {string} [prompt]
 * @returns {Promise<string | null>}
 */
export async function generateSaveAndPublish(
  page,
  name,
  prompt = DEFAULT_PROMPT,
) {
  const genCid = await generate(page, prompt);
  await saveDraft(page, genCid);
  return publishWithName(page, name);
}

/**
 * Extract the published token id (hex) the studio writes to `?asset=`.
 *
 * @param {string} url
 * @returns {string | null}
 */
export function tokenIdHexFromUrl(url) {
  return new URL(url).searchParams.get("asset");
}

/**
 * Locate a gallery asset card by both collection token id (decimal) and asset
 * name. A single collection token expands to one card per asset, so matching
 * only by `data-token-id` is ambiguous once the shared default collection
 * contains multiple assets.
 *
 * @param {Page} page
 * @param {string} tokenIdDec
 * @param {string} name
 * @returns {Locator}
 */
export function assetCardLocator(page, tokenIdDec, name) {
  return page.locator(
    `${SELECTORS.assetCard}[data-token-id="${tokenIdDec}"]:has(${SELECTORS.assetCardName}:text-is("${name}"))`,
  );
}

/**
 * Select the first node in the Outliner - which auto-opens the parametric
 * component editor - and set its colour. A color input can't be `fill`ed, so
 * set the value and dispatch the input/change events the app listens for.
 *
 * @param {Page} page
 * @param {string} color
 */
export async function editFirstNodeColor(page, color) {
  await page.click(SELECTORS.outlinerSwitcherBtn);
  await page.locator(SELECTORS.outlinerNode).first().click();
  await expect(page.locator(SELECTORS.componentEditor)).toBeVisible();
  await page.locator(SELECTORS.componentColorInput).evaluate(
    /** @type {(el: any, value: string) => void} */ ((el, value) => {
      const input = /** @type {any} */ (el);
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }),
    color,
  );
}

/**
 * Scrub the scene clock to the oldest or newest version. Focusing the dial
 * expands the collapsed watch face; Home/End commit the version load
 * immediately (keyboard contract of version-clock.js).
 *
 * @param {Page} page
 * @param {"oldest" | "newest"} position
 */
export async function scrubSceneClock(page, position) {
  const dial = page.locator(SELECTORS.sceneClockDial);
  await dial.focus();
  await page.keyboard.press(position === "oldest" ? "Home" : "End");
}

// ── Library helpers ──────────────────────────────────────────────────────────

/**
 * Open the library with the Hardhat dev wallet injected, click Login / Signup,
 * select the injected wallet, and wait until authenticated. Returns once the
 * main browser UI is visible.
 *
 * @param {Page} page
 */
export async function connectLibrary(page) {
  await injectHardhatProvider(page);
  await page.goto("/library");

  // The library page auto-connects on page load just like the Studio. Wait for
  // the wallet gate to disappear; if it does not, use the manual Login / Signup
  // fallback.
  const libraryGate = page.locator(SELECTORS.libraryGate);
  try {
    await expect(libraryGate).toBeHidden({ timeout: 8000 });
  } catch {
    const libraryConnectBtn = page.locator(SELECTORS.libraryConnectBtn);
    await libraryConnectBtn.click();
    await page.locator(SELECTORS.hardhatWalletOption).click();
    await expect(libraryGate).toBeHidden();
  }

  await expect(page.locator(SELECTORS.libraryMain)).toBeVisible();
  await expect(page.locator(SELECTORS.connectWalletBtn)).toBeHidden();
}

/**
 * Locate a collection card in the library by its display name.
 *
 * @param {Page} page
 * @param {string} name
 * @returns {Locator}
 */
export function libraryCollectionLocator(page, name) {
  return page.locator(
    `${SELECTORS.libraryCollectionItem}:has(${SELECTORS.libraryItemName}:text-is("${name}"))`,
  );
}

/**
 * Locate an asset card in the library by its display name.
 *
 * @param {Page} page
 * @param {string} name
 * @returns {Locator}
 */
export function libraryAssetLocator(page, name) {
  return page.locator(
    `${SELECTORS.libraryAssetItem}:has(${SELECTORS.libraryItemName}:text-is("${name}"))`,
  );
}

/**
 * Double-click a collection to open it and wait for the breadcrumb to update.
 *
 * @param {Page} page
 * @param {string} name
 */
export async function openLibraryCollection(page, name) {
  const card = libraryCollectionLocator(page, name);
  await expect(card).toBeVisible();
  await card.dblclick();
  await expect(page.locator(SELECTORS.libraryBreadcrumb)).toContainText(name);
}

/**
 * Double-click the first matching asset card and wait for the SPA router to
 * activate the Studio view. openInStudio uses history.pushState (no full
 * reload), so we match the clean-URL route rather than a .html page.
 *
 * @param {Page} page
 * @param {string} name
 */
export async function openLibraryAssetInStudio(page, name) {
  const card = libraryAssetLocator(page, name).first();
  await expect(card).toBeVisible();
  await card.dblclick();
  await page.waitForURL(/\/studio\?asset=/, { timeout: 10000 });
}

/**
 * Wait until the library grid contains exactly `count` items.
 *
 * @param {Page} page
 * @param {number} count
 */
export async function waitForLibraryItemCount(page, count) {
  await expect(page.locator(SELECTORS.libraryItem)).toHaveCount(count);
}

/**
 * Read the displayed names of every library item in the current view.
 * Returns an array of strings in DOM order.
 *
 * @param {Page} page
 * @returns {Promise<string[]>}
 */
export async function libraryItemNames(page) {
  return page.locator(`${SELECTORS.libraryItem} ${SELECTORS.libraryItemName}`).allTextContents();
}

/**
 * Generate a unique asset name to avoid collisions across retries/shared chain.
 *
 * @param {string} base
 * @returns {string}
 */
export function uniqueAssetName(base) {
  return `${base} ${Date.now()}`;
}

/**
 * Create a new named collection from the Library toolbar and wait until the
 * collection card appears at the collections list level.
 *
 * @param {Page} page
 * @param {string} name
 */
export async function createLibraryCollection(page, name) {
  await page.click(SELECTORS.libraryCreateCollectionBtn);
  await expect(page.locator(SELECTORS.dialogInput)).toBeVisible();
  await page.fill(SELECTORS.dialogInput, name);
  await page.click(SELECTORS.dialogConfirmBtn);
  await expect(libraryCollectionLocator(page, name)).toBeVisible({
    timeout: 30000,
  });
}

/**
 * Upload a file from disk into the currently-open Library collection and wait
 * until the asset card appears.
 *
 * @param {Page} page
 * @param {string} filePath
 * @param {string} expectedAssetName
 */
export async function uploadLibraryFile(page, filePath, expectedAssetName) {
  await page.setInputFiles(SELECTORS.libraryUploadInput, filePath);
  await expect(libraryAssetLocator(page, expectedAssetName).first()).toBeVisible({
    timeout: 30000,
  });
}

// ── Multi-wallet / editor collaboration helpers ──────────────────────────────

/**
 * Add an address as a collaborator of a collection from the Library.
 * Defaults to the "Default" collection. Waits until the new collaborator
 * appears in the collaborator list.
 *
 * @param {Page} page
 * @param {string} address
 * @param {string} [collectionName]
 */
export async function addCollaborator(
  page,
  address,
  collectionName = "Default",
) {
  await page.goto("/library");
  await ensureLibraryConnected(page);
  await expect(page.locator(SELECTORS.libraryGate)).toBeHidden();
  await expect(page.locator(SELECTORS.libraryMain)).toBeVisible();
  await expect(page.locator(SELECTORS.connectWalletBtn)).toBeHidden();

  const card = libraryCollectionLocator(page, collectionName);
  await expect(card).toBeVisible();
  await card.click({ button: "right" });
  await page.click(
    SELECTORS.contextMenuItemByText("Manage Collaborators"),
  );

  await expect(page.locator(SELECTORS.collaboratorAddInput)).toBeVisible();
  await page.fill(SELECTORS.collaboratorAddInput, address);
  await page.click(SELECTORS.collaboratorAddBtn);
  await expect(page.locator(SELECTORS.teamItemByAddress(address))).toBeVisible({
    timeout: 30000,
  });

  await page.locator(".dialog-close-btn").click();
}

/**
 * Open a shared asset in Studio via direct URL. Shared assets are not
 * discoverable in the Library sidebar without an off-chain indexer, so the
 * editor wallet must navigate directly using the tokenId + assetId.
 *
 * @param {Page} page
 * @param {string} tokenId
 * @param {string} [assetId]
 */
export async function openSharedAsset(page, tokenId, assetId) {
  const url = assetId
    ? `/studio?asset=${tokenId}&assetId=${assetId}`
    : `/studio?asset=${tokenId}`;
  await page.goto(url);
  await ensureStudioConnected(page);
  await expect(page.locator(SELECTORS.connectWalletBtn)).toBeHidden();
  // Wait until the Studio has resolved the asset token from the URL. The team
  // panel's `hidden` attribute is removed once activeAssetTokenId is set; it
  // may still be inside a non-active sidebar view, so we check the attribute
  // rather than layout visibility.
  await expect(
    page.locator(SELECTORS.teamPanel),
  ).not.toHaveAttribute("hidden", "", { timeout: 30000 });
}

/**
 * Ensure the right inspector is expanded so its sections (parametric editor,
 * comments, etc.) are interactable.
 *
 * @param {Page} page
 */
export async function openInspector(page) {
  await page.evaluate(
    /** @type {() => void} */ (() => {
      const inspector = /** @type {any} */ (globalThis).document.getElementById(
        "inspector",
      );
      if (inspector) inspector.classList.remove("collapsed");
    }),
  );
}

/**
 * Post a comment in the Studio comments panel and wait for it to appear.
 *
 * @param {Page} page
 * @param {string} text
 */
export async function postComment(page, text) {
  await openInspector(page);
  const input = page.locator(SELECTORS.commentComposerInput);
  await expect(input).toBeVisible();
  await expect(input).not.toBeDisabled({ timeout: 15000 });
  await input.fill(text);
  await page.click(SELECTORS.postCommentBtn);
  await expect(page.locator(SELECTORS.commentList)).toContainText(text, {
    timeout: 15000,
  });
}

/**
 * Wait for a comment with the given text to appear in the comments panel.
 *
 * @param {Page} page
 * @param {string} text
 */
export async function expectComment(page, text) {
  await openInspector(page);
  await expect(page.locator(SELECTORS.commentList)).toContainText(text, {
    timeout: 30000,
  });
}
