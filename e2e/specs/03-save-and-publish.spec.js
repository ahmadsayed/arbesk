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
  assetCardLocator,
  connectStudio,
  openAssetCard,
  selectProvider,
  sendPendingGenerationToStudio,
  startEmptyAsset,
} from "../helpers/flows.mjs";

const PROMPT = "cowboy";
const ASSET_NAME = "Cowboy Test";

function manifestCidFromUrl(url) {
  return new URL(url).searchParams.get("manifest");
}

test.describe("save and publish", () => {
  test("saves a draft and publishes an ERC-721 token", async ({ page }) => {
    // startNewAsset() uses a native confirm() when work is unpublished;
    // auto-accept so the scratch-asset step below can proceed.
    page.on("dialog", (d) => d.accept());
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
    // Publish writes the token id to the URL in HEX (it derives it as a hash of
    // the CID), but the gallery lists the same token by its DECIMAL on-chain id.
    // They are the same number - compare numerically, never as strings.
    await page.waitForURL(/[?&]asset=0x[0-9a-fA-F]+/, { timeout: 30000 });
    const tokenIdHex = page.url().match(/[?&]asset=(0x[0-9a-fA-F]+)/)[1];
    const tokenIdDec = BigInt(tokenIdHex).toString();

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

    // 4. Open the Gallery and verify the published asset card appears.
    // The card is scoped to THIS token's on-chain (decimal) id and shows
    // the published asset name.
    // The open asset's own card is listed but marked current (it can't be
    // reopened or inserted into itself); starting a fresh empty asset makes it
    // an ordinary card again.
    await page.click(SELECTORS.gallerySwitcherBtn);
    const assetCard = assetCardLocator(page, tokenIdDec, ASSET_NAME);
    await expect(assetCard).toHaveCount(1);
    await expect(assetCard.locator(SELECTORS.assetCardMain)).toHaveAttribute("aria-current", "true");
    await expect(assetCard.locator(SELECTORS.assetCardMain)).toBeDisabled();
    await startEmptyAsset(page);
    await page.fill(SELECTORS.dialogInput, "Scratch Asset");
    await page.click(SELECTORS.dialogConfirmBtn);
    await page.click(SELECTORS.gallerySwitcherBtn);
    await expect(assetCard.locator(SELECTORS.assetCardMain)).toBeEnabled();
    await expect(assetCard.locator(SELECTORS.assetCardName)).toContainText(
      ASSET_NAME,
    );

    // Clicking the card opens the asset. The gallery opens by decimal id, so
    // assert the ?asset value numerically.
    await openAssetCard(assetCard);
    await page.waitForURL((url) => {
      const a = new URL(url.toString()).searchParams.get("asset");
      return a != null && BigInt(a) === BigInt(tokenIdHex);
    });
    await expect(page.locator(SELECTORS.assetStatusName)).toContainText(
      ASSET_NAME,
    );

    // 5. The now-open asset's card is listed again, marked current.
    await page.click(SELECTORS.gallerySwitcherBtn);
    await expect(assetCard).toHaveCount(1);
    await expect(assetCard.locator(SELECTORS.assetCardMain)).toHaveAttribute("aria-current", "true");
  });
});
