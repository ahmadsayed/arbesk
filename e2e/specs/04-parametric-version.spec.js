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

    // 1. Generate (v1) → Show in Studio auto-saves the draft (v2). The URL
    // CID is the auto-saved version; the raw generation manifest is its prev.
    const autoSaveCid = await generate(page, PROMPT);
    const autoSaveManifest = await fetchManifest(autoSaveCid);
    expect(autoSaveManifest.version).toBe(2);
    const genCid = autoSaveManifest.prev_asset_manifest_cid;
    const genManifest = await fetchManifest(genCid);
    assertGenerationManifest(genManifest, { prompt: PROMPT, provider: "mock" });
    expect(genManifest.version).toBe(1);

    // 2-3. Select the node and change its component colour.
    await editFirstNodeColor(page, EDIT_COLOR);

    // 4. Save - the pending colour edit is baked into a NEW version (v3).
    const saveCid = await saveDraft(page, autoSaveCid);
    const savedManifest = await fetchManifest(saveCid);
    expect(savedManifest.version).toBe(3);
    expect(savedManifest.prev_asset_manifest_cid).toBe(autoSaveCid);

    // 5. The scene clock now spans three versions and sits on the newest.
    await expect(page.locator(SELECTORS.sceneClock)).toBeVisible();
    await expect(page.locator(SELECTORS.sceneClockBadge)).toHaveText("v3");
    await expect(page.locator(SELECTORS.sceneClockDial)).toHaveAttribute(
      "aria-valuemax",
      "2",
    );

    // Record scene:ready per loaded version. The badge updates from the slider
    // position *before* the manifest loads and the .loading class clears in a
    // finally regardless of success, so neither proves the version re-rendered.
    // scene:ready only fires when every node loads (scene-graph emits it after
    // the node loop), so it is the signal that the version actually rendered.
    // Subscribing to the in-memory bus singleton from page context works
    // because the dynamic import resolves to the already-loaded module.
    await page.evaluate(async () => {
      const { on, EVENTS } = await import("/js/asset-core/events/bus.js");
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

    // 7. Scrub forward to v3 and confirm the EDITED version actually re-renders.
    // The source was a GLB (cowboy → howdy.glb) decomposed to composite glTF on
    // edit; if its node still claimed format:"glb" while holding glTF JSON,
    // loadAssetManifest would throw in the binary-GLB loader and scene:ready
    // would never fire for v3.
    await scrubSceneClock(page, "newest");
    await expect(page.locator(SELECTORS.sceneClockBadge)).toHaveText("v3");
    await expect
      .poll(() => page.evaluate(() => window.__sceneReadyCids.at(-1)))
      .toBe(saveCid);

    // 7b. Model clock: selecting the node + entering Time mode (V) surfaces
    // the 3D ring gizmo badge.
    await page.click(SELECTORS.outlinerSwitcherBtn);
    await page.locator(SELECTORS.outlinerNode).first().click();
    await page.click(SELECTORS.timeModeButton);
    await expect(page.locator(SELECTORS.modelClockBadge)).toBeVisible();
    await expect(page.locator(SELECTORS.modelClockBadge)).toHaveText("v3");

    // Step the gizmo to its oldest entry via keyboard → whole scene reloads v1.
    // The model clock gizmo persists across the reload and lands on v1.
    await page.keyboard.press("Home");
    await expect
      .poll(() => page.evaluate(() => window.__sceneReadyCids.at(-1)))
      .toBe(genCid);
    await expect(page.locator(SELECTORS.modelClockBadge)).toBeVisible();
    await expect(page.locator(SELECTORS.modelClockBadge)).toHaveText("v1");

    // Return to the newest version via the scene clock before publishing.
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
    // Publish saves one more version (v4) with the captured thumbnail.
    expect(assetManifest.name).toBe(ASSET_NAME);
    expect(assetManifest.version).toBe(4);
    expect(assetManifest.prev_asset_manifest_cid).toBe(saveCid);
  });

  test("model clock billboards to the camera while orbiting", async ({
    page,
  }) => {
    await connectStudio(page);
    await generate(page, PROMPT);

    // Select the node and enter Time mode so the 3D clock gizmo appears.
    await page.click(SELECTORS.outlinerSwitcherBtn);
    await page.locator(SELECTORS.outlinerNode).first().click();
    await page.click(SELECTORS.timeModeButton);
    await expect(page.locator(SELECTORS.modelClockBadge)).toBeVisible();

    // Dot of the clock face normal with the root→camera direction: 1 means
    // the ring faces the viewer. Regression: a stale-Euler roundtrip in
    // syncRootToCamera froze the ring at its first-frame orientation.
    const facingDot = () =>
      page.evaluate(() => {
        const B = window.BABYLON;
        const ul = B.UtilityLayerRenderer?.DefaultUtilityLayer;
        const cam = ul?.originalScene?.activeCamera;
        const root = ul?.utilityLayerScene?.getNodeByName("modelClockRoot");
        if (!root || !cam) return null;
        root.computeWorldMatrix(true);
        const fwd = B.Vector3.TransformNormal(
          new B.Vector3(0, 0, 1),
          root.getWorldMatrix(),
        ).normalize();
        const toCam = cam.position
          .subtract(root.getAbsolutePosition())
          .normalize();
        return B.Vector3.Dot(fwd, toCam);
      });

    expect(await facingDot()).toBeGreaterThan(0.98);

    // Orbit hard; the ring must keep facing the viewer (not stay pinned to
    // the scene orientation).
    const canvas = page.locator("#renderCanvas");
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.4);
    await page.mouse.down();
    for (let i = 1; i <= 16; i++) {
      await page.mouse.move(
        box.x + box.width * 0.35 + i * 22,
        box.y + box.height * 0.4 - i * 3,
      );
      await page.waitForTimeout(20);
    }
    await page.mouse.up();

    await expect.poll(facingDot).toBeGreaterThan(0.98);
  });
});
