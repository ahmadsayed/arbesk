import { test, expect } from "../fixtures/coverage.mjs";
import { SELECTORS } from "../helpers/studio-selectors.mjs";
import {
  fetchManifest,
  fetchTokenManifest,
  assertCollectionManifest,
} from "../helpers/manifest.mjs";
import {
  connectLibrary,
  libraryAssetLocator,
  openLibraryCollection,
  openLibraryAssetInStudio,
  generateSaveAndPublish,
  uniqueAssetName,
} from "../helpers/flows.mjs";

const ASSET_NAME_BASE = "Roundtrip Asset";
const PROMPT = "a blue cylinder";

// Studio/Library round-trip tests mutate the shared chain; run serially.
test.describe.serial("Library ↔ Studio round-trip", () => {
  test("asset published in Studio appears in the library", async ({ page }) => {
    const assetName = uniqueAssetName(ASSET_NAME_BASE);
    await connectLibrary(page);

    await page.goto("/studio.html");
    await expect(page.locator(SELECTORS.connectWalletBtn)).toBeHidden();
    const tokenIdHex = await generateSaveAndPublish(page, assetName, PROMPT);

    await page.goto("/library.html");
    await openLibraryCollection(page, "Default");
    await expect(libraryAssetLocator(page, assetName).first()).toBeVisible();

    // The on-chain collection manifest contains the asset.
    const collection = await fetchTokenManifest(tokenIdHex);
    assertCollectionManifest(collection);
    const assetCids = Object.values(collection.assets);
    expect(assetCids.length).toBeGreaterThanOrEqual(1);

    const assetNames = await Promise.all(
      assetCids.map(async (cid) => (await fetchManifest(cid)).name),
    );
    expect(assetNames).toContain(assetName);
  });

  test("opening an asset from the library loads it into Studio", async ({
    page,
  }) => {
    const assetName = uniqueAssetName(ASSET_NAME_BASE);
    await connectLibrary(page);

    await page.goto("/studio.html");
    await expect(page.locator(SELECTORS.connectWalletBtn)).toBeHidden();
    const tokenIdHex = await generateSaveAndPublish(page, assetName, PROMPT);

    await page.goto("/library.html");
    await openLibraryCollection(page, "Default");
    await openLibraryAssetInStudio(page, assetName);

    // URL must include both the collection token and the specific assetId.
    // The library passes the token id in decimal; Studio accepts either form.
    const url = new URL(page.url());
    expect(BigInt(url.searchParams.get("asset"))).toBe(BigInt(tokenIdHex));
    expect(url.searchParams.has("assetId")).toBe(true);

    await expect(page.locator(SELECTORS.assetStatusName)).toContainText(
      assetName,
    );
  });

});
