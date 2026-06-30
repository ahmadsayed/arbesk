// @ts-nocheck
/**
 * Arbesk Wallet Core
 *
 * Core wallet connection logic extracted from wallet.js.
 * Handles: provider init, contract init, balance checks,
 * auto-connect, full connect/disconnect flow, SIWE auth.
 *
 * Payment, publishing, network switching, and burn logic
 * live in sub-modules (wallet-payments.js, wallet-publishing.js,
 * wallet-network.js).
 */

import { emit, EVENTS } from "../events/bus.js";
import { walletState } from "../state/wallet-state.js";
import { getContractAddress, getContractArtifact } from "../services/api.js";
import { showToast, dismissToast } from "../ui/toasts.js";
import { log, warn, error } from "../utils/log.js";
import {
  startDiscovery,
  requestWallets,
  getWalletByRdns,
} from "./wallet-discovery.js";
import {
  getWalletConnectProvider,
  disconnectWalletConnect,
  onWalletConnectEvent,
  offWalletConnectEvent,
} from "./wallet-connect.js";
import { showWalletModal } from "../ui/wallet-modal.js";
import {
  getContractAddress as getNetworkContractAddress,
  getNetworkConfig,
} from "./network-config.js";
import {
  CHAIN_IDS,
  SUPPORTED_CHAIN_IDS,
} from "../../../../constants/chains.js";

// ─── Network definitions (shared with wallet-network.js) ───

export const NETWORKS = {
  hardhat: {
    chainId: `0x${CHAIN_IDS.HARDHAT_LOCAL.toString(16)}`,
    chainName: "Hardhat Local",
    rpcUrls: ["http://127.0.0.1:8545"],
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    blockExplorerUrls: [],
  },
  baseSepolia: {
    chainId: `0x${CHAIN_IDS.BASE_TESTNET.toString(16)}`,
    chainName: "Base Sepolia Testnet",
    rpcUrls: ["https://sepolia.base.org"],
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    blockExplorerUrls: ["https://sepolia.basescan.org"],
  },
};

// ─── Module-level state ───

/** @type {string|null} 'injected' | 'walletconnect' | 'cdp' | null */
let activeConnectionSource = null;

/** @type {string|null} rdns of the injected wallet (e.g., 'io.metamask') */
let _activeWalletRdns = null;

let web3Provider = null;
let web3 = null;
let contract = null;
let contractAddress = null;
let lowBalanceToastId = null;

// ─── Constants ───

const LAST_WALLET_KEY = "arbesk-last-wallet";
const HARHAT_CHAIN_ID_DEC = CHAIN_IDS.HARDHAT_LOCAL;

// web3@1.x polls eth_getTransactionReceipt every 1000ms by default, adding up
// to a second of dead time after a tx (or sponsored UserOperation) is mined.
// 250ms detects the receipt sooner — most noticeable for ERC-4337 smart
// accounts, where the bundler returns the hash only after inclusion.
const TX_POLLING_INTERVAL_MS = 250;

/**
 * Build a Web3 instance with a tightened receipt polling interval.
 * @param {*} provider EIP-1193 provider
 * @returns {*} configured Web3 instance
 */
function newWeb3(provider) {
  const w = new Web3(provider);
  try {
    w.eth.transactionPollingInterval = TX_POLLING_INTERVAL_MS;
  } catch {
    // Older/newer web3 builds may not expose this setter — safe to ignore.
  }
  return w;
}

// ─── Initialization ───

/**
 * Initialize wallet system. Starts EIP-6963 discovery.
 * Does NOT auto-connect.
 */
function initWallet() {
  startDiscovery();
  log("[WALLET] EIP-6963 discovery started");
  // Attempt silent reconnect on page load.
  autoConnectWallet().catch((err) => {
    warn("[WALLET] auto-connect failed:", err);
  });
}

/**
 * Initialize contract instance if ABI and address are available.
 * Uses network-aware configuration: picks the contract address
 * based on the wallet's current chainId.
 */
