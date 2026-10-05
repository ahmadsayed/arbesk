import { test, expect } from "../fixtures/coverage.mjs";
import { SELECTORS } from "../helpers/studio-selectors.mjs";
import { MANIFEST_URL_REGEX, fetchManifest, manifestCidFromUrl } from "../helpers/manifest.mjs";
import { connectStudio } from "../helpers/flows.mjs";

const PROMPT = "a 40 by 30 by 20 mm box";
const MOCK_CODE = "return box(P.width, P.depth, P.height);";

/** Waits for the next CAD POST and returns its JSON body. */
async function nextCadPost(page) {
  const req = await page.waitForRequest(
    (r) => r.method() === "POST" && /\/api\/v1\/generations$/.test(r.url()) && r.postDataJSON()?.provider === "cad",
  );
  return req.postDataJSON();
}

/**
 * Clicks the bubble at `bubbleIndex`'s Show in Studio and waits for the
 * saved pill.
 * @remarks Indexed, not `.last()`: `.last()` re-resolves as bubbles append,
 *   so right after dispatching it still points at the previous (already
 *   visible) bubble and would re-send that version instead of the new result
 *   (same pinning rule as `generateToChatBubble` in flows.mjs).
 */
async function showInStudio(page, bubbleIndex) {
  const bubble = page.locator(SELECTORS.assetBubble).nth(bubbleIndex);
  await expect(bubble).toBeVisible({ timeout: 60_000 });
  await bubble.locator(".chat-asset-send").click();
  await page.waitForURL(MANIFEST_URL_REGEX);
  await expect(bubble).toHaveClass(/chat-bubble-asset-saved/, { timeout: 30_000 });
  return manifestCidFromUrl(page.url());
}

test.describe("CAD incremental edit", () => {
  test("a follow-up edits the active part; detaching starts fresh", async ({ page }) => {
    await connectStudio(page);
    await page.locator(SELECTORS.providerSelect).selectOption("cad");

    // 1. Fresh part: no priorDesign. The part is the first bubble (index 0).
    await page.fill(SELECTORS.promptInput, PROMPT);
    const firstPost = nextCadPost(page);
    await page.click(SELECTORS.generateBtn);
    expect("priorDesign" in (await firstPost)).toBe(false);
    const v1 = await showInStudio(page, 0);

    // 2. The chip is attached and the selector locked to CAD.
    await expect(page.locator(SELECTORS.refineIndicator)).toBeVisible();
    await expect(page.locator(SELECTORS.refineIndicatorText)).toHaveText(`Refining: ${PROMPT}`);
    await expect(page.locator(SELECTORS.providerSelect)).toBeDisabled();
    await expect(page.locator(SELECTORS.providerSelect)).toHaveValue("cad");

    // 3. Follow-up: priorDesign carries the first design; the result is the
    //    second bubble (index 1) and chains onto v1.
    await page.fill(SELECTORS.promptInput, "make it 5 mm taller");
    const editPost = nextCadPost(page);
    await page.click(SELECTORS.generateBtn);
    const body = await editPost;
    expect(body.priorDesign.code).toBe(MOCK_CODE);
    expect(body.priorDesign.turn).toBe(1);
    await expect(page.locator(SELECTORS.chatHistoryList)).toContainText(`Editing "${PROMPT}"…`);
    const v2 = await showInStudio(page, 1);
    expect(v2).not.toBe(v1);
    const saved = await fetchManifest(v2);
    const generation = await fetchManifest(saved.prev_asset_manifest_cid);
    expect(generation.prev_asset_manifest_cid).toBe(v1);

    // 4. Detach: the selector unlocks and the next prompt is fresh.
    await page.click(SELECTORS.refineIndicatorDetach);
    await expect(page.locator(SELECTORS.providerSelect)).toBeEnabled();
    await page.locator(SELECTORS.providerSelect).selectOption("cad");
    await page.fill(SELECTORS.promptInput, "a 10 mm cube");
    const freshPost = nextCadPost(page);
    await page.click(SELECTORS.generateBtn);
    expect("priorDesign" in (await freshPost)).toBe(false);
  });
});
