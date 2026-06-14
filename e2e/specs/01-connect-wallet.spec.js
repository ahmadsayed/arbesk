import { test, expect } from "@playwright/test";
import { injectHardhatProvider } from "../fixtures/hardhat-provider.mjs";
import { SELECTORS } from "../helpers/studio-selectors.mjs";
import { TEST_WALLET } from "../fixtures/test-wallet.mjs";

const TRUNCATED_ADDRESS = `${TEST_WALLET.address.slice(0, 6)}…${TEST_WALLET.address.slice(-4)}`;

test.describe("wallet connection", () => {
  test("auto-connects the Hardhat dev wallet and authenticates via SIWE", async ({ page }) => {
    await injectHardhatProvider(page);
    await page.goto("/studio.html");

    await expect(page.locator(SELECTORS.connectWalletBtn)).toBeHidden();
    await expect(page.locator(SELECTORS.disconnectWalletBtn)).toContainText(TRUNCATED_ADDRESS);
    await expect(page.locator(SELECTORS.disconnectWalletBtn)).not.toContainText("Sign In");

    const providerFlag = await page.evaluate(() => window.ethereum?.isArbeskTestProvider);
    expect(providerFlag).toBe(true);
  });
});
