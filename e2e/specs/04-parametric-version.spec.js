import { test, expect } from "../fixtures/coverage.mjs";
import { SELECTORS } from "../helpers/studio-selectors.mjs";
import {
  fetchManifest,
  fetchTokenManifest,
  assertGenerationManifest,
  assertPublishedManifest,
  assertCollectionManifest,
  findAssetCidByName,
} from "../helpers/manifest.mjs";
import {
  connectStudio,
  generate,
  saveDraft,
  editFirstNodeColor,
  scrubSceneClock,
  publishWithName,
} from "../helpers/flows.mjs";

const PROMPT = "cowboy";
const ASSET_NAME = "Cowboy Parametric";
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

    // 4. Save - the pending colour edit is baked into a NEW version (v2).
    const saveCid = await saveDraft(page, genCid);
    const savedManifest = await fetchManifest(saveCid);
    expect(savedManifest.version).toBe(2);
    expect(savedManifest.prev_asset_manifest_cid).toBe(genCid);

    // 5. The scene clock now spans two versions and sits on the newest.
    await expect(page.locator(SELECTORS.sceneClock)).toBeVisible();
    await expect(page.locator(SELECTORS.sceneClockBadge)).toHaveText("v2");
    await expect(page.locator(SELECTORS.sceneClockDial)).toHaveAttribute(
      "aria-valuemax",
      "1",
    );

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
        window.__sceneReadyCids.push(manifestCid),
      );
    });

    // 6. Time-travel back to v1 (oldest): the original GLB source re-renders.
    await scrubSceneClock(page, "oldest");
    await expect(page.locator(SELECTORS.sceneClockBadge)).toHaveText("v1");
    await expect(page.locator(SELECTORS.sceneClockDial)).not.toHaveClass(
      /loading/,
    );
    await expect
      .poll(() => page.evaluate(() => window.__sceneReadyCids.at(-1)))
      .toBe(genCid);

    // 7. Scrub forward to v2 and confirm the EDITED version actually re-renders.
    // The source was a GLB (cowboy → howdy.glb) decomposed to composite glTF on
    // edit; if its node still claimed format:"glb" while holding glTF JSON,
    // loadAssetManifest would throw in the binary-GLB loader and scene:ready
    // would never fire for v2.
    await scrubSceneClock(page, "newest");
    await expect(page.locator(SELECTORS.sceneClockBadge)).toHaveText("v2");
    await expect
      .poll(() => page.evaluate(() => window.__sceneReadyCids.at(-1)))
      .toBe(saveCid);

    // 7b. Model clock: selecting the node + entering Time mode (V) surfaces
    // the 3D ring gizmo badge.
    await page.click(SELECTORS.outlinerSwitcherBtn);
    await page.locator(SELECTORS.outlinerNode).first().click();
    await page.click(SELECTORS.timeModeButton);
    await expect(page.locator(SELECTORS.modelClockBadge)).toBeVisible();
    await expect(page.locator(SELECTORS.modelClockBadge)).toHaveText("v2");

    // Step the gizmo to its oldest entry via keyboard → whole scene reloads v1.
    await page.keyboard.press("Home");
    await expect
      .poll(() => page.evaluate(() => window.__sceneReadyCids.at(-1)))
      .toBe(genCid);

    // Reloading cleared the selection (model clock badge hides again); return to
    // the newest version via the scene clock before publishing.
    await expect(page.locator(SELECTORS.modelClockBadge)).toBeHidden();
    await scrubSceneClock(page, "newest");
    await expect
      .poll(() => page.evaluate(() => window.__sceneReadyCids.at(-1)))
      .toBe(saveCid);

    // 8. Publish the parametric asset. tokenURI now returns a collection
    // manifest, not an asset manifest - walk through collection → asset
    // to validate the published content.
    const tokenIdHex = await publishWithName(page, ASSET_NAME);

    const collectionManifest = await fetchTokenManifest(tokenIdHex);
    assertCollectionManifest(collectionManifest, {
      expectedAssetIds: undefined,
    });
    expect(Object.keys(collectionManifest.assets).length).toBeGreaterThanOrEqual(1);

    const assetCid = await findAssetCidByName(collectionManifest, ASSET_NAME);
    expect(assetCid).toBeTruthy();
    const assetManifest = await fetchManifest(assetCid);
    expect(assetManifest.type).toBe("asset");
    assertPublishedManifest(assetManifest);
    // Publish saves one more version (v3) with the captured thumbnail.
    expect(assetManifest.name).toBe(ASSET_NAME);
    expect(assetManifest.version).toBe(3);
    expect(assetManifest.prev_asset_manifest_cid).toBe(saveCid);
  });
});
