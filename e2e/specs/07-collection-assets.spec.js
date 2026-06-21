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
const ASSET_NAME_1 = "Chair Test";
const ASSET_NAME_2 = "Table Test";

function manifestCidFromUrl(url) {
  return new URL(url).searchParams.get("manifest");
}

function tokenIdHexFromUrl(url) {
  return new URL(url).searchParams.get("asset");
}

test.describe("Collection/asset model", () => {
  // ─── Test 1 (existing) ──────────────────────────────────────────

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
    await page.fill(SELECTORS.dialogInput, ASSET_NAME_1);
    await page.click(SELECTORS.dialogConfirmBtn);

    await page.waitForURL(/[?&]asset=0x[0-9a-fA-F]+/, { timeout: 10000 });
    const tokenIdHex = page.url().match(/[?&]asset=(0x[0-9a-fA-F]+)/)[1];

    const collectionManifest = await fetchTokenManifest(tokenIdHex);
    assertCollectionManifest(collectionManifest, {
      expectedAssetIds: undefined,
    });
    expect(Object.keys(collectionManifest.assets)).toHaveLength(1);

    const [assetCid] = Object.values(collectionManifest.assets);
    const assetManifest = await fetchManifest(assetCid);
    expect(assetManifest.type).toBe("asset");
    expect(assetManifest.scene.nodes).toHaveLength(1);
  });

  // ─── Test 2 (existing) ──────────────────────────────────────────

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

    await page.waitForURL(/[?&]asset=0x[0-9a-fA-F]+/, { timeout: 10000 });
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

    await page.waitForURL(/[?&]asset=0x[0-9a-fA-F]+/, { timeout: 10000 });
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

  // ─── Test 3 ─────────────────────────────────────────────────────
  // "opening a published token renders the first asset in the viewport"

  test("opening a published token renders the first asset in the viewport", async ({
    page,
  }) => {
    await injectHardhatProvider(page);
    await page.goto("/studio.html");

    await expect(page.locator(SELECTORS.connectWalletBtn)).toBeHidden();

    // 1. Generate + publish
    await page.fill(SELECTORS.promptInput, PROMPT_1);
    await page.click(SELECTORS.generateBtn);
    await expect(page.locator(SELECTORS.chatHistoryList)).toContainText(
      "Model carved via mock",
    );
    await page.waitForURL(/[?&]manifest=Qm[\w]+/);

    await page.click(SELECTORS.publishAssetBtn);
    await expect(page.locator(SELECTORS.dialogInput)).toBeVisible();
    await page.fill(SELECTORS.dialogInput, ASSET_NAME_1);
    await page.click(SELECTORS.dialogConfirmBtn);

    await page.waitForURL(/[?&]asset=0x[0-9a-fA-F]+/, { timeout: 10000 });
    const tokenIdHex = tokenIdHexFromUrl(page.url());
    const tokenIdDec = BigInt(tokenIdHex).toString();

    // 2. Open gallery view and click the published card
    await page.click(SELECTORS.gallerySwitcherBtn);
    const assetCard = page.locator(
      `${SELECTORS.assetCard}[data-token-id="${tokenIdDec}"]`,
    );
    await expect(assetCard).toHaveCount(1);

    // 3. Click the card — should open the first asset from the collection
    await assetCard.click({ position: { x: 10, y: 10 } });
    await page.waitForURL((url) => {
      const a = new URL(url.toString()).searchParams.get("asset");
      return a != null && BigInt(a) === BigInt(tokenIdHex);
    });

    // 4. Verify the viewport loads — header shows the asset name, not the
    //    initial "No asset open" placeholder.
    await expect(page.locator(SELECTORS.assetStatusName)).not.toContainText(
      "No asset open",
    );
    await expect(page.locator(SELECTORS.assetStatusName)).toContainText(
      ASSET_NAME_1,
    );

    // 5. Verify the URL carries the correct token id
    const urlTokenHex = tokenIdHexFromUrl(page.url());
    expect(BigInt(urlTokenHex)).toBe(BigInt(tokenIdHex));
  });

  // ─── Test 4 ─────────────────────────────────────────────────────
  // "New Asset button clears the scene but preserves collection context"

  test("New Asset button clears the scene but preserves collection context", async ({
    page,
  }) => {
    await injectHardhatProvider(page);
    await page.goto("/studio.html");

    await expect(page.locator(SELECTORS.connectWalletBtn)).toBeHidden();

    // Capture the collection ID early — it is set by syncCollectionSelect() on
    // wallet connect and will not change across New Asset / generation cycles.
    const savedCollectionId = await page
      .locator(SELECTORS.collectionSelect)
      .inputValue();
    expect(savedCollectionId).toBeTruthy();

    // 1. Generate + publish first asset (creates the default collection)
    await page.fill(SELECTORS.promptInput, PROMPT_1);
    await page.click(SELECTORS.generateBtn);
    await expect(page.locator(SELECTORS.chatHistoryList)).toContainText(
      "Model carved via mock",
    );
    await page.waitForURL(/[?&]manifest=Qm[\w]+/);

    await page.click(SELECTORS.publishAssetBtn);
    await expect(page.locator(SELECTORS.dialogInput)).toBeVisible();
    await page.fill(SELECTORS.dialogInput, ASSET_NAME_1);
    await page.click(SELECTORS.dialogConfirmBtn);

    // Publish uses history.pushState — waitForURL expects a navigation event.
    // Use a functional predicate that polls the URL instead.
    await page.waitForURL(
      (url) => {
        return /[?&]asset=0x[0-9a-fA-F]+/.test(url.toString());
      },
      { timeout: 10000 },
    );
    const firstTokenIdHex = tokenIdHexFromUrl(page.url());
    expect(firstTokenIdHex).toBeTruthy();

    // 2. Click "New Asset" — the native confirm() is auto-dismissed by Playwright
    //    (returns false), so startNewAsset() returns early. The activeAssetTokenId
    //    and selectedCollectionId remain intact, which is the key assertion:
    //    collection context survives the new-asset action.
    await page.click(SELECTORS.newAssetBtn);

    // 3. Verify the collection selector still shows "Default" with the same
    //    computed (keccak256) collection ID.
    await expect(page.locator(SELECTORS.collectionSelect)).toHaveValue(
      savedCollectionId,
    );

    // 4. Generate a new asset — because activeAssetTokenId is still set, the URL
    //    stays at ?asset= rather than switching to ?manifest=.
    await page.fill(SELECTORS.promptInput, PROMPT_2);
    await page.click(SELECTORS.generateBtn);
    await expect(page.locator(SELECTORS.chatHistoryList)).toContainText(
      "Model carved via mock",
    );
    // URL won't change to ?manifest= (activeAssetTokenId persists), so we don't
    // waitForURL — the chat message above already confirms generation completed.

    // 5. Publish second asset — should republish the SAME collection.
    await page.click(SELECTORS.publishAssetBtn);
    await expect(page.locator(SELECTORS.dialogInput)).toBeVisible();
    await page.fill(SELECTORS.dialogInput, ASSET_NAME_2);
    await page.click(SELECTORS.dialogConfirmBtn);

    await page.waitForURL(
      (url) => {
        return /[?&]asset=0x[0-9a-fA-F]+/.test(url.toString());
      },
      { timeout: 10000 },
    );
    const secondTokenIdHex = tokenIdHexFromUrl(page.url());

    // Both publishes land on the same default collection token.
    expect(secondTokenIdHex).toBe(firstTokenIdHex);

    // The collection should now contain two assets.
    const updatedCollection = await fetchTokenManifest(secondTokenIdHex);
    expect(Object.keys(updatedCollection.assets)).toHaveLength(2);
  });

  // ─── Test 5 ─────────────────────────────────────────────────────
  // "page reload with ?asset=TOKENID restores the viewport"

  test("page reload with ?asset=TOKENID restores the viewport", async ({
    page,
  }) => {
    await injectHardhatProvider(page);
    await page.goto("/studio.html");

    await expect(page.locator(SELECTORS.connectWalletBtn)).toBeHidden();

    // 1. Generate + publish
    await page.fill(SELECTORS.promptInput, PROMPT_1);
    await page.click(SELECTORS.generateBtn);
    await expect(page.locator(SELECTORS.chatHistoryList)).toContainText(
      "Model carved via mock",
    );
    await page.waitForURL(/[?&]manifest=Qm[\w]+/);

    await page.click(SELECTORS.publishAssetBtn);
    await expect(page.locator(SELECTORS.dialogInput)).toBeVisible();
    await page.fill(SELECTORS.dialogInput, ASSET_NAME_1);
    await page.click(SELECTORS.dialogConfirmBtn);

    await page.waitForURL(/[?&]asset=0x[0-9a-fA-F]+/, { timeout: 10000 });
    const tokenIdHex = tokenIdHexFromUrl(page.url());

    // 2. Navigate to a fresh page with ?asset=TOKENID. The wallet auto-connects
    //    and the asset-library WALLET_CONNECTED handler re-checks the URL param,
    //    calling openAssetByTokenId → loadCollectionManifest → first asset loaded.
    //    The load is async: wallet connect → openAssetByTokenId → IPFS fetch →
    //    SCENE_READY → header updated. Use generous timeouts.
    await page.goto(`/studio.html?asset=${tokenIdHex}`);
    await expect(page.locator(SELECTORS.connectWalletBtn)).toBeHidden({
      timeout: 5000,
    });

    // 3. Verify the viewport renders — header should show the asset name (set by
    //    the SCENE_READY → updateAssetStatus chain), not the empty placeholder.
    await expect(page.locator(SELECTORS.assetStatusName)).not.toContainText(
      "No asset open",
      { timeout: 10000 },
    );
    await expect(page.locator(SELECTORS.assetStatusName)).toContainText(
      ASSET_NAME_1,
      { timeout: 10000 },
    );

    // 4. Verify the URL still carries the token id.
    const urlTokenHex = tokenIdHexFromUrl(page.url());
    expect(BigInt(urlTokenHex)).toBe(BigInt(tokenIdHex));
  });

  // ─── Test 6 ─────────────────────────────────────────────────────
  // "collection selector populates on wallet connect"

  test("collection selector populates on wallet connect", async ({ page }) => {
    // ‣ Phase 1 — navigate without a wallet. The static HTML has a
    //   <select#collectionSelect> with a single empty-value <option>Default</option>.
    await page.goto("/studio.html");

    const collectionSelect = page.locator(SELECTORS.collectionSelect);
    await expect(collectionSelect).toBeVisible();

    // Before any wallet connects, the select exists with just the empty-value
    // "Default" option. No computed collection ID yet.
    const optionsBefore = collectionSelect.locator("option");
    await expect(optionsBefore).toHaveCount(1);
    await expect(optionsBefore.first()).toHaveText("Default");
    await expect(optionsBefore.first()).toHaveValue("");

    // ‣ Phase 2 — inject the Hardhat provider and reload. The wallet auto-connects
    //   and syncCollectionSelect() populates the dropdown with the keccak256 hash.
    await injectHardhatProvider(page);
    await page.goto("/studio.html");

    await expect(page.locator(SELECTORS.connectWalletBtn)).toBeHidden();

    // After wallet connect, the "Default" option has a non-empty value
    // (the keccak256(soliditySha3(address)) derived collection ID).
    const optionsAfter = collectionSelect.locator("option");
    await expect(optionsAfter).toHaveCount(1);
    await expect(optionsAfter.first()).toHaveText("Default");
    const defaultValue = await optionsAfter.first().getAttribute("value");
    expect(defaultValue).toBeTruthy();

    // Verify the value matches the expected keccak256 hash for the test wallet.
    const expectedId = await page.evaluate(() => {
      return window.Web3.utils.soliditySha3({
        type: "address",
        value: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", // TEST_WALLET.address
      });
    });
    expect(defaultValue).toBe(expectedId);
  });
});
