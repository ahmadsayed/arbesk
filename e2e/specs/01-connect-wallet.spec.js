import { test, expect } from "../fixtures/coverage.mjs";
import { injectHardhatProvider } from "../fixtures/hardhat-provider.mjs";
import { SELECTORS } from "../helpers/studio-selectors.mjs";
import { TEST_WALLET } from "../fixtures/test-wallet.mjs";

const TRUNCATED_ADDRESS = `${TEST_WALLET.address.slice(0, 6)}…${TEST_WALLET.address.slice(-4)}`;

test.describe("wallet connection", () => {
  test("connects the Hardhat dev wallet via Login / Signup and authenticates via SIWE", async ({ page }) => {
    await injectHardhatProvider(page);
    await page.goto("/studio.html");

    // The wallet no longer auto-connects; user must click Login / Signup.
    await expect(page.locator(SELECTORS.connectWalletBtn)).toBeVisible();
    await page.locator(SELECTORS.connectWalletBtn).click();
    await page.locator(`${SELECTORS.walletOptionsList} .wallet-option`).first().click();

    await expect(page.locator(SELECTORS.connectWalletBtn)).toBeHidden();
    await expect(page.locator(SELECTORS.disconnectWalletBtn)).toContainText(TRUNCATED_ADDRESS);
    await expect(page.locator(SELECTORS.disconnectWalletBtn)).not.toContainText("Sign In");

    const providerFlag = await page.evaluate(() => window.ethereum?.isArbeskTestProvider);
    expect(providerFlag).toBe(true);
  });
});
