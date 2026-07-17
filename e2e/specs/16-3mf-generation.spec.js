import { test, expect } from "../fixtures/coverage.mjs";
import {
  fetchManifest,
  assertGenerationManifest,
  assertSavedManifest,
} from "../helpers/manifest.mjs";
import {
  connectStudio,
  ensureStudioConnected,
  generate,
  saveDraft,
  publishWithName,
  uniqueAssetName,
} from "../helpers/flows.mjs";
import { SELECTORS } from "../helpers/studio-selectors.mjs";

const PROMPT = "3mf box";

test.describe("3mf generation", () => {
  test("generates a 3MF asset, saves (decompose), and publishes", async ({
    page,
  }) => {
    await connectStudio(page);

    const genCid = await generate(page, PROMPT);
    const genManifest = await fetchManifest(genCid);
    assertGenerationManifest(genManifest, { prompt: PROMPT });
    const genNode = genManifest.scene.nodes[0];
    expect(genNode.source.format).toBe("3mf");
    expect(genNode.source.path).toBe("asset.3mf");

    // Save decomposes the raw .3mf package into composite 3MF form.
    const savedCid = await saveDraft(page, genCid);
    const savedManifest = await fetchManifest(savedCid);
    const savedNode = savedManifest.scene.nodes[0];
    expect(savedNode.source.format).toBe("3mf");
    expect(savedNode.source.path).toBe("composite.3mf.json");
    expect(savedNode.source.cid).not.toBe(genNode.source.cid);
    assertSavedManifest(savedManifest, genCid);
    const savedSource = await fetchManifest(savedNode.source.cid);
    expect(savedSource.arbesk_format).toBe("composite-3mf");

    const name = uniqueAssetName("3MF Box");
    const tokenIdHex = await publishWithName(page, name);
    expect(tokenIdHex).toMatch(/^0x[0-9a-fA-F]+$/);

    // Reload the published asset from the chain: token → collection manifest →
    // composite 3MF → compose3mf() → glTF render. Save/publish only pushState,
    // so without this navigation the compose path never runs in E2E.
    await page.goto(
      `/studio?asset=${tokenIdHex}&assetId=${genManifest.asset_id}`
    );
    await ensureStudioConnected(page);
    await expect(page.locator(SELECTORS.assetStatusName)).toContainText(name, {
      timeout: 30000,
    });
  });
});