async function _initContract() {
  try {
    const chainId = Number(await web3.eth.getChainId());
    const network = getNetworkConfig(chainId);

    let addr = getNetworkContractAddress(chainId);
    if (!addr) {
      // Fallback to backend config for unknown networks
      addr = await getContractAddress();
      warn(
        `[CONTRACT] No network config for chain ${chainId}. ` +
          `Falling back to backend address: ${addr}`
      );
    } else {
      log(
        `[CONTRACT] Using ${network.name} config - ` +
          `contract=${addr} usdc=${network.usdcToken}`
      );
    }

    const abiData = await getContractArtifact("ArbeskAssetFree");
    if (!addr) return;
    if (!abiData?.abi) return;

    // Verify contract actually exists at this address on the current chain
    const code = await web3.eth.getCode(addr);
    if (!code || code === "0x" || code === "0x0") {
      warn(
        `[CONTRACT] No bytecode at ${addr}. ` +
          `Wrong network? Current chain: ${chainId}`
      );
      contractAddress = null;
      contract = null;
      walletState.set({ contract: null, contractAddress: null });
      return;
    }

    contractAddress = addr;
    contract = new web3.eth.Contract(abiData.abi, contractAddress);
    walletState.set({ contract, contractAddress });
  } catch (e) {
    warn("Contract initialization failed:", e.message);
  }
}

// ─── Balance ───

/**
 * Check wallet balance and warn if too low for generation.
 */
async function _checkBalance() {
  const { walletAddress } = walletState.get();
  if (!web3 || !walletAddress) return;
  try {
    const balanceWei = await web3.eth.getBalance(walletAddress);
    const balanceEth = web3.utils.fromWei(balanceWei, "ether");
    log("Balance:", balanceEth, "ETH");

    // Clear any previous low-balance toast before deciding again.
    if (lowBalanceToastId) {
      dismissToast(lowBalanceToastId);
      lowBalanceToastId = null;
    }

    let chainId = await web3.eth.getChainId();
    chainId = Number(chainId);

    if (chainId === HARHAT_CHAIN_ID_DEC && parseFloat(balanceEth) < 0.1) {
      warn("Low balance detected on Hardhat");
      const { DEV_ACCOUNT_ADDRESS } = await import("./dev-account.js");
      if (walletAddress.toLowerCase() !== DEV_ACCOUNT_ADDRESS.toLowerCase()) {
        lowBalanceToastId = showToast({
          type: "warning",
          title: "Low Balance",
          message: `Your wallet has insufficient funds on Hardhat. Import dev account: ${DEV_ACCOUNT_ADDRESS}`,
          duration: 0,
        });
      }
    } else if (
      chainId === CHAIN_IDS.BASE_TESTNET &&
      parseFloat(balanceEth) < 0.001
    ) {
      warn("Low balance detected on Base Sepolia Testnet");
      lowBalanceToastId = showToast({
        type: "warning",
        title: "Low Balance",
        message: `Your wallet has very low ETH on Base Sepolia Testnet. You need ETH for gas. Get testnet ETH from a Base Sepolia faucet.`,
        duration: 0,
      });
    }
  } catch (e) {
    warn("Balance check failed:", e);
  }
}

// ─── Auto-connect ───

/**
 * Auto-sign-in on page load if previously authorized.
 * Uses silent methods (no popup) to restore connection.
 */
