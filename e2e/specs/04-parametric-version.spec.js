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

    // Record scene:ready per loaded version. The badge updates from the slider
    // position *before* the manifest loads and the .loading class clears in a
    // finally regardless of success, so neither proves the version re-rendered.
    // scene:ready only fires when every node loads (scene-graph emits it after
    // the node loop), so it is the signal that the version actually rendered.
    // Subscribing to the in-memory bus singleton from page context works
    // because the dynamic import resolves to the already-loaded module.
    await page.evaluate(async () => {
      const { on, EVENTS } = await import("/js/events/bus.js");
      window.__sceneReadyCids = [];
      on(EVENTS.SCENE_READY, ({ manifestCid }) =>
        window.__sceneReadyCids.push(manifestCid)
      );
    });

    // 6. Time-travel back to v1 (index 0): the original GLB source re-renders.
    await scrubHistorySlider(page, 0);
    await expect(page.locator(SELECTORS.historyVersionBadge)).toHaveText("v1");
    // Loading finished (the section drops its .loading state once the older
    // manifest is back in the scene).
    await expect(page.locator(SELECTORS.assetHistory)).not.toHaveClass(/loading/);
    await expect
      .poll(() => page.evaluate(() => window.__sceneReadyCids.at(-1)))
      .toBe(genCid);

    // 7. Scrub forward to v2 and confirm the EDITED version actually re-renders.
    // The source was a GLB (cowboy → howdy.glb) decomposed to composite glTF on
    // edit; if its node still claimed format:"glb" while holding glTF JSON,
    // loadAssetManifest would throw in the binary-GLB loader and scene:ready
    // would never fire for v2.
    await scrubHistorySlider(page, 1);
    await expect(page.locator(SELECTORS.historyVersionBadge)).toHaveText("v2");
    await expect
      .poll(() => page.evaluate(() => window.__sceneReadyCids.at(-1)))
      .toBe(saveCid);
  });
});
