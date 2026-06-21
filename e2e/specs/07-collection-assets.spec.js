import { test, expect } from "@playwright/test";
import { injectHardhatProvider } from "../fixtures/hardhat-provider.mjs";
import { SELECTORS } from "../helpers/studio-selectors.mjs";
import {
  fetchManifest,
  fetchTokenManifest,
  assertCollectionManifest,
} from "../helpers/manifest.mjs";

const PROMPT_1 = "a wooden chair";
const PROMPT_2 = "a small round table";

function manifestCidFromUrl(url) {
  return new URL(url).searchParams.get("manifest");
}

test.describe("Collection/asset model", () => {
  test("first besk lazily mints a default collection containing one asset", async ({
    page,
  }) => {
    await injectHardhatProvider(page);
    await page.goto("/studio.html");

    await expect(page.locator(SELECTORS.connectWalletBtn)).toBeHidden();

    // 1. Generate
    await page.fill(SELECTORS.promptInput, PROMPT_1);
    await page.click(SELECTORS.generateBtn);
    await expect(page.locator(SELECTORS.chatHistoryList)).toContainText(
      "Model carved via mock",
    );
    await page.waitForURL(/[?&]manifest=Qm[\w]+/);

    // 2. Publish (first-time besk → lazy-mints default collection)
    await page.click(SELECTORS.publishAssetBtn);
    await expect(page.locator(SELECTORS.dialogInput)).toBeVisible();
    await page.fill(SELECTORS.dialogInput, "Chair Test");
    await page.click(SELECTORS.dialogConfirmBtn);

    await page.waitForURL(/[?&]asset=0x[0-9a-fA-F]+/, { timeout: 30000 });
    const tokenIdHex = page.url().match(/[?&]asset=(0x[0-9a-fA-F]+)/)[1];

    const collectionManifest = await fetchTokenManifest(tokenIdHex);
    assertCollectionManifest(collectionManifest, { expectedAssetIds: undefined });
    expect(Object.keys(collectionManifest.assets)).toHaveLength(1);

    const [assetCid] = Object.values(collectionManifest.assets);
    const assetManifest = await fetchManifest(assetCid);
    expect(assetManifest.type).toBe("asset");
    expect(assetManifest.scene.nodes).toHaveLength(1);
  });

  test("a second besk in the same collection adds a sibling assetID without disturbing the first", async ({
    page,
  }) => {
    await injectHardhatProvider(page);
    await page.goto("/studio.html");

    await expect(page.locator(SELECTORS.connectWalletBtn)).toBeHidden();

    // 1. Generate first asset
    await page.fill(SELECTORS.promptInput, PROMPT_1);
    await page.click(SELECTORS.generateBtn);
    await expect(page.locator(SELECTORS.chatHistoryList)).toContainText(
      "Model carved via mock",
    );
    await page.waitForURL(/[?&]manifest=Qm[\w]+/);

    // 2. Publish first asset
    await page.click(SELECTORS.publishAssetBtn);
    await expect(page.locator(SELECTORS.dialogInput)).toBeVisible();
    await page.fill(SELECTORS.dialogInput, "Chair");
    await page.click(SELECTORS.dialogConfirmBtn);

    await page.waitForURL(/[?&]asset=0x[0-9a-fA-F]+/, { timeout: 30000 });
    const firstTokenIdHex = page.url().match(/[?&]asset=(0x[0-9a-fA-F]+)/)[1];
    const firstCollection = await fetchTokenManifest(firstTokenIdHex);
    const firstAssetIds = Object.keys(firstCollection.assets);

    // 3. Start a new asset
    await page.click(SELECTORS.newAssetBtn);
    // The new-asset confirm may appear
    const dialogConfirm = page.locator(".dialog-confirm-btn");
    if (await dialogConfirm.isVisible()) {
      await dialogConfirm.click();
    }

    // 4. Generate second asset
    await page.fill(SELECTORS.promptInput, PROMPT_2);
    await page.click(SELECTORS.generateBtn);
    await expect(page.locator(SELECTORS.chatHistoryList)).toContainText(
      "Model carved via mock",
    );
    await page.waitForURL(/[?&]manifest=Qm[\w]+/);

    // 5. Publish second asset (should republish the SAME collection)
    await page.click(SELECTORS.publishAssetBtn);
    await expect(page.locator(SELECTORS.dialogInput)).toBeVisible();
    await page.fill(SELECTORS.dialogInput, "Table");
    await page.click(SELECTORS.dialogConfirmBtn);

    await page.waitForURL(/[?&]asset=0x[0-9a-fA-F]+/, { timeout: 30000 });
    const secondTokenIdHex = page.url().match(/[?&]asset=(0x[0-9a-fA-F]+)/)[1];

    // Same default collection — same tokenId — now has two assetIDs.
    expect(secondTokenIdHex).toBe(firstTokenIdHex);

    const updatedCollection = await fetchTokenManifest(secondTokenIdHex);
    expect(Object.keys(updatedCollection.assets)).toHaveLength(
      firstAssetIds.length + 1,
    );
    for (const id of firstAssetIds) {
      expect(updatedCollection.assets[id]).toBe(firstCollection.assets[id]);
    }
  });
});
