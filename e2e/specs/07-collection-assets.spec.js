import { test, expect } from "../fixtures/coverage.mjs";
import { injectHardhatProvider } from "../fixtures/hardhat-provider.mjs";
import { SELECTORS } from "../helpers/studio-selectors.mjs";
import {
  MANIFEST_URL_REGEX,
  fetchManifest,
  fetchTokenManifest,
  assertCollectionManifest,
} from "../helpers/manifest.mjs";
import { assetCardLocator, connectStudio, ensureStudioConnected, uniqueAssetName } from "../helpers/flows.mjs";

const PROMPT_1 = "a wooden chair";
const PROMPT_2 = "a small round table";
const ASSET_NAME_1 = "Chair Test";

function tokenIdHexFromUrl(url) {
  return new URL(url).searchParams.get("asset");
}

// Run tests sequentially - they share the same wallet + Hardhat chain.
test.describe.serial("Collection/asset model", () => {
  test.beforeEach(({ page }) => {
    // startNewAsset() uses a native confirm(); auto-accept so the new-asset
    // flow actually clears in-memory state instead of no-oping.
    page.on("dialog", (d) => d.accept());
  });
  test("first besk lazily mints a default collection containing at least one asset", async ({
    page,
  }) => {
    await connectStudio(page);
    await expect(page.locator(SELECTORS.connectWalletBtn)).toBeHidden();

    await page.fill(SELECTORS.promptInput, PROMPT_1);
    await page.click(SELECTORS.generateBtn);
    await expect(page.locator(SELECTORS.chatHistoryList)).toContainText(
      "Model carved via mock",
    );
    await page.waitForURL(MANIFEST_URL_REGEX);

    await page.click(SELECTORS.publishAssetBtn);
    await expect(page.locator(SELECTORS.dialogInput)).toBeVisible();
    await page.fill(SELECTORS.dialogInput, ASSET_NAME_1);
    await page.click(SELECTORS.dialogConfirmBtn);

    await page.waitForURL(/[?&]asset=0x[0-9a-fA-F]+/, { timeout: 30000 });
    const tokenIdHex = page.url().match(/[?&]asset=(0x[0-9a-fA-F]+)/)[1];

    const collectionManifest = await fetchTokenManifest(tokenIdHex);
    assertCollectionManifest(collectionManifest, {
      expectedAssetIds: undefined,
    });
    // At least one asset - other test files may have published to this wallet too.
    expect(
      Object.keys(collectionManifest.assets).length,
    ).toBeGreaterThanOrEqual(1);

    const assetIds = Object.keys(collectionManifest.assets);
    const firstAssetCid = collectionManifest.assets[assetIds[0]];
    const assetManifest = await fetchManifest(firstAssetCid);
    expect(assetManifest.type).toBe("asset");
    expect(assetManifest.scene.nodes).toHaveLength(1);
  });

  test("a second besk in the same collection adds a sibling without disturbing existing ones", async ({
    page,
  }) => {
    await connectStudio(page);
    await expect(page.locator(SELECTORS.connectWalletBtn)).toBeHidden();

    await page.fill(SELECTORS.promptInput, PROMPT_1);
    await page.click(SELECTORS.generateBtn);
    await expect(page.locator(SELECTORS.chatHistoryList)).toContainText(
      "Model carved via mock",
    );
    await page.waitForURL(MANIFEST_URL_REGEX);

    await page.click(SELECTORS.publishAssetBtn);
    await expect(page.locator(SELECTORS.dialogInput)).toBeVisible();
    await page.fill(SELECTORS.dialogInput, "Chair");
    await page.click(SELECTORS.dialogConfirmBtn);

    await page.waitForURL(/[?&]asset=0x[0-9a-fA-F]+/, { timeout: 30000 });
    const firstTokenIdHex = page.url().match(/[?&]asset=(0x[0-9a-fA-F]+)/)[1];
    const firstCollection = await fetchTokenManifest(firstTokenIdHex);
    const firstAssetIds = Object.keys(firstCollection.assets);

    // Start fresh asset. startNewAsset() shows a GNOME HIG name dialog after
    // the native confirm() (which is auto-accepted by beforeEach).
    await page.click(SELECTORS.newAssetBtn);
    await expect(page.locator(SELECTORS.dialogInput)).toBeVisible();
    await page.fill(SELECTORS.dialogInput, "Table");
    await page.click(SELECTORS.dialogConfirmBtn);

    await page.fill(SELECTORS.promptInput, PROMPT_2);
    await page.click(SELECTORS.generateBtn);
    await expect(page.locator(SELECTORS.chatHistoryList)).toContainText(
      "Model carved via mock",
    );

    await page.click(SELECTORS.publishAssetBtn);
    await page.waitForURL(/[?&]asset=0x[0-9a-fA-F]+/, { timeout: 30000 });
    const secondTokenIdHex = page.url().match(/[?&]asset=(0x[0-9a-fA-F]+)/)[1];

    expect(secondTokenIdHex).toBe(firstTokenIdHex);

    // The URL already contained ?asset= from the first publish, so waitForURL
    // may return before the republish transaction lands. Poll the on-chain
    // collection until the new asset is reflected.
    await expect
      .poll(
        async () =>
          Object.keys(
            (await fetchTokenManifest(secondTokenIdHex)).assets || {},
          ).length,
        {
          timeout: 30000,
          message: "collection manifest to include the new asset",
        },
      )
      .toBeGreaterThanOrEqual(firstAssetIds.length + 1);

    const updatedCollection = await fetchTokenManifest(secondTokenIdHex);

    // All assets from the first snapshot must still be present.
    for (const id of firstAssetIds) {
      expect(updatedCollection.assets[id]).toBe(firstCollection.assets[id]);
    }
  });

  test("opening a published token renders the first asset in the viewport", async ({
    page,
  }) => {
    await connectStudio(page);
    await expect(page.locator(SELECTORS.connectWalletBtn)).toBeHidden();

    await page.fill(SELECTORS.promptInput, PROMPT_1);
    await page.click(SELECTORS.generateBtn);
    await expect(page.locator(SELECTORS.chatHistoryList)).toContainText(
      "Model carved via mock",
    );
    await page.waitForURL(MANIFEST_URL_REGEX);

    await page.click(SELECTORS.publishAssetBtn);
    await expect(page.locator(SELECTORS.dialogInput)).toBeVisible();
    const viewportName = uniqueAssetName("Chair Viewport");
    await page.fill(SELECTORS.dialogInput, viewportName);
    await page.click(SELECTORS.dialogConfirmBtn);

    await page.waitForURL(/[?&]asset=0x[0-9a-fA-F]+/, { timeout: 30000 });
    const tokenIdHex = tokenIdHexFromUrl(page.url());
    const tokenIdDec = BigInt(tokenIdHex).toString();

    await page.click(SELECTORS.gallerySwitcherBtn);
    const assetCard = assetCardLocator(page, tokenIdDec, viewportName);
    await expect(assetCard).toHaveCount(1);

    await assetCard.click({ position: { x: 10, y: 10 } });
    await page.waitForURL((url) => {
      const a = new URL(url.toString()).searchParams.get("asset");
      return a != null && BigInt(a) === BigInt(tokenIdHex);
    });

    await expect(page.locator(SELECTORS.assetStatusName)).not.toContainText(
      "No asset open",
    );
    await expect(page.locator(SELECTORS.assetStatusName)).toContainText(
      viewportName,
    );

    const urlTokenHex = tokenIdHexFromUrl(page.url());
    expect(BigInt(urlTokenHex)).toBe(BigInt(tokenIdHex));
  });

  test("New Asset button clears the scene but preserves collection context", async ({
    page,
  }) => {
    await connectStudio(page);
    await expect(page.locator(SELECTORS.connectWalletBtn)).toBeHidden();

    const savedCollectionId = await page
      .locator(SELECTORS.collectionSelect)
      .inputValue();
    expect(savedCollectionId).toBeTruthy();

    await page.fill(SELECTORS.promptInput, PROMPT_1);
    await page.click(SELECTORS.generateBtn);
    await expect(page.locator(SELECTORS.chatHistoryList)).toContainText(
      "Model carved via mock",
    );
    await page.waitForURL(MANIFEST_URL_REGEX);

    await page.click(SELECTORS.publishAssetBtn);
    await expect(page.locator(SELECTORS.dialogInput)).toBeVisible();
    const contextChairName = "Chair Context";
    await page.fill(SELECTORS.dialogInput, contextChairName);
    await page.click(SELECTORS.dialogConfirmBtn);

    await page.waitForURL(
      (url) => /[?&]asset=0x[0-9a-fA-F]+/.test(url.toString()),
      { timeout: 30000 },
    );
    const firstTokenIdHex = tokenIdHexFromUrl(page.url());
    expect(firstTokenIdHex).toBeTruthy();

    await page.click(SELECTORS.newAssetBtn);
    await expect(page.locator(SELECTORS.dialogInput)).toBeVisible();
    await page.fill(SELECTORS.dialogInput, "Untitled Asset");
    await page.click(SELECTORS.dialogConfirmBtn);

    await expect(page.locator(SELECTORS.collectionSelect)).toHaveValue(
      savedCollectionId,
    );

    await page.fill(SELECTORS.promptInput, PROMPT_2);
    await page.click(SELECTORS.generateBtn);
    await expect(page.locator(SELECTORS.chatHistoryList)).toContainText(
      "Model carved via mock",
    );

    await page.click(SELECTORS.publishAssetBtn);
    await expect(page.locator(SELECTORS.dialogInput)).toBeVisible();
    const contextTableName = "Table Context";
    await page.fill(SELECTORS.dialogInput, contextTableName);
    await page.click(SELECTORS.dialogConfirmBtn);

    await page.waitForURL(
      (url) => /[?&]asset=0x[0-9a-fA-F]+/.test(url.toString()),
      { timeout: 30000 },
    );
    const secondTokenIdHex = tokenIdHexFromUrl(page.url());
    expect(secondTokenIdHex).toBe(firstTokenIdHex);

    const updatedCollection = await fetchTokenManifest(secondTokenIdHex);
    expect(Object.keys(updatedCollection.assets).length).toBeGreaterThanOrEqual(
      2,
    );
  });

  test("page reload with ?asset=TOKENID restores the viewport", async ({
    page,
  }) => {
    await connectStudio(page);
    await expect(page.locator(SELECTORS.connectWalletBtn)).toBeHidden();

    await page.fill(SELECTORS.promptInput, PROMPT_1);
    await page.click(SELECTORS.generateBtn);
    await expect(page.locator(SELECTORS.chatHistoryList)).toContainText(
      "Model carved via mock",
    );
    await page.waitForURL(MANIFEST_URL_REGEX);

    await page.click(SELECTORS.publishAssetBtn);
    await expect(page.locator(SELECTORS.dialogInput)).toBeVisible();
    await page.fill(SELECTORS.dialogInput, ASSET_NAME_1);
    await page.click(SELECTORS.dialogConfirmBtn);

    await page.waitForURL(/[?&]asset=0x[0-9a-fA-F]+/, { timeout: 30000 });
    const tokenIdHex = tokenIdHexFromUrl(page.url());

    // A bare ?asset=<collectionTokenId> opens the collection in the Gallery
    // sidebar with an empty viewport. To restore the viewport we must include
    // an explicit assetId. Pick the first asset of the published collection.
    const collection = await fetchTokenManifest(tokenIdHex);
    const firstAssetId = Object.keys(collection.assets)[0];
    const firstAssetCid = collection.assets[firstAssetId];
    const firstAsset = await fetchManifest(firstAssetCid);

    await page.goto(
      `/studio?asset=${tokenIdHex}&assetId=${firstAssetId}`,
    );
    await ensureStudioConnected(page);
    await expect(page.locator(SELECTORS.connectWalletBtn)).toBeHidden({
      timeout: 5000,
    });

    await expect(page.locator(SELECTORS.assetStatusName)).not.toContainText(
      "No asset open",
      { timeout: 30000 },
    );
    await expect(page.locator(SELECTORS.assetStatusName)).toContainText(
      firstAsset.name,
      { timeout: 30000 },
    );

    const urlTokenHex = tokenIdHexFromUrl(page.url());
    expect(BigInt(urlTokenHex)).toBe(BigInt(tokenIdHex));
  });

  test("collection selector populates on wallet connect", async ({ page }) => {
    await injectHardhatProvider(page);
    await page.goto("/studio");

    // The injected provider reports an authorized account, so the wallet
    // silently auto-restores on load (autoConnectWallet in wallet-core) — this
    // simulates a returning user. Ensure we're connected, then verify the
    // collection selector shows the wallet-derived Default collection.
    await ensureStudioConnected(page);
    await expect(page.locator(SELECTORS.connectWalletBtn)).toBeHidden();

    // The sidebar defaults to Chat; open Settings to reveal the collection select.
    await page.click(SELECTORS.settingsSwitcherBtn);

    const collectionSelect = page.locator(SELECTORS.collectionSelect);
    await expect(collectionSelect).toBeVisible();

    const options = collectionSelect.locator("option");
    await expect(options).toHaveCount(1);
    await expect(options.first()).toHaveText("Default");

    // The single Default option carries the wallet-derived collection id
    // (soliditySha3 of the connected address), not the empty placeholder value.
    const defaultValue = await options.first().getAttribute("value");
    expect(defaultValue).toBeTruthy();

    const expectedId = await page.evaluate(() => {
      return window.Web3.utils.soliditySha3({
        type: "address",
        value: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      });
    });
    expect(defaultValue).toBe(expectedId);
  });
});