async function autoConnectWallet() {
  try {
    const lastWallet = localStorage.getItem(LAST_WALLET_KEY);

    if (lastWallet === "walletconnect") {
      // Try WalletConnect silent restore
      const wcProvider = await getWalletConnectProvider();
      if (wcProvider && wcProvider.connected) {
        web3Provider = wcProvider;
        web3 = newWeb3(wcProvider);
        window.web3 = web3;
        const accounts = wcProvider.accounts || [];
        if (accounts.length > 0) {
          activeConnectionSource = "walletconnect";
          await _finishWalletSetup(accounts[0]);
          return;
        }
      }
    } else if (lastWallet) {
      // Try to reconnect injected wallet by rdns
      requestWallets();
      // Give wallets a moment to announce
      await new Promise((r) => setTimeout(r, 300));
      const wallet = getWalletByRdns(lastWallet);
      if (wallet && wallet.provider) {
        // Try silent eth_accounts (no popup)
        try {
          const accounts = await wallet.provider.request({
            method: "eth_accounts",
          });
          if (accounts && accounts.length > 0) {
            web3Provider = wallet.provider;
            web3 = newWeb3(wallet.provider);
            window.web3 = web3;
            activeConnectionSource = "injected";
            _activeWalletRdns = wallet.rdns;
            await _finishWalletSetup(accounts[0]);
            return;
          }
        } catch {
          // Silent fail - wallet not authorized
        }
      }
    }

    // Fallback: try any available injected provider (MetaMask-style)
    if (window.ethereum) {
      const accounts = await window.ethereum.request({
        method: "eth_accounts",
      });
      if (accounts && accounts.length > 0) {
        web3Provider = window.ethereum;
        web3 = newWeb3(window.ethereum);
        activeConnectionSource = "injected";
        _activeWalletRdns = null; // unknown which wallet
        await _finishWalletSetup(accounts[0]);
        return;
      }
    }

    // No previous connection - stay disconnected
  } catch (err) {
    error("Auto-connect failed:", err);
  }
}

// ─── Shared setup ───

/**
 * Shared setup after provider is established (accounts, chain, contract, listeners).
 */
async function _finishWalletSetup(address, eoaAddress = null) {
  walletState.set({ walletAddress: address, eoaAddress: eoaAddress || address });

  let chainId = Number(await web3.eth.getChainId());
  walletState.set({ chainId });
  log("Connected wallet:", address, "chainId:", chainId);

  // Prompt network switch if not on a supported chain
  if (!SUPPORTED_CHAIN_IDS.includes(chainId)) {
    let preferred =
      localStorage.getItem("arbesk-preferred-network") || "baseSepolia";
    // Guard against stale/unknown network keys stored in localStorage
    if (!NETWORKS[preferred]) {
      warn(
        `[WALLET] Ignoring unknown preferred network "${preferred}". ` +
          `Falling back to baseSepolia.`
      );
      localStorage.removeItem("arbesk-preferred-network");
      preferred = "baseSepolia";
    }
    try {
      const net = NETWORKS[preferred];
      await web3Provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: net.chainId }],
      });
      chainId = Number(await web3.eth.getChainId());
      walletState.set({ chainId });
    } catch {
      warn("User did not switch to a supported network");
    }
  }

  await _initContract();
  await _checkBalance();

  emit(EVENTS.WALLET_CONNECTED, {
    address,
    chainId,
  });

  // Setup listeners (only once per provider)
  _attachProviderListeners();

  // Eagerly authenticate (non-blocking)
  authenticateUser();
}

// ─── Provider listeners ───

/**
 * Attach accountsChanged / chainChanged listeners to the active provider.
 * Handles both injected wallets and WalletConnect.
 */
function _attachProviderListeners() {
  if (!web3Provider) return;
  if (web3Provider._arbeskListenersAttached) return;
  web3Provider._arbeskListenersAttached = true;

  if (activeConnectionSource === "walletconnect") {
    // WalletConnect uses its own event emitter
    onWalletConnectEvent("accountsChanged", (accounts) => {
      if (!accounts || accounts.length === 0) {
        disconnectWallet();
      } else {
        walletState.set({ walletAddress: accounts[0] });
        _checkBalance();
        emit(EVENTS.WALLET_CONNECTED, {
          address: walletState.get().walletAddress,
          chainId: null,
        });
      }
    });

    onWalletConnectEvent("chainChanged", () => {
      window.location.reload();
    });

    onWalletConnectEvent("disconnect", () => {
      disconnectWallet();
    });
  } else {
    // Injected wallet (EIP-1193)
    web3Provider.on("accountsChanged", (accounts) => {
      if (accounts.length === 0) {
        disconnectWallet();
      } else {
        walletState.set({ walletAddress: accounts[0] });
        _checkBalance();
        emit(EVENTS.WALLET_CONNECTED, {
          address: walletState.get().walletAddress,
          chainId: null,
        });
      }
    });

    web3Provider.on("chainChanged", () => {
      window.location.reload();
    });
  }
}

