import { test, expect } from "@playwright/test";
import { injectHardhatProvider } from "../fixtures/hardhat-provider.mjs";
import { SELECTORS } from "../helpers/studio-selectors.mjs";
import {
  fetchManifest,
  fetchTokenManifest,
  assertGenerationManifest,
  assertSavedManifest,
  assertPublishedManifest,
  assertCollectionManifest,
} from "../helpers/manifest.mjs";

const PROMPT = "cowboy";
const ASSET_NAME = "Cowboy Test";

function manifestCidFromUrl(url) {
  return new URL(url).searchParams.get("manifest");
}

test.describe("save and publish", () => {
  test("saves a draft and publishes an ERC-721 token", async ({ page }) => {
    await injectHardhatProvider(page);
    await page.goto("/studio.html");

    await expect(page.locator(SELECTORS.connectWalletBtn)).toBeHidden();
    await expect(page.locator(SELECTORS.disconnectWalletBtn)).not.toContainText(
      "Sign In",
    );

    // 1. Generate
    await page.fill(SELECTORS.promptInput, PROMPT);
    await page.click(SELECTORS.generateBtn);
    await expect(page.locator(SELECTORS.chatHistoryList)).toContainText(
      "Model carved via mock",
    );

    await page.waitForURL(/[?&]manifest=Qm[\w]+/);
    const genCid = manifestCidFromUrl(page.url());
    expect(genCid).toBeTruthy();

    const genManifest = await fetchManifest(genCid);
    assertGenerationManifest(genManifest, { prompt: PROMPT, provider: "mock" });

    // 2. Save draft (no rename dialog — draft keeps current name). Wait on the
    // URL flipping to a new manifest CID, which is the durable signal that the
    // save completed (the screen-reader status text is transient/overwritten).
    await page.click(SELECTORS.saveAssetBtn);
    await page.waitForURL((url) => {
      const cid = manifestCidFromUrl(url.toString());
      return Boolean(cid) && cid !== genCid;
    });
    const saveCid = manifestCidFromUrl(page.url());
    expect(saveCid).not.toBe(genCid);

    const savedManifest = await fetchManifest(saveCid);
    assertSavedManifest(savedManifest, genCid);

    // 3. Publish — first-time publish prompts for an explicit name.
    await page.click(SELECTORS.publishAssetBtn);
    await expect(page.locator(SELECTORS.dialogInput)).toBeVisible();
    await page.fill(SELECTORS.dialogInput, ASSET_NAME);
    await page.click(SELECTORS.dialogConfirmBtn);

    // Minting is the slowest step; wait on the durable ?asset=<tokenId> anchor.
    // Publish writes the token id to the URL in HEX (it derives it as a hash of
    // the CID), but the gallery lists the same token by its DECIMAL on-chain id.
    // They are the same number — compare numerically, never as strings.
    await page.waitForURL(/[?&]asset=0x[0-9a-fA-F]+/, { timeout: 10000 });
    const tokenIdHex = page.url().match(/[?&]asset=(0x[0-9a-fA-F]+)/)[1];
    const tokenIdDec = BigInt(tokenIdHex).toString();

    // tokenURI now returns a collection manifest, not an asset manifest.
    // Walk through collection → first asset to validate the published content.
    const collectionManifest = await fetchTokenManifest(tokenIdHex);
    expect(collectionManifest).toBeTruthy();
    assertCollectionManifest(collectionManifest, {
      expectedAssetIds: undefined,
    });
    expect(Object.keys(collectionManifest.assets)).toHaveLength(1);

    const [firstAssetCid] = Object.values(collectionManifest.assets);
    const assetManifest = await fetchManifest(firstAssetCid);
    expect(assetManifest.type).toBe("asset");
    assertPublishedManifest(assetManifest);
    expect(assetManifest.name).toBe(ASSET_NAME);

    // 4. Open the Gallery and verify the published asset card appears. The
    // gallery shows collection card format: "Collection #TOKENID (1 asset)".
    // Scope to THIS token's card by its on-chain (decimal) id.
    await page.click(SELECTORS.gallerySwitcherBtn);
    const assetCard = page.locator(
      `${SELECTORS.assetCard}[data-token-id="${tokenIdDec}"]`,
    );
    await expect(assetCard).toHaveCount(1);
    await expect(assetCard.locator(SELECTORS.assetCardName)).toContainText(
      "1 asset",
    );

    // Clicking the card body (not the buttons) should open the asset. The
    // gallery opens by decimal id, so assert the ?asset value numerically.
    await assetCard.click({ position: { x: 10, y: 10 } });
    await page.waitForURL((url) => {
      const a = new URL(url.toString()).searchParams.get("asset");
      return a != null && BigInt(a) === BigInt(tokenIdHex);
    });
    await expect(page.locator(SELECTORS.assetStatusName)).toContainText(
      ASSET_NAME,
    );

    // 5. Burn the asset from the gallery card.
    await page.click(SELECTORS.gallerySwitcherBtn);
    await expect(assetCard.locator(SELECTORS.assetCardBurnBtn)).toBeVisible();
    await assetCard.locator(SELECTORS.assetCardBurnBtn).click();

    // Confirm the destructive action in the GNOME-style dialog.
    await expect(page.locator(SELECTORS.dialogBurnBtn)).toBeVisible();
    await page.click(SELECTORS.dialogBurnBtn);

    // After burning, this specific card should disappear from the gallery.
    await expect(assetCard).toHaveCount(0, { timeout: 5000 });
    // The active asset should be cleared.
    await expect(page.locator(SELECTORS.assetStatusName)).toContainText(
      "No asset open",
    );
  });
});
