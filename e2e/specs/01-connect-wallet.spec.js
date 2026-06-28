import { test, expect } from "../fixtures/coverage.mjs";
import { injectHardhatProvider } from "../fixtures/hardhat-provider.mjs";
import { SELECTORS } from "../helpers/studio-selectors.mjs";
import { TEST_WALLET } from "../fixtures/test-wallet.mjs";

const TRUNCATED_ADDRESS = `${TEST_WALLET.address.slice(0, 6)}…${TEST_WALLET.address.slice(-4)}`;

test.describe("wallet connection", () => {
  test("auto-connects the Hardhat dev wallet on page load and authenticates via SIWE", async ({ page }) => {
    await injectHardhatProvider(page);
    await page.goto("/studio.html");

    // With an injected EIP-1193 provider the Studio now connects automatically
    // on page load, so the Login / Signup button should hide without a click.
    await expect(page.locator(SELECTORS.connectWalletBtn)).toBeHidden();

    // Wait for SIWE authentication to finish (the wallet menu stops showing
    // "Sign In" once the session is established).
    await expect(page.locator(SELECTORS.disconnectWalletBtn)).not.toContainText("Sign In");
    await expect(page.locator(SELECTORS.disconnectWalletBtn)).toContainText(TRUNCATED_ADDRESS);

    const providerFlag = await page.evaluate(() => window.ethereum?.isArbeskTestProvider);
    expect(providerFlag).toBe(true);
  });
});
