import { test, expect } from "@playwright/test";
import { SELECTORS } from "../helpers/studio-selectors.mjs";
import { fetchManifest, assertGenerationManifest } from "../helpers/manifest.mjs";
import {
  connectStudio,
  generate,
  saveDraft,
  editFirstNodeColor,
  scrubHistorySlider,
} from "../helpers/flows.mjs";

const PROMPT = "cowboy";
const EDIT_COLOR = "#ff0000";

test.describe("parametric versioning + time-travel", () => {
  test("a color edit appends a new version and the slider time-travels back", async ({
    page,
  }) => {
    await connectStudio(page);

    // 1. Generate (version 1).
    const genCid = await generate(page, PROMPT);
    const genManifest = await fetchManifest(genCid);
    assertGenerationManifest(genManifest, { prompt: PROMPT, provider: "mock" });
    expect(genManifest.version).toBe(1);

    // 2-3. Select the node and change its component colour.
    await editFirstNodeColor(page, EDIT_COLOR);

    // 4. Save — the pending colour edit is baked into a NEW version (v2).
    const saveCid = await saveDraft(page, genCid);
    const savedManifest = await fetchManifest(saveCid);
    expect(savedManifest.version).toBe(2);
    expect(savedManifest.prev_asset_manifest_cid).toBe(genCid);

    // 5. The version slider now spans two versions and sits on the newest.
    await expect(page.locator(SELECTORS.assetHistory)).toBeVisible();
    await expect(page.locator(SELECTORS.historyVersionBadge)).toHaveText("v2");
    await expect(page.locator(SELECTORS.historySlider)).toHaveAttribute("max", "1");

    // 6. Time-travel back to v1 (index 0).
    await scrubHistorySlider(page, 0);
    await expect(page.locator(SELECTORS.historyVersionBadge)).toHaveText("v1");
    // Loading finished (the section drops its .loading state once the older
    // manifest is back in the scene).
    await expect(page.locator(SELECTORS.assetHistory)).not.toHaveClass(/loading/);

    // 7. Scrub forward again to confirm the slider drives navigation both ways.
    await scrubHistorySlider(page, 1);
    await expect(page.locator(SELECTORS.historyVersionBadge)).toHaveText("v2");
  });
});