// ─── Authentication ───

/**
 * Eagerly authenticate the user after wallet connection.
 * Tries to create/reuse a session token. If the user rejects the sign,
 * dispatches user:auth-required so the UI can show a "Sign In" prompt.
 *
 * Uses dynamic import to avoid circular dependency with api.js
 */
async function authenticateUser() {
  try {
    const { getOrCreateSession } = await import("../services/api.js");
    const session = await getOrCreateSession();
    emit(EVENTS.USER_AUTHENTICATED, {
      address: walletState.get().walletAddress,
      session,
    });
  } catch (err) {
    warn("[AUTH] Session creation failed or rejected:", err.message);
    emit(EVENTS.USER_AUTH_REQUIRED, {
      address: walletState.get().walletAddress,
    });
  }
}

// ─── Connect / Disconnect ───

/**
 * Sign in. Shows the Login / Signup picker modal.
 */
async function connectWallet() {
  try {
    const result = await showWalletModal();
    if (!result) {
      log("User cancelled wallet selection");
      return;
    }

    const { provider, source, walletName, walletRdns } = result;

    if (source === "walletconnect") {
      // WalletConnect provider is already connected by this point
      web3Provider = provider;
      web3 = newWeb3(provider);
      activeConnectionSource = "walletconnect";
      _activeWalletRdns = null;
      localStorage.setItem(LAST_WALLET_KEY, "walletconnect");

      const accounts = provider.accounts || [];
      if (!accounts || accounts.length === 0) {
        error("No accounts found from WalletConnect");
        return;
      }
      await _finishWalletSetup(accounts[0]);
    } else {
      // Injected wallet - request accounts to trigger popup
      web3Provider = provider;
      web3 = newWeb3(provider);
      activeConnectionSource = "injected";
      _activeWalletRdns = walletRdns || null;

      const accounts = await web3.eth.requestAccounts();
      if (!accounts || accounts.length === 0) {
        error("No accounts found");
        return;
      }
      // Store last used wallet for auto-connect (use rdns for accurate identification)
      const reconnectId = walletRdns || walletName;
      if (reconnectId) {
        localStorage.setItem(LAST_WALLET_KEY, reconnectId);
      }
      await _finishWalletSetup(accounts[0]);
    }
  } catch (err) {
    error("Wallet connection failed:", err);
    if (err.message?.includes("User cancelled")) {
      log("User rejected connection");
    } else {
      showToast({
        type: "error",
        title: "Sign In Failed",
        message: err.message || "Could not sign in.",
      });
    }
  }
}

/**
 * Return the currently active connection source.
 * @returns {string|null} 'injected' | 'walletconnect' | 'cdp' | null
 */
function getActiveConnectionSource() {
  return activeConnectionSource;
}

/**
 * Sign out and disconnect wallet.
 */
async function disconnectWallet() {
  // Detach listeners
  if (web3Provider) {
    if (activeConnectionSource === "walletconnect") {
      offWalletConnectEvent("accountsChanged", () => {});
      offWalletConnectEvent("chainChanged", () => {});
      offWalletConnectEvent("disconnect", () => {});
      await disconnectWalletConnect();
    } else if (web3Provider.removeListener) {
      web3Provider.removeListener("accountsChanged", () => {});
      web3Provider.removeListener("chainChanged", () => {});
    }
    web3Provider._arbeskListenersAttached = false;
  }

  activeConnectionSource = null;
  _activeWalletRdns = null;
  web3Provider = null;
  web3 = null;
  contract = null;
  contractAddress = null;
  walletState.reset();
  if (lowBalanceToastId) {
    dismissToast(lowBalanceToastId);
    lowBalanceToastId = null;
  }
  localStorage.removeItem(LAST_WALLET_KEY);
  emit(EVENTS.WALLET_DISCONNECTED);
}

// ─── Exports ───

export {
  web3,
  web3Provider,
  contract,
  initWallet,
  connectWallet,
  disconnectWallet,
  autoConnectWallet,
  authenticateUser,
  getActiveConnectionSource,
};

export { web3 as walletWeb3 };
