/**
 * Characterization tests for autoConnectWallet() branch selection.
 *
 * These pin the CURRENT behavior of the wallet auto-restore decision tree
 * before any structural refactor: which provider is restored (CDP /
 * WalletConnect / injected-by-rdns / any-injected fallback) and how errors and
 * fallthrough are handled. They assert on observable side effects only:
 * setWeb3Provider, walletState.set (the first thing _finishWalletSetup does),
 * localStorage, and the warn/error log seam.
 *
 * @jest-environment jsdom
 */
import { jest } from "@jest/globals";

const LAST_WALLET_KEY = "arbesk-last-wallet";
const SMART_ADDR = "0xSmartAccount";
const EOA_ADDR = "0xEoaAccount";
const EMAIL = "user@example.com";
const WC_ADDR = "0xWalletConnect";
const RDNS_ADDR = "0xInjectedRdns";
const FALLBACK_ADDR = "0xAnyInjected";

// Test-controllable behavior for the mocked seams.
const cdp = {
  warmup: true,
  result: { smartAccountAddress: SMART_ADDR, eoaAddress: EOA_ADDR, email: EMAIL },
  warmupError: null,
};
const wc = { provider: null, accounts: [] };
const discovery = { rdnsWallet: null, accountsError: null };
const providerRpc = { chainId: "0x14a34" }; // Base Sepolia — supported chain

const emit = jest.fn();
const walletState = { get: jest.fn(() => ({ walletAddress: null })), set: jest.fn() };
const setWeb3Provider = jest.fn();
const warn = jest.fn();
const error = jest.fn();
const log = jest.fn();

async function loadWalletCore() {
  await jest.unstable_mockModule("@arbesk/asset-core/events/bus.js", () => ({
    emit,
    EVENTS: {
      WALLET_CONNECTED: "WALLET_CONNECTED",
      USER_AUTHENTICATED: "USER_AUTHENTICATED",
      USER_AUTH_REQUIRED: "USER_AUTH_REQUIRED",
    },
  }));
  await jest.unstable_mockModule("../../frontend/src/js/state/wallet-state.ts", () => ({ walletState }));
  await jest.unstable_mockModule("../../frontend/src/js/services/backend-client.ts", () => ({
    getContractAddress: jest.fn().mockResolvedValue("0xContract"),
    getContractArtifact: jest.fn().mockResolvedValue([]),
    getOrCreateSession: jest.fn().mockResolvedValue("session-token"),
  }));
  await jest.unstable_mockModule("../../frontend/src/js/ui/toasts.ts", () => ({
    showToast: jest.fn(),
    dismissToast: jest.fn(),
  }));
  await jest.unstable_mockModule("../../frontend/src/js/utils/log.ts", () => ({ log, warn, error }));
  await jest.unstable_mockModule("../../frontend/src/js/blockchain/wallet-discovery.ts", () => ({
    startDiscovery: jest.fn(),
    requestWallets: jest.fn(),
    getWalletByRdns: jest.fn(() => discovery.rdnsWallet),
  }));
  await jest.unstable_mockModule("../../frontend/src/js/blockchain/wallet-connect.ts", () => ({
    getWalletConnectProvider: jest.fn(async () => wc.provider),
    disconnectWalletConnect: jest.fn(),
    onWalletConnectEvent: jest.fn(),
    offWalletConnectEvent: jest.fn(),
  }));
  await jest.unstable_mockModule("../../frontend/src/js/ui/wallet-modal.ts", () => ({
    showWalletModal: jest.fn(),
  }));
  await jest.unstable_mockModule("../../frontend/src/js/blockchain/network-config.ts", () => ({
    getContractAddress: jest.fn(() => "0xContract"),
    getNetworkConfig: jest.fn(() => ({ name: "baseSepolia", usdcToken: "0xUSDC" })),
  }));
  await jest.unstable_mockModule("@arbesk/wallet/adapters/eoa.js", () => ({
    createEoaSigner: jest.fn(() => ({})),
  }));
  await jest.unstable_mockModule("@arbesk/wallet/facade.js", () => ({
    buildUserIdentity: jest.fn(() => ({})),
  }));
  await jest.unstable_mockModule("viem", () => ({
    getContract: jest.fn(() => ({})),
    formatEther: jest.fn(() => "0"),
  }));
  await jest.unstable_mockModule("../../frontend/src/js/blockchain/viem-clients.ts", () => ({
    getReadClient: jest.fn(() => ({})),
  }));
  await jest.unstable_mockModule("../../frontend/src/js/blockchain/wallet-provider.ts", () => ({
    web3Provider: { request: jest.fn(async () => providerRpc.chainId), on: jest.fn() },
    setWeb3Provider,
    NETWORKS: { baseSepolia: {} },
  }));
  await jest.unstable_mockModule("../../frontend/src/js/blockchain/wallet-cdp.ts", () => ({
    warmupCdpClient: jest.fn(async () => {
      if (cdp.warmupError) throw cdp.warmupError;
      return cdp.warmup;
    }),
    autoConnectCdpWallet: jest.fn(async () => cdp.result),
    getCdpEmail: jest.fn(() => cdp.result?.email ?? null),
    getCdpSigner: jest.fn(() => ({})),
    grantDelegation: jest.fn(),
  }));
  await jest.unstable_mockModule("../../frontend/src/js/blockchain/wallet-network.ts", () => ({
    switchNetwork: jest.fn(async () => {}),
  }));
  return import("../../frontend/src/js/blockchain/wallet-core.js");
}

