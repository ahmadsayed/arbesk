import { test, expect } from "@playwright/test";
import { SELECTORS } from "../helpers/studio-selectors.mjs";
import {
  fetchManifest,
  fetchTokenManifest,
  assertPublishedManifest,
  assertCollectionManifest,
  findAssetCidByName,
} from "../helpers/manifest.mjs";
import {
  connectStudio,
  generateSaveAndPublish,
  editFirstNodeColor,
  tokenIdHexFromUrl,
} from "../helpers/flows.mjs";

const PROMPT = "cowboy";
const ASSET_NAME = "Cowboy Republish";
const EDIT_COLOR = "#00aa55";

test.describe("republish existing token", () => {
  test("editing a published asset updates its tokenURI without a new mint", async ({
    page,
  }) => {
    await connectStudio(page);

    // ── Reach a published token (proven generate → save → publish path) ──
    const tokenIdHex = await generateSaveAndPublish(page, ASSET_NAME, PROMPT);

    // tokenURI returns a collection manifest - walk through collection → asset.
    const firstCollection = await fetchTokenManifest(tokenIdHex);
    assertCollectionManifest(firstCollection, { expectedAssetIds: undefined });
    expect(Object.keys(firstCollection.assets).length).toBeGreaterThanOrEqual(1);
    const firstVersion = firstCollection.version;
    expect(firstVersion).toBeGreaterThanOrEqual(1);

    const firstAssetCid = await findAssetCidByName(firstCollection, ASSET_NAME);
    expect(firstAssetCid).toBeTruthy();
    const firstAsset = await fetchManifest(firstAssetCid);
    expect(firstAsset.type).toBe("asset");
    expect(firstAsset.name).toBe(ASSET_NAME);
    assertPublishedManifest(firstAsset);

    // ── Edit the published asset (a real change so the save isn't a no-op) ──
    await editFirstNodeColor(page, EDIT_COLOR);

    // ── Republish: "Besk it" on an already-named token updates the tokenURI
    //    (no name dialog, no new mint - the ?asset token id stays the same). ──
    await page.click(SELECTORS.publishAssetBtn);

    // Durable signal: the on-chain tokenURI now resolves to a newer collection
    // version. expect.poll retries on a thrown error, so no fetch fallback is needed.
    await expect
      .poll(async () => (await fetchTokenManifest(tokenIdHex)).version, {
        timeout: 30000,
        intervals: [500, 1000, 1000],
      })
      .toBeGreaterThan(firstVersion);

    // Same token - just a newer collection manifest version pinned to it.
    const republishedCollection = await fetchTokenManifest(tokenIdHex);
    assertCollectionManifest(republishedCollection, {
      expectedAssetIds: undefined,
    });
    expect(Object.keys(republishedCollection.assets).length).toBeGreaterThanOrEqual(1);
    expect(republishedCollection.version).toBeGreaterThan(firstVersion);

    const republishedAssetCid = await findAssetCidByName(
      republishedCollection,
      ASSET_NAME,
    );
    expect(republishedAssetCid).toBeTruthy();
    const republishedAsset = await fetchManifest(republishedAssetCid);
    expect(republishedAsset.type).toBe("asset");
    expect(republishedAsset.name).toBe(ASSET_NAME);

    // URL still anchors to the same token (no remint).
    expect(BigInt(tokenIdHexFromUrl(page.url()))).toBe(BigInt(tokenIdHex));
  });
});
