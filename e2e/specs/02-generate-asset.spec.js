import { test, expect } from "@playwright/test";
import { injectHardhatProvider } from "../fixtures/hardhat-provider.mjs";
import { SELECTORS } from "../helpers/studio-selectors.mjs";
import { fetchManifest, assertGenerationManifest } from "../helpers/manifest.mjs";

const PROMPT = "cowboy";

test.describe("asset generation", () => {
  test("generates a mock asset and produces a valid manifest", async ({ page }) => {
    await injectHardhatProvider(page);
    await page.goto("/studio.html");

    await expect(page.locator(SELECTORS.connectWalletBtn)).toBeHidden({ timeout: 10000 });
    await expect(page.locator(SELECTORS.disconnectWalletBtn)).not.toContainText("Sign In");

    await page.fill(SELECTORS.promptInput, PROMPT);
    await page.click(SELECTORS.generateBtn);

    await expect(page.locator(SELECTORS.chatHistoryList)).toContainText(PROMPT);
    await expect(page.locator(SELECTORS.chatHistoryList)).toContainText("Model carved via mock");

    const url = page.url();
    const match = url.match(/[?&]manifest=(Qm[\w]+)/);
    expect(match).toBeTruthy();
    const cid = match[1];

    const manifest = await fetchManifest(cid);
    assertGenerationManifest(manifest, { prompt: PROMPT, provider: "mock" });
  });
});