/** Returns the first walletAddress value _finishWalletSetup wrote, if any. */
function connectedAddress() {
  for (const call of walletState.set.mock.calls) {
    if (call[0] && typeof call[0].walletAddress === "string") return call[0].walletAddress;
  }
  return null;
}

beforeEach(() => {
  jest.resetModules();
  emit.mockClear();
  walletState.get.mockClear();
  walletState.get.mockReturnValue({ walletAddress: null });
  walletState.set.mockClear();
  setWeb3Provider.mockClear();
  warn.mockClear();
  error.mockClear();
  log.mockClear();
  localStorage.clear();
  delete window.ethereum;
  cdp.warmup = true;
  cdp.result = { smartAccountAddress: SMART_ADDR, eoaAddress: EOA_ADDR, email: EMAIL };
  cdp.warmupError = null;
  wc.provider = null;
  wc.accounts = [];
  discovery.rdnsWallet = null;
  discovery.accountsError = null;
  providerRpc.chainId = "0x14a34";
});

describe("autoConnectWallet branch selection", () => {
  test("CDP restore success connects the smart account (no EIP-1193 provider)", async () => {
    localStorage.setItem(LAST_WALLET_KEY, "cdp");
    const { autoConnectWallet } = await loadWalletCore();

    await autoConnectWallet();

    expect(connectedAddress()).toBe(SMART_ADDR);
    expect(setWeb3Provider).not.toHaveBeenCalled();
  });

  test("CDP restore with warmup ok but no result stays disconnected (no fallthrough)", async () => {
    localStorage.setItem(LAST_WALLET_KEY, "cdp");
    cdp.result = null;
    const { autoConnectWallet } = await loadWalletCore();

    await autoConnectWallet();

    expect(connectedAddress()).toBeNull();
    expect(setWeb3Provider).not.toHaveBeenCalled();
  });

  test("CDP restore with failed warmup stays disconnected (no fallthrough)", async () => {
    localStorage.setItem(LAST_WALLET_KEY, "cdp");
    cdp.warmup = false;
    const { autoConnectWallet } = await loadWalletCore();

    await autoConnectWallet();

    expect(connectedAddress()).toBeNull();
    expect(setWeb3Provider).not.toHaveBeenCalled();
  });

  test("CDP restore error clears the stored wallet and does not fall through", async () => {
    localStorage.setItem(LAST_WALLET_KEY, "cdp");
    cdp.warmupError = new Error("boom");
    const { autoConnectWallet } = await loadWalletCore();

    await autoConnectWallet();

    expect(warn).toHaveBeenCalled();
    expect(localStorage.getItem(LAST_WALLET_KEY)).toBeNull();
    expect(connectedAddress()).toBeNull();
    expect(setWeb3Provider).not.toHaveBeenCalled();
  });

  test("WalletConnect restore connects when a connected provider has accounts", async () => {
    localStorage.setItem(LAST_WALLET_KEY, "walletconnect");
    const provider = { connected: true, accounts: [WC_ADDR] };
    wc.provider = provider;
    const { autoConnectWallet } = await loadWalletCore();

    await autoConnectWallet();

    expect(setWeb3Provider).toHaveBeenCalledWith(provider);
    expect(connectedAddress()).toBe(WC_ADDR);
  });

  test("WalletConnect with no provider falls through to any injected provider", async () => {
    localStorage.setItem(LAST_WALLET_KEY, "walletconnect");
    window.ethereum = { request: jest.fn(async () => [FALLBACK_ADDR]) };
    const { autoConnectWallet } = await loadWalletCore();

    await autoConnectWallet();

    expect(setWeb3Provider).toHaveBeenCalledWith(window.ethereum);
    expect(connectedAddress()).toBe(FALLBACK_ADDR);
  });

  test("injected-by-rdns restore connects via the announced wallet provider", async () => {
    localStorage.setItem(LAST_WALLET_KEY, "io.metamask");
    const provider = { request: jest.fn(async () => [RDNS_ADDR]) };
    discovery.rdnsWallet = { rdns: "io.metamask", provider };
    const { autoConnectWallet } = await loadWalletCore();

    await autoConnectWallet();

    expect(setWeb3Provider).toHaveBeenCalledWith(provider);
    expect(connectedAddress()).toBe(RDNS_ADDR);
  });

  test("injected-by-rdns with silent eth_accounts failure falls through to any injected", async () => {
    localStorage.setItem(LAST_WALLET_KEY, "io.metamask");
    discovery.rdnsWallet = {
      rdns: "io.metamask",
      provider: { request: jest.fn(async () => { throw new Error("denied"); }) },
    };
    window.ethereum = { request: jest.fn(async () => [FALLBACK_ADDR]) };
    const { autoConnectWallet } = await loadWalletCore();

    await autoConnectWallet();

    expect(setWeb3Provider).toHaveBeenCalledWith(window.ethereum);
    expect(connectedAddress()).toBe(FALLBACK_ADDR);
  });

  test("injected-by-rdns with no matching wallet falls through to any injected", async () => {
    localStorage.setItem(LAST_WALLET_KEY, "io.metamask");
    discovery.rdnsWallet = null;
    window.ethereum = { request: jest.fn(async () => [FALLBACK_ADDR]) };
    const { autoConnectWallet } = await loadWalletCore();

    await autoConnectWallet();

    expect(setWeb3Provider).toHaveBeenCalledWith(window.ethereum);
    expect(connectedAddress()).toBe(FALLBACK_ADDR);
  });

  test("no stored wallet + any injected provider connects through the fallback", async () => {
    window.ethereum = { request: jest.fn(async () => [FALLBACK_ADDR]) };
    const { autoConnectWallet } = await loadWalletCore();

    await autoConnectWallet();

    expect(setWeb3Provider).toHaveBeenCalledWith(window.ethereum);
    expect(connectedAddress()).toBe(FALLBACK_ADDR);
  });

  test("no stored wallet + no injected provider stays disconnected", async () => {
    const { autoConnectWallet } = await loadWalletCore();

    await autoConnectWallet();

    expect(connectedAddress()).toBeNull();
    expect(setWeb3Provider).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
