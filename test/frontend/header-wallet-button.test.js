/**
 * Header wallet button contract tests.
 *
 * Mirrors the .headerbar-actions fragment in app.pug. The exported updater
 * functions keep their signatures (app-init.js calls them); the Alpine
 * migration adds reactive sync from walletState + auth bus events.
 *
 * @jest-environment jsdom
 */

import { jest, expect, test, afterEach } from "@jest/globals";

const ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";
const TRUNCATED = "0x1234…5678";

// Mirrors app.pug .headerbar-actions (directives included; ids/classes identical).
const FRAGMENT = `
  <div class="headerbar-actions" x-data="headerWallet">
    <select id="headerbarNetworkSelect" class="headerbar-network-select" :class="{ connected: connected && !isCdp, hidden: isCdp }" aria-label="Select network" title="Select network">
      <option value="baseSepolia" selected>Base Sepolia Testnet</option>
      <option value="hardhat">Hardhat Local</option>
    </select>
    <button id="connectWalletBtn" class="headerbar-wallet disconnected" :class="{ hidden: connected, disconnected: !connected }" aria-label="Login or sign up"><span>Login / Signup</span></button>
    <button id="disconnectWalletBtn" class="headerbar-wallet hidden" :class="{ hidden: !connected, 'auth-required': showAuthRequired }" aria-label="Wallet menu"><span id="disconnectWalletBtnText" x-text="label">Disconnect</span></button>
  </div>`;

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

jest.unstable_mockModule("../../frontend/src/js/services/api.js", () => ({
  getCachedSession: jest.fn(() => null),
}));

/** @type {typeof import("../../frontend/src/js/ui/header-wallet-button.js")} */
let mod;
/** @type {typeof import("../../frontend/src/js/state/wallet-state.js")} */
let walletStateMod;
/** @type {typeof import("@arbesk/asset-core/events/bus.js")} */
let bus;

/**
 * @param {Record<string, any>} [preState] - walletState patch applied BEFORE
 *   the module loads (simulates the auto-connect-on-page-load race)
 */
async function setup(preState) {
  jest.resetModules();
  document.body.innerHTML = FRAGMENT;
  walletStateMod = await import("../../frontend/src/js/state/wallet-state.js");
  bus = await import("@arbesk/asset-core/events/bus.js");
  if (preState) walletStateMod.walletState.set(preState);
  mod = await import("../../frontend/src/js/ui/header-wallet-button.js");
  await flush();
}

const connectBtn = () => /** @type {HTMLElement} */ (document.getElementById("connectWalletBtn"));
const disconnectBtn = () => /** @type {HTMLElement} */ (document.getElementById("disconnectWalletBtn"));
const textEl = () => /** @type {HTMLElement} */ (document.getElementById("disconnectWalletBtnText"));
const netSel = () => /** @type {HTMLElement} */ (document.getElementById("headerbarNetworkSelect"));

afterEach(async () => {
  const { Alpine } = await import("../../frontend/src/js/ui/alpine.js");
  Alpine.destroyTree(document.body);
  Alpine.stopObservingMutations();
  document.body.innerHTML = "";
});

test("disconnected: connect button visible, wallet button hidden, label Disconnect", async () => {
  await setup();
  expect(connectBtn().classList.contains("hidden")).toBe(false);
  expect(connectBtn().classList.contains("disconnected")).toBe(true);
  expect(disconnectBtn().classList.contains("hidden")).toBe(true);
  expect(disconnectBtn().classList.contains("auth-required")).toBe(false);
  expect(textEl().textContent).toBe("Disconnect");
  expect(netSel().classList.contains("hidden")).toBe(false);
  expect(netSel().classList.contains("connected")).toBe(false);
});

test("unauthenticated crypto wallet: truncated address with Sign In reminder", async () => {
  await setup();
  mod.updateHeaderWalletButton(ADDRESS, false, "injected");
  await flush();
  expect(connectBtn().classList.contains("hidden")).toBe(true);
  expect(disconnectBtn().classList.contains("hidden")).toBe(false);
  expect(textEl().textContent).toBe(`${TRUNCATED} • Sign In`);
  expect(disconnectBtn().classList.contains("auth-required")).toBe(true);
  expect(netSel().classList.contains("connected")).toBe(true);
  expect(netSel().classList.contains("hidden")).toBe(false);
});

test("authenticated crypto wallet: truncated address without reminder", async () => {
  await setup();
  mod.updateHeaderWalletButton(ADDRESS, true, "injected");
  await flush();
  expect(textEl().textContent).toBe(TRUNCATED);
  expect(disconnectBtn().classList.contains("auth-required")).toBe(false);
});

test("CDP wallet: shows email, no reminder, network select hidden", async () => {
  await setup();
  mod.updateHeaderWalletButton(ADDRESS, true, "cdp", "user@example.com");
  await flush();
  expect(textEl().textContent).toBe("user@example.com");
  expect(disconnectBtn().classList.contains("auth-required")).toBe(false);
  expect(netSel().classList.contains("hidden")).toBe(true);
});

test("CDP wallet: long emails truncate to 21 chars + ellipsis; missing email shows Account", async () => {
  await setup();
  mod.updateHeaderWalletButton(ADDRESS, true, "cdp", "a-very-long-email-address@example.com");
  await flush();
  expect(textEl().textContent).toBe("a-very-long-email-add…");

  mod.updateHeaderWalletButton(ADDRESS, true, "cdp", null);
  await flush();
  expect(textEl().textContent).toBe("Account");
});

test("reset: null address restores the disconnected state", async () => {
  await setup();
  mod.updateHeaderWalletButton(ADDRESS, true, "injected");
  await flush();
  mod.updateHeaderWalletButton(null, false, null, null);
  await flush();
  expect(connectBtn().classList.contains("hidden")).toBe(false);
  expect(disconnectBtn().classList.contains("hidden")).toBe(true);
  expect(textEl().textContent).toBe("Disconnect");
});

test("follows walletState changes without explicit updater calls", async () => {
  await setup();
  walletStateMod.walletState.set({ walletAddress: ADDRESS, walletSource: "injected" });
  await flush();
  expect(textEl().textContent).toContain(TRUNCATED);
  expect(disconnectBtn().classList.contains("hidden")).toBe(false);
});

test("follows USER_AUTH_REQUIRED / USER_AUTHENTICATED bus events", async () => {
  await setup();
  walletStateMod.walletState.set({ walletAddress: ADDRESS, walletSource: "injected" });
  await flush();
  bus.emit(bus.EVENTS.USER_AUTHENTICATED, { address: ADDRESS });
  await flush();
  expect(textEl().textContent).toBe(TRUNCATED);

  bus.emit(bus.EVENTS.USER_AUTH_REQUIRED, { address: ADDRESS });
  await flush();
  expect(textEl().textContent).toBe(`${TRUNCATED} • Sign In`);
});

test("regression: seeds from walletState set BEFORE the component initializes (auto-connect race)", async () => {
  // Browser auto-connect on page load can set walletState + emit
  // WALLET_CONNECTED before Alpine.start() at DOMContentLoaded; a
  // subscription-only init() would never see those events (E2E 20 caught this).
  await setup({ walletAddress: ADDRESS, walletSource: "injected" });
  expect(connectBtn().classList.contains("hidden")).toBe(true);
  expect(textEl().textContent).toContain(TRUNCATED);
});
