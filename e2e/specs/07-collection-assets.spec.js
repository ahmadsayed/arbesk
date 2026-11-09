import { test, expect } from "../fixtures/coverage.mjs";
import { SELECTORS } from "../helpers/studio-selectors.mjs";
import {
  MANIFEST_URL_REGEX,
  fetchManifest,
  fetchTokenManifest,
  assertCollectionManifest,
  findAssetCidByName,
} from "../helpers/manifest.mjs";
import {
  assetCardLocator,
  connectStudio,
  ensureStudioConnected,
  openAssetCard,
  selectProvider,
  sendPendingGenerationToStudio,
  uniqueAssetName,
  startEmptyAsset,
} from "../helpers/flows.mjs";

const PROMPT_1 = "a wooden chair";
const PROMPT_2 = "a small round table";

function tokenIdHexFromUrl(url) {
  return new URL(url).searchParams.get("asset");
}

/**
 * @typedef {{
 *   tokenIdHex: string,
 *   tokenIdDec: string,
 *   firstAssetName: string,
 *   firstAssetId: string,
 * }} PublishedCollection
 */

// Run tests sequentially - they share the same wallet + Hardhat chain.
test.describe.serial("Collection/asset model", () => {
  /** @type {PublishedCollection | null} */
  let published = null;

  test.beforeEach(({ page }) => {
    // startNewAsset() uses a native confirm(); auto-accept so the new-asset
    // flow actually clears in-memory state instead of no-oping.
    page.on("dialog", (d) => d.accept());
  });

  test("publishes two assets into one lazily-minted default collection", async ({
    page,
  }) => {
    await connectStudio(page);
    await expect(page.locator(SELECTORS.connectWalletBtn)).toBeHidden();

    const firstAssetName = uniqueAssetName("Chair Test");

    // The composer defaults to Auto; pin the mock provider (no Jev key here).
    await selectProvider(page, "mock");
    await page.fill(SELECTORS.promptInput, PROMPT_1);
    await page.click(SELECTORS.generateBtn);
    await sendPendingGenerationToStudio(page);
    await expect(page.locator(SELECTORS.chatHistoryList)).toContainText(
      "Model carved via mock",
    );
    await page.waitForURL(MANIFEST_URL_REGEX);

    await page.click(SELECTORS.publishAssetBtn);
    await expect(page.locator(SELECTORS.dialogInput)).toBeVisible();
    await page.fill(SELECTORS.dialogInput, firstAssetName);
    await page.click(SELECTORS.dialogConfirmBtn);

    await page.waitForURL(/[?&]asset=0x[0-9a-fA-F]+/, { timeout: 30000 });
    const tokenIdHex = page.url().match(/[?&]asset=(0x[0-9a-fA-F]+)/)[1];
    const tokenIdDec = BigInt(tokenIdHex).toString();

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
    const firstAssetManifest = await fetchManifest(firstAssetCid);
    expect(firstAssetManifest.type).toBe("asset");
    expect(firstAssetManifest.scene.nodes).toHaveLength(1);

    // Locate our own asset within the (possibly pre-populated) collection so
    // the later deep-link/viewport tests open the asset this spec published.
    const ourAssetCid = await findAssetCidByName(
      collectionManifest,
      firstAssetName,
    );
    expect(ourAssetCid).toBeTruthy();
    const firstAssetId = assetIds.find(
      (id) => collectionManifest.assets[id] === ourAssetCid,
    );
    expect(firstAssetId).toBeTruthy();

    const firstAssetIds = Object.keys(collectionManifest.assets);

    // ── Second asset lands in the same collection as a sibling while the
    // New Asset flow preserves the collection context ────────────────
    const savedCollectionId = await page
      .locator(SELECTORS.collectionSelect)
      .inputValue();
    expect(savedCollectionId).toBeTruthy();

    // startNewAsset() shows a GNOME HIG name dialog after the native
    // confirm() (which is auto-accepted by beforeEach).
    await startEmptyAsset(page);
    await expect(page.locator(SELECTORS.dialogInput)).toBeVisible();
    await page.fill(SELECTORS.dialogInput, uniqueAssetName("Table"));
    await page.click(SELECTORS.dialogConfirmBtn);

    await expect(page.locator(SELECTORS.collectionSelect)).toHaveValue(
      savedCollectionId,
    );

    // The composer defaults to Auto; pin the mock provider (no Jev key here).
    await selectProvider(page, "mock");
    await page.fill(SELECTORS.promptInput, PROMPT_2);
    await page.click(SELECTORS.generateBtn);
    await sendPendingGenerationToStudio(page);
    await expect(page.locator(SELECTORS.chatHistoryList)).toContainText(
      "Model carved via mock",
    );

    await page.click(SELECTORS.publishAssetBtn);
    await page.waitForURL(/[?&]asset=0x[0-9a-fA-F]+/, { timeout: 30000 });
    const secondTokenIdHex = page.url().match(/[?&]asset=(0x[0-9a-fA-F]+)/)[1];

    expect(secondTokenIdHex).toBe(tokenIdHex);

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
      expect(updatedCollection.assets[id]).toBe(collectionManifest.assets[id]);
    }
    expect(Object.keys(updatedCollection.assets).length).toBeGreaterThanOrEqual(
      2,
    );

    published = {
      tokenIdHex,
      tokenIdDec,
      firstAssetName,
      firstAssetId,
    };
  });

  test("opening a published token renders the first asset in the viewport", async ({
    page,
  }) => {
    const { tokenIdHex, tokenIdDec, firstAssetName } = published;
    await connectStudio(page);
    await expect(page.locator(SELECTORS.connectWalletBtn)).toBeHidden();

    // The open asset's own card can't be reopened; start a fresh empty asset
    // so the published one is an ordinary card, then click it to open.
    await startEmptyAsset(page);
    await page.fill(SELECTORS.dialogInput, uniqueAssetName("Scratch"));
    await page.click(SELECTORS.dialogConfirmBtn);
    await page.click(SELECTORS.gallerySwitcherBtn);
    const assetCard = assetCardLocator(page, tokenIdDec, firstAssetName);
    await expect(assetCard).toHaveCount(1);

    await openAssetCard(assetCard);
    await page.waitForURL((url) => {
      const a = new URL(url.toString()).searchParams.get("asset");
      return a != null && BigInt(a) === BigInt(tokenIdHex);
    });

    await expect(page.locator(SELECTORS.assetStatusName)).not.toContainText(
      "No asset open",
    );
    await expect(page.locator(SELECTORS.assetStatusName)).toContainText(
      firstAssetName,
    );

    const urlTokenHex = tokenIdHexFromUrl(page.url());
    expect(BigInt(urlTokenHex)).toBe(BigInt(tokenIdHex));
  });

  test("page reload with ?asset=TOKENID restores the viewport", async ({
    page,
  }) => {
    const { tokenIdHex, firstAssetId, firstAssetName } = published;
    await connectStudio(page);
    await expect(page.locator(SELECTORS.connectWalletBtn)).toBeHidden();

    // A bare ?asset=<collectionTokenId> opens the collection in the Gallery
    // sidebar with an empty viewport. To restore the viewport we must include
    // an explicit assetId. Reuse the first asset published above.
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
      firstAssetName,
      { timeout: 30000 },
    );

    const urlTokenHex = tokenIdHexFromUrl(page.url());
    expect(BigInt(urlTokenHex)).toBe(BigInt(tokenIdHex));
  });
});
