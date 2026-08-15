/**
 * Wallet popover contract tests.
 *
 * Runs the real ui/wallet-popover.js against the DOM fragment rendered by
 * app.pug (same ids/classes/directives). blockchain/wallet.js and
 * services/api.js are mocked — their real modules pull in CDN globals.
 *
 * @jest-environment jsdom
 */

import { jest, expect, test, beforeEach, afterEach } from "@jest/globals";

const ADDRESS_A = "0x1111111111111111111111111111111111111111";
const ADDRESS_B = "0x2222222222222222222222222222222222222222";
const BASE_SEPOLIA = 84532;
const HARDHAT_LOCAL = 31415822;

// Mirrors the #walletPopover fragment in frontend/src/pug/app.pug plus the
// header wallet toggle button it attaches to.
const FRAGMENT = `
  <button id="disconnectWalletBtn">Wallet</button>
  <div id="walletPopover" class="wallet-popover hidden" x-data="walletPopover" :class="{ hidden: !isOpen }" aria-label="Wallet menu">
    <div class="wallet-popover-header">
      <span id="walletPopoverAddress" class="wallet-popover-address" x-text="displayAddress" :title="address">—</span>
      <button id="walletPopoverCopy" class="wallet-popover-copy" type="button" @click="copy()" x-text="copied ? 'Copied!' : 'Copy'" :class="{ copied }">Copy</button>
    </div>
    <a id="walletPopoverExplorer" class="wallet-popover-explorer hidden" href="#" target="_blank" rel="noopener noreferrer" :href="explorerUrl || '#'" :class="{ hidden: !explorerUrl }">View on Explorer</a>
    <div class="wallet-popover-actions">
      <button id="walletPopoverSignIn" class="wallet-popover-signin btn btn-primary btn-sm hidden" type="button" @click="signIn()" :class="{ hidden: !showSignIn }">Sign In</button>
      <button id="walletPopoverDisconnect" class="wallet-popover-disconnect btn btn-danger btn-sm" type="button" @click="disconnect()">Log Out</button>
    </div>
  </div>`;

/** Flush Alpine's microtask-based reactivity. */
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const mockDisconnectWallet = jest.fn();
const mockGetCachedSession = jest.fn(() => null);

jest.unstable_mockModule("../../frontend/src/js/blockchain/wallet.js", () => ({
  disconnectWallet: mockDisconnectWallet,
  switchNetwork: jest.fn(),
}));
jest.unstable_mockModule("../../frontend/src/js/services/api.js", () => ({
  getCachedSession: mockGetCachedSession,
  getOrCreateSession: jest.fn(),
}));

/** @type {typeof import("../../frontend/src/js/state/wallet-state.js")} */
let walletStateMod;
/** @type {typeof import("../../frontend/src/js/ui/wallet-popover.js")} */
let popoverMod;

async function setup(statePatch = {}) {
  jest.resetModules();
  document.body.innerHTML = FRAGMENT;
  Object.defineProperty(window.navigator, "clipboard", {
    value: { writeText: jest.fn(() => Promise.resolve()) },
    configurable: true,
  });
  walletStateMod = await import("../../frontend/src/js/state/wallet-state.js");
  if (Object.keys(statePatch).length) walletStateMod.walletState.set(statePatch);
  popoverMod = await import("../../frontend/src/js/ui/wallet-popover.js");
  popoverMod.initWalletPopover();
  await flush();
}

const addressEl = () => /** @type {HTMLElement} */ (document.getElementById("walletPopoverAddress"));
const popoverEl = () => /** @type {HTMLElement} */ (document.getElementById("walletPopover"));
const explorerEl = () => /** @type {HTMLAnchorElement} */ (document.getElementById("walletPopoverExplorer"));
const signInEl = () => /** @type {HTMLElement} */ (document.getElementById("walletPopoverSignIn"));
const copyEl = () => /** @type {HTMLElement} */ (document.getElementById("walletPopoverCopy"));

beforeEach(() => {
  mockDisconnectWallet.mockClear();
  mockGetCachedSession.mockReset();
  mockGetCachedSession.mockReturnValue(null);
});

afterEach(async () => {
  // Each setup() gets a fresh Alpine instance via jest.resetModules(); tear
  // down the one that just ran so its MutationObserver can't initialize the
  // next test's DOM before its own instance starts.
  const { Alpine } = await import("../../frontend/src/js/ui/alpine.js");
  Alpine.destroyTree(document.body);
  Alpine.stopObservingMutations();
  document.body.innerHTML = "";
});

test("shows the truncated connected address once initialized", async () => {
  await setup({ walletAddress: ADDRESS_A, chainId: BASE_SEPOLIA });
  expect(addressEl().textContent).toBe("0x1111…1111");
  expect(addressEl().title).toBe(ADDRESS_A);
});

test("live-updates the displayed address when wallet state changes", async () => {
  await setup({ walletAddress: ADDRESS_A, chainId: BASE_SEPOLIA });
  walletStateMod.walletState.set({ walletAddress: ADDRESS_B });
  await flush();
  expect(addressEl().textContent).toBe("0x2222…2222");
});

test("opens when the header wallet button is clicked and closes on Escape", async () => {
  await setup({ walletAddress: ADDRESS_A, chainId: BASE_SEPOLIA });
  expect(popoverEl().classList.contains("hidden")).toBe(true);

  /** @type {HTMLElement} */ (document.getElementById("disconnectWalletBtn")).click();
  await flush();
  expect(popoverEl().classList.contains("hidden")).toBe(false);

  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  await flush();
  expect(popoverEl().classList.contains("hidden")).toBe(true);
});

test("explorer link points at the chain explorer and hides when there is none", async () => {
  await setup({ walletAddress: ADDRESS_A, chainId: BASE_SEPOLIA });
  await flush();
  expect(explorerEl().href).toBe(`https://sepolia.basescan.org/address/${ADDRESS_A}`);
  expect(explorerEl().classList.contains("hidden")).toBe(false);

  walletStateMod.walletState.set({ chainId: HARDHAT_LOCAL });
  await flush();
  expect(explorerEl().classList.contains("hidden")).toBe(true);
});

test("copy button writes the full address and shows confirmation", async () => {
  await setup({ walletAddress: ADDRESS_A, chainId: BASE_SEPOLIA });
  copyEl().click();
  await flush();
  expect(/** @type {any} */ (window.navigator.clipboard).writeText).toHaveBeenCalledWith(ADDRESS_A);
  expect(copyEl().textContent).toBe("Copied!");
  expect(copyEl().classList.contains("copied")).toBe(true);
});

test("log out disconnects the wallet and closes the popover", async () => {
  await setup({ walletAddress: ADDRESS_A, chainId: BASE_SEPOLIA });
  /** @type {HTMLElement} */ (document.getElementById("disconnectWalletBtn")).click();
  await flush();
  /** @type {HTMLElement} */ (document.getElementById("walletPopoverDisconnect")).click();
  await flush();
  expect(mockDisconnectWallet).toHaveBeenCalledTimes(1);
  expect(popoverEl().classList.contains("hidden")).toBe(true);
});

test("sign-in button shows only when connected without a matching session", async () => {
  await setup({ walletAddress: ADDRESS_A, chainId: BASE_SEPOLIA });
  await flush();
  expect(signInEl().classList.contains("hidden")).toBe(false);

  mockGetCachedSession.mockReturnValue({ address: ADDRESS_A.toLowerCase() });
  walletStateMod.walletState.set({ walletAddress: ADDRESS_A }); // re-emit
  await flush();
  expect(signInEl().classList.contains("hidden")).toBe(true);
});
