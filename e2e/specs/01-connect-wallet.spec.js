import { test, expect } from "../fixtures/coverage.mjs";
import { connectStudio } from "../helpers/flows.mjs";
import { SELECTORS } from "../helpers/studio-selectors.mjs";
import { TEST_WALLET } from "../fixtures/test-wallet.mjs";

const TRUNCATED_ADDRESS = `${TEST_WALLET.address.slice(0, 6)}…${TEST_WALLET.address.slice(-4)}`;

test.describe("wallet connection", () => {
  test("connects the Hardhat dev wallet and authenticates via SIWE", async ({ page }) => {
    // The Studio no longer auto-connects EOA wallets on page load; use the
    // standard connect flow (auto-connect fallback + Login / Signup if needed).
    await connectStudio(page);

    // Wait for SIWE authentication to finish (the wallet menu stops showing
    // "Sign In" once the session is established).
    await expect(page.locator(SELECTORS.disconnectWalletBtn)).not.toContainText("Sign In");
    await expect(page.locator(SELECTORS.disconnectWalletBtn)).toContainText(TRUNCATED_ADDRESS);

    const providerFlag = await page.evaluate(() => window.ethereum?.isArbeskTestProvider);
    expect(providerFlag).toBe(true);
  });
});
