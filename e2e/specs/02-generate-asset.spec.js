import { test, expect } from "@playwright/test";
import { injectHardhatProvider } from "../fixtures/hardhat-provider.mjs";
import { SELECTORS } from "../helpers/studio-selectors.mjs";
import { fetchManifest, assertGenerationManifest } from "../helpers/manifest.mjs";

const PROMPT = "cowboy";

test.describe("asset generation", () => {
  test("generates a mock asset and produces a valid manifest", async ({ page }) => {
    await injectHardhatProvider(page);
    await page.goto("/studio.html");

    await expect(page.locator(SELECTORS.connectWalletBtn)).toBeHidden();
    await expect(page.locator(SELECTORS.disconnectWalletBtn)).not.toContainText("Sign In");

    await page.fill(SELECTORS.promptInput, PROMPT);
    await page.click(SELECTORS.generateBtn);

    await expect(page.locator(SELECTORS.chatHistoryList)).toContainText(PROMPT);
    await expect(page.locator(SELECTORS.chatHistoryList)).toContainText("Model carved via mock");

    // Wait for the URL to actually carry the manifest CID rather than reading
    // page.url() synchronously — the param is pushed via history.pushState on a
    // separate tick from the chat message and may not be present yet.
    await page.waitForURL(/[?&]manifest=Qm[\w]+/);
    const cid = page.url().match(/[?&]manifest=(Qm[\w]+)/)[1];

    const manifest = await fetchManifest(cid);
    assertGenerationManifest(manifest, { prompt: PROMPT, provider: "mock" });
  });
});
