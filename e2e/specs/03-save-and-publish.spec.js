import { test, expect } from "@playwright/test";
import { injectHardhatProvider } from "../fixtures/hardhat-provider.mjs";
import { SELECTORS } from "../helpers/studio-selectors.mjs";
import {
  fetchManifest,
  assertGenerationManifest,
  assertSavedManifest,
  assertPublishedManifest,
} from "../helpers/manifest.mjs";

const PROMPT = "cowboy";
const ASSET_NAME = "Cowboy Test";

test.describe("save and publish", () => {
  test("saves a draft and publishes an ERC-721 token", async ({ page }) => {
    await injectHardhatProvider(page);
    await page.goto("/studio.html");

    await expect(page.locator(SELECTORS.connectWalletBtn)).toBeHidden();
    await expect(page.locator(SELECTORS.disconnectWalletBtn)).not.toContainText("Sign In");

    // 1. Generate
    await page.fill(SELECTORS.promptInput, PROMPT);
    await page.click(SELECTORS.generateBtn);
    await expect(page.locator(SELECTORS.chatHistoryList)).toContainText("Model carved via mock");

    const urlAfterGen = page.url();
    const genMatch = urlAfterGen.match(/[?&]manifest=(Qm[\w]+)/);
    expect(genMatch).toBeTruthy();
    const genCid = genMatch[1];

    const genManifest = await fetchManifest(genCid);
    assertGenerationManifest(genManifest, { prompt: PROMPT, provider: "mock" });

    // 2. Save draft (no rename dialog — draft keeps current name)
    await page.click(SELECTORS.saveAssetBtn);
    await expect(page.locator(SELECTORS.srStatus)).toContainText("saved", { timeout: 10000 });

    const urlAfterSave = page.url();
    const saveMatch = urlAfterSave.match(/[?&]manifest=(Qm[\w]+)/);
    expect(saveMatch).toBeTruthy();
    const saveCid = saveMatch[1];
    expect(saveCid).not.toBe(genCid);

    const savedManifest = await fetchManifest(saveCid);
    assertSavedManifest(savedManifest, genCid);

    // 3. Publish — first-time publish prompts for an explicit name.
    await page.click(SELECTORS.publishAssetBtn);
    await expect(page.locator(SELECTORS.dialogInput)).toBeVisible({ timeout: 10000 });
    await page.fill(SELECTORS.dialogInput, ASSET_NAME);
    await page.click(SELECTORS.dialogConfirmBtn);

    await expect(page.locator(SELECTORS.srStatus)).toContainText("published", { timeout: 30000 });

    const urlAfterPublish = page.url();
    const tokenMatch = urlAfterPublish.match(/[?&]asset=(0x[0-9a-fA-F]+)/);
    expect(tokenMatch).toBeTruthy();
    const tokenId = tokenMatch[1];

    const tokenManifestRes = await fetch(
      `http://127.0.0.1:9090/api/v1/tokens/${tokenId}/manifest`
    );
    expect(tokenManifestRes.ok).toBe(true);
    const tokenManifestPayload = await tokenManifestRes.json();
    const publishedManifest = tokenManifestPayload.manifest;
    expect(publishedManifest).toBeTruthy();

    assertPublishedManifest(publishedManifest);
    expect(publishedManifest.name).toBe(ASSET_NAME);
  });
});
