import { test, expect } from "../fixtures/coverage.mjs";
import { SELECTORS } from "../helpers/studio-selectors.mjs";
import { MANIFEST_URL_REGEX, fetchManifest, manifestCidFromUrl } from "../helpers/manifest.mjs";
import { connectStudio, enterEditMode, openInspector, saveDraft, selectProvider } from "../helpers/flows.mjs";

// The e2e backend serves the canned CAD_MOCK_GENERATION box: 40 x 30 x 20 mm
// with width / depth / height parameters (src/api/generation-providers.ts).
test.describe("CAD parameters (Inspector)", () => {
  test("a width edit previews, saves as a new 3MF and survives a reload", async ({ page }) => {
    await connectStudio(page);
    await selectProvider(page, "cad");
    await page.fill(SELECTORS.promptInput, "a box");
    await page.click(SELECTORS.generateBtn);
    const bubble = page.locator(SELECTORS.assetBubble).first();
    await expect(bubble).toBeVisible({ timeout: 60_000 });
    await bubble.locator(".chat-asset-send").click();
    await page.waitForURL(MANIFEST_URL_REGEX);
    await expect(bubble).toHaveClass(/chat-bubble-asset-saved/, { timeout: 30_000 });

    const firstCid = manifestCidFromUrl(page.url());
    const before = await fetchManifest(firstCid);
    const beforeSource = before.scene.nodes[0].source.cid;

    await openInspector(page);
    await page.click(SELECTORS.outlinerSwitcherBtn);
    await page.locator(SELECTORS.outlinerNode).first().click();
    const section = page.locator(SELECTORS.cadParamsSection);
    await expect(section).toBeVisible({ timeout: 15_000 });
    for (const name of ["width", "depth", "height"]) {
      await expect(page.locator(SELECTORS.cadParamInput(name))).toBeVisible();
    }
    await expect(page.locator(SELECTORS.cadParamInput("width"))).toBeDisabled();

    await enterEditMode(page);
    const width = page.locator(SELECTORS.cadParamInput("width"));
    await expect(width).toBeEnabled();
    await width.fill("60");
    await width.press("Tab");
    await expect(page.locator(SELECTORS.cadParamsStatus)).toHaveText("Preview up to date · not saved", {
      timeout: 30_000,
    });

    const savedCid = await saveDraft(page, firstCid);
    const saved = await fetchManifest(savedCid);
    expect(saved.scene.nodes[0].source.cid).not.toBe(beforeSource);
    expect(saved.metadata?.cad?.stats?.bboxMm?.max[0] - saved.metadata?.cad?.stats?.bboxMm?.min[0]).toBeCloseTo(60, 3);
    await expect(page.locator(SELECTORS.bottomBarAssetInfo)).toContainText("60");
    await expect(page.locator(SELECTORS.cadParamsStatus)).toHaveText("Saved values");

    await page.reload();
    await openInspector(page);
    await page.click(SELECTORS.outlinerSwitcherBtn);
    await page.locator(SELECTORS.outlinerNode).first().click();
    await expect(page.locator(SELECTORS.cadParamInput("width"))).toHaveValue("60", { timeout: 15_000 });
  });
});
