import { expect } from "@playwright/test";
import { injectHardhatProvider } from "../fixtures/hardhat-provider.mjs";
import { SELECTORS } from "./studio-selectors.mjs";
import { manifestCidFromUrl } from "./manifest.mjs";

const DEFAULT_PROMPT = "cowboy";

/**
 * Open the studio with the Hardhat dev wallet injected and wait until it has
 * auto-connected + authenticated (the connect button hides; the wallet button
 * stops showing "Sign In").
 */
export async function connectStudio(page) {
  await injectHardhatProvider(page);
  await page.goto("/studio.html");
  await expect(page.locator(SELECTORS.connectWalletBtn)).toBeHidden();
  await expect(page.locator(SELECTORS.disconnectWalletBtn)).not.toContainText(
    "Sign In",
  );
}

/**
 * Generate a mock asset and return the resulting generation manifest CID. The
 * `?manifest=` URL is the durable completion signal — the screen-reader status
 * text is transient and gets overwritten.
 */
export async function generate(page, prompt = DEFAULT_PROMPT) {
  await page.fill(SELECTORS.promptInput, prompt);
  await page.click(SELECTORS.generateBtn);
  await expect(page.locator(SELECTORS.chatHistoryList)).toContainText(
    "Model carved via mock",
  );
  await page.waitForURL(/[?&]manifest=Qm[\w]+/);
  return manifestCidFromUrl(page.url());
}

/**
 * Save the current draft and return the new manifest CID. Save flips the
 * `?manifest=` CID to a fresh value; that change is the durable signal the save
 * landed (no rename dialog — a draft keeps its current name).
 */
export async function saveDraft(page, prevCid) {
  await page.click(SELECTORS.saveAssetBtn);
  await page.waitForURL((url) => {
    const cid = manifestCidFromUrl(url.toString());
    return Boolean(cid) && cid !== prevCid;
  });
  return manifestCidFromUrl(page.url());
}

/**
 * First-time publish: confirm the name dialog and wait for the on-chain token
 * anchor. Returns the token id in HEX (publish derives it as a hash of the CID;
 * the gallery lists the same token in DECIMAL — compare numerically, never as
 * strings).
 */
export async function publishWithName(page, name) {
  await page.click(SELECTORS.publishAssetBtn);
  await expect(page.locator(SELECTORS.dialogInput)).toBeVisible();
  await page.fill(SELECTORS.dialogInput, name);
  await page.click(SELECTORS.dialogConfirmBtn);
  await page.waitForURL(/[?&]asset=0x[0-9a-fA-F]+/, { timeout: 10000 });
  return tokenIdHexFromUrl(page.url());
}

/** Run the proven generate → save → publish path and return the token id (hex). */
export async function generateSaveAndPublish(
  page,
  name,
  prompt = DEFAULT_PROMPT,
) {
  const genCid = await generate(page, prompt);
  await saveDraft(page, genCid);
  return publishWithName(page, name);
}

/** Extract the published token id (hex) the studio writes to `?asset=`. */
export function tokenIdHexFromUrl(url) {
  return new URL(url).searchParams.get("asset");
}

/**
 * Select the first node in the Outliner — which auto-opens the parametric
 * component editor — and set its colour. A color input can't be `fill`ed, so
 * set the value and dispatch the input/change events the app listens for.
 */
export async function editFirstNodeColor(page, color) {
  await page.click(SELECTORS.outlinerSwitcherBtn);
  await page.locator(SELECTORS.outlinerNode).first().click();
  await expect(page.locator(SELECTORS.componentEditor)).toBeVisible();
  await page.locator(SELECTORS.componentColorInput).evaluate((el, value) => {
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, color);
}

/**
 * Move the version slider to an index. `input` updates the badge; `change`
 * commits the load of that version.
 */
export async function scrubHistorySlider(page, index) {
  await page.locator(SELECTORS.historySlider).evaluate((el, value) => {
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, String(index));
}
