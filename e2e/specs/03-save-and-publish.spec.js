import { test, expect } from "../fixtures/coverage.mjs";
import { SELECTORS } from "../helpers/studio-selectors.mjs";
import {
  MANIFEST_URL_REGEX,
  fetchManifest,
  fetchTokenManifest,
  assertGenerationManifest,
  assertSavedManifest,
  assertPublishedManifest,
  assertCollectionManifest,
} from "../helpers/manifest.mjs";
import {
  connectStudio,
  selectProvider,
  sendPendingGenerationToStudio,
} from "../helpers/flows.mjs";

const PROMPT = "cowboy";
const ASSET_NAME = "Cowboy Test";

function manifestCidFromUrl(url) {
  return new URL(url).searchParams.get("manifest");
}

test.describe("save and publish", () => {
  test("saves a draft and publishes an ERC-721 token", async ({ page }) => {
    await connectStudio(page);

    await expect(page.locator(SELECTORS.connectWalletBtn)).toBeHidden();
    await expect(page.locator(SELECTORS.disconnectWalletBtn)).not.toContainText(
      "Sign In",
    );

    // 1. Generate → Show in Studio (auto-saves the draft). The composer
    // defaults to Auto; pin the mock provider (the e2e stack has no Jev key).
    await selectProvider(page, "mock");
    await page.fill(SELECTORS.promptInput, PROMPT);
    await page.click(SELECTORS.generateBtn);
    await sendPendingGenerationToStudio(page);
    await expect(page.locator(SELECTORS.chatHistoryList)).toContainText(
      "Model carved via mock",
    );

    await page.waitForURL(MANIFEST_URL_REGEX);
    const saveCid = manifestCidFromUrl(page.url());
    expect(saveCid).toBeTruthy();

    // 2. Show in Studio auto-saved the draft: the URL CID is the saved v2 and
    // the raw generation manifest (v1) is its prev. A manual Save here would
    // be a no-op ("no changes"), so the flow goes straight to publish.
    const savedManifest = await fetchManifest(saveCid);
    const genCid = savedManifest.prev_asset_manifest_cid;
    expect(genCid).toBeTruthy();

    const genManifest = await fetchManifest(genCid);
    assertGenerationManifest(genManifest, { prompt: PROMPT, provider: "mock" });
    assertSavedManifest(savedManifest, genCid);

    // 3. Publish - first-time publish prompts for an explicit name.
    await page.click(SELECTORS.publishAssetBtn);
    await expect(page.locator(SELECTORS.dialogInput)).toBeVisible();
    await page.fill(SELECTORS.dialogInput, ASSET_NAME);
    await page.click(SELECTORS.dialogConfirmBtn);

    // Minting is the slowest step; wait on the durable ?asset=<tokenId> anchor.
    await page.waitForURL(/[?&]asset=0x[0-9a-fA-F]+/, { timeout: 30000 });
    const tokenIdHex = page.url().match(/[?&]asset=(0x[0-9a-fA-F]+)/)[1];

    // tokenURI now returns a collection manifest, not an asset manifest.
    // Walk through collection → first asset to validate the published content.
    const collectionManifest = await fetchTokenManifest(tokenIdHex);
    expect(collectionManifest).toBeTruthy();
    assertCollectionManifest(collectionManifest, {
      expectedAssetIds: undefined,
    });
    expect(Object.keys(collectionManifest.assets).length).toBeGreaterThanOrEqual(1);

    const [firstAssetCid] = Object.values(collectionManifest.assets);
    const assetManifest = await fetchManifest(firstAssetCid);
    expect(assetManifest.type).toBe("asset");
    assertPublishedManifest(assetManifest);
    expect(assetManifest.name).toBe(ASSET_NAME);
  });
});
