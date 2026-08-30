/**
 * Arbesk Wallet Core
 *
 * Core wallet connection logic extracted from wallet.js.
 * Handles: provider init, contract init, balance checks,
 * auto-connect, full connect/disconnect flow, SIWE auth.
 *
 * Payment, publishing, network switching, and burn logic
 * live in sub-modules (wallet-payments.ts, wallet-publishing.ts,
 * wallet-network.ts).
 */

import { emit, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { walletState } from "../state/wallet-state.ts";
import { getContractAddress, getContractArtifact } from "../services/backend-client.ts";
import { showToast, dismissToast } from "../ui/toasts.ts";
import { log, warn, error } from "../utils/log.ts";
import {
  startDiscovery,
  requestWallets,
  getWalletByRdns,
} from "./wallet-discovery.ts";
import {
  getWalletConnectProvider,
  disconnectWalletConnect,
  onWalletConnectEvent,
  offWalletConnectEvent,
} from "./wallet-connect.ts";
import { showWalletModal } from "../ui/wallet-modal.ts";
import {
  getContractAddress as getNetworkContractAddress,
  getNetworkConfig,
} from "./network-config.ts";
import {
  CHAIN_IDS,
  SUPPORTED_CHAIN_IDS,
} from "../../../../constants/chains.js";
import type { Signer } from "@arbesk/wallet/types.js";
import { createEoaSigner } from "@arbesk/wallet/adapters/eoa.js";
import { buildUserIdentity } from "@arbesk/wallet/facade.js";
import { getContract, formatEther } from "viem";
import { getReadClient } from "./viem-clients.ts";
import { web3Provider, setWeb3Provider, NETWORKS } from "./wallet-provider.ts";

// ─── Module-level state ───

/** 'injected' | 'walletconnect' | 'cdp' | null */
let activeConnectionSource: "injected" | "walletconnect" | "cdp" | null = null;

/** rdns of the injected wallet (e.g., 'io.metamask') */
let _activeWalletRdns: string | null = null;

let contract: any = null;
let contractAddress: string | null = null;
let lowBalanceToastId: any = null;

/** Injected on-chain Signer for the active connection (see @arbesk/wallet/types.js). */
let signer: Signer | null = null;

// ─── Constants ───

const LAST_WALLET_KEY = "arbesk-last-wallet";
const HARHAT_CHAIN_ID_DEC = CHAIN_IDS.HARDHAT_LOCAL;

/**
 * Resolve the active wallet's chain id without a web3 instance.
 * CDP smart accounts are pinned to Base Sepolia; EOA/WalletConnect read the
 * chain from the injected EIP-1193 provider.
 */
async function _getWalletChainId(): Promise<number> {
  if (activeConnectionSource === "cdp") return CHAIN_IDS.BASE_TESTNET;
  if (web3Provider?.request) {
    const hex = await web3Provider.request({ method: "eth_chainId" });
    return Number(hex);
  }
  return CHAIN_IDS.HARDHAT_LOCAL;
}

// ─── Initialization ───

/**
 * Initialize wallet system. Starts EIP-6963 discovery.
 * Auto-restores the previous connection (CDP, EOA, or WalletConnect) via silent
 * eth_accounts / session checks — no popup is shown.
 */
function initWallet() {
  startDiscovery();
  log("[WALLET] EIP-6963 discovery started");
  // Silently restore the previous connection (CDP, EOA, or WalletConnect) via
  // eth_accounts / session checks — no popup is ever shown. First-time visitors
  // have no authorized account, so nothing happens and they still see
  // Login / Signup. This is what keeps an EOA login alive across page
  // navigations (index → studio → library are separate HTML documents).
  autoConnectWallet().catch((err) => {
    warn("[WALLET] auto-connect failed:", err);
  });
}

/**
 * Initialize contract instance if ABI and address are available.
 * Uses network-aware configuration: picks the contract address
 * based on the wallet's current chainId.
 *
 * @param knownChainId - chainId already resolved by the caller,
 *   avoiding a redundant eth_chainId round trip.
 */
async function _initContract(knownChainId: number | null = null) {
  try {
    const chainId = knownChainId ?? (await _getWalletChainId());
    const network = getNetworkConfig(chainId);

    // Kick off the ABI fetch immediately — it is independent of the address
    // lookup and the bytecode check below.
    const abiPromise = getContractArtifact("ArbeskAssetFree");

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
        `[CONTRACT] Using ${network!.name} config - ` +
          `contract=${addr} usdc=${network!.usdcToken}`
      );
    }
    if (!addr) return;

    // CDP smart wallets are pinned to Base Sepolia and the address comes from
    // network config (a deploy-time constant) — skip the bytecode check, which
    // costs a full public-RPC round trip. EOA/WalletConnect users can be on any
    // network, so the wrong-network guard still applies to them.
    const skipCodeCheck = activeConnectionSource === "cdp";
    const code = skipCodeCheck
      ? null
      : await getReadClient(chainId).getCode({ address: addr as `0x${string}` });
    if (!skipCodeCheck && (!code || code === "0x" || code === "0x0")) {
      warn(
        `[CONTRACT] No bytecode at ${addr}. ` +
          `Wrong network? Current chain: ${chainId}`
      );
      contractAddress = null;
      contract = null;
      walletState.set({ contract: null, contractAddress: null });
      return;
    }

    const abiData = (await abiPromise) as any;
    if (!abiData?.abi) return;

    contractAddress = addr;
    contract = getContract({
      address: contractAddress as `0x${string}`,
      abi: abiData.abi,
      client: getReadClient(chainId),
    });
    walletState.set({ contract, contractAddress });
  } catch (e) {
    warn("Contract initialization failed:", (e as Error).message);
  }
}

// ─── Balance ───

/**
 * Check wallet balance and warn if too low for generation.
 */
async function _checkBalance() {
  const { walletAddress } = walletState.get();
  if (!walletAddress) return;
  try {
    const balanceWei = await getReadClient().getBalance({
      address: walletAddress as `0x${string}`,
    });
    const balanceEth = formatEther(balanceWei);
    log("Balance:", balanceEth, "ETH");

    // Clear any previous low-balance toast before deciding again.
    if (lowBalanceToastId) {
      dismissToast(lowBalanceToastId);
      lowBalanceToastId = null;
    }

    const chainId = await getReadClient().getChainId();

    if (chainId === HARHAT_CHAIN_ID_DEC && parseFloat(balanceEth) < 0.1) {
      warn("Low balance detected on Hardhat");
      const { DEV_ACCOUNT_ADDRESS } = await import("./dev-account.ts");
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

    if (lastWallet === "cdp") {
      // Try CDP silent restore
      try {
        const _t0 = performance.now();
        const _mark = (label: string) => console.log(`[LOGIN-TIMING] ${label}: ${Math.round(performance.now() - _t0)}ms`);
        const { warmupCdpClient, autoConnectCdpWallet, getCdpEmail } = await import("./wallet-cdp.ts");
        _mark("sdkModuleImport");
        // warmupCdpClient was kicked off at page load (app-init.js) — this
        // awaits the shared in-flight promise, so the config fetch + SDK
        // initialize overlap with UI setup instead of serializing here.
        const warmed = await warmupCdpClient();
        _mark("initCdpClient (warmup)");
        if (warmed) {
          const cdpResult = await autoConnectCdpWallet();
          _mark("autoConnectCdpWallet");
          if (cdpResult) {
            // CDP: contract reads go through the viem read client (public RPC);
            // writes go through the injected CdpSigner. No EIP-1193 provider.
            activeConnectionSource = "cdp";
            const email = getCdpEmail() || cdpResult.email || null;
            await _finishWalletSetup(cdpResult.smartAccountAddress, cdpResult.eoaAddress, email);
            _mark("finishWalletSetup (total restore)");
            return;
          }
        }
        // lastWallet was "cdp" but restore did not connect — don't fall
        // through to the injected-wallet probe below.
        return;
      } catch (cdpErr) {
        warn("[WALLET] CDP auto-connect failed:", (cdpErr as Error).message);
        localStorage.removeItem(LAST_WALLET_KEY);
        return;
      }
    } else if (lastWallet === "walletconnect") {
      // Try WalletConnect silent restore
      const wcProvider = await getWalletConnectProvider();
      if (wcProvider && wcProvider.connected) {
        setWeb3Provider(wcProvider);
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
            setWeb3Provider(wallet.provider);
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
        setWeb3Provider(window.ethereum);
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
async function _finishWalletSetup(
  address: string,
  eoaAddress: string | null = null,
  email: string | null = null
) {
  walletState.set({
    walletAddress: address,
    eoaAddress: eoaAddress || address,
    walletSource: activeConnectionSource,
    email,
    identity: buildUserIdentity({
      address,
      email: email || null,
      source: activeConnectionSource,
    }),
  });

  // Build the injected Signer for this connection source. CDP uses the native
  // signer built during the OTP flow; EOA/WalletConnect wrap the injected provider.
  if (activeConnectionSource === "cdp") {
    const { getCdpSigner, grantDelegation } = await import("./wallet-cdp.ts");
    signer = getCdpSigner();
    // One-time delegation grant (fire-and-forget) so backend relay works for
    // subsequent writes without the browser.
    void grantDelegation();
  } else {
    signer = createEoaSigner(web3Provider, address);
  }

  let chainId = await _getWalletChainId();
  walletState.set({ chainId });
  log("Connected wallet:", address, "chainId:", chainId);
  const _tSetup = performance.now();
  const _markSetup = (label: string) => console.log(`[LOGIN-TIMING] setup:${label}: ${Math.round(performance.now() - _tSetup)}ms`);

  // Prompt network switch if not on a supported chain.
  // CDP smart wallets are pinned to Base Sepolia, so this only applies to EOA/WC.
  if (
    activeConnectionSource !== "cdp" &&
    !SUPPORTED_CHAIN_IDS.includes(chainId)
  ) {
    let preferred =
      localStorage.getItem("arbesk-preferred-network") || "baseSepolia";
    // Guard against stale/unknown network keys stored in localStorage
    if (!NETWORKS[preferred as keyof typeof NETWORKS]) {
      warn(
        `[WALLET] Ignoring unknown preferred network "${preferred}". ` +
          `Falling back to baseSepolia.`
      );
      localStorage.removeItem("arbesk-preferred-network");
      preferred = "baseSepolia";
    }
    try {
      // switchNetwork falls back to wallet_addEthereumChain when the chain
      // is unknown to the wallet (MetaMask 4902 / Rabby -32603), so a wallet
      // that has never seen Base Sepolia gets prompted to add it.
      const { switchNetwork } = await import("./wallet-network.ts");
      await switchNetwork(preferred);
      chainId = await _getWalletChainId();
      walletState.set({ chainId });
    } catch {
      warn("User did not switch to a supported network");
    }
  }

  await _initContract(chainId);
  _markSetup("initContract");
  // CDP smart accounts are gasless (sponsored UserOps) — skip the low-ETH warning.
  if (activeConnectionSource !== "cdp") {
    await _checkBalance();
    _markSetup("checkBalance");
  }

  emit(EVENTS.WALLET_CONNECTED, {
    address,
    chainId,
  });
  _markSetup("walletConnectedEmitted");

  // Setup listeners (only once per provider)
  _attachProviderListeners();

  // Only authenticate once we're on a supported chain. If the network switch
  // above was declined, the SIWE message would carry an unsupported chainId
  // and the backend rejects the session (400 Unsupported chain ID). Surface a
  // clear prompt instead of spamming failed session-creation requests.
  if (SUPPORTED_CHAIN_IDS.includes(chainId)) {
    // Eagerly authenticate (non-blocking)
    authenticateUser();
  } else {
    warn(
      `[WALLET] Connected on unsupported chain ${chainId}; ` +
        `skipping session auth until the user switches network.`
    );
    showToast({
      type: "warning",
      title: "Wrong Network",
      message:
        "Arbesk runs on Base Sepolia. Switch networks in your wallet to continue.",
      duration: 0,
    });
  }
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

  const handleAccountsChanged = (accounts: string[]) => {
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
  };
  const handleChainChanged = () => {
    window.location.reload();
  };

  if (activeConnectionSource === "walletconnect") {
    // WalletConnect uses its own event emitter
    onWalletConnectEvent("accountsChanged", handleAccountsChanged);
    onWalletConnectEvent("chainChanged", handleChainChanged);

    onWalletConnectEvent("disconnect", () => {
      disconnectWallet();
    });
  } else {
    // Injected wallet (EIP-1193)
    web3Provider.on("accountsChanged", handleAccountsChanged);
    web3Provider.on("chainChanged", handleChainChanged);
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
  const _tAuth = performance.now();
  try {
    const { getOrCreateSession } = await import("../services/backend-client.ts");
    const session = await getOrCreateSession();
    console.log(`[LOGIN-TIMING] sessionAuth: ${Math.round(performance.now() - _tAuth)}ms`);
    emit(EVENTS.USER_AUTHENTICATED, {
      address: walletState.get().walletAddress,
      session,
    });
  } catch (err) {
    warn("[AUTH] Session creation failed or rejected:", (err as Error).message);
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
    const result = (await showWalletModal()) as any;
    if (!result) {
      log("User cancelled wallet selection");
      return;
    }

    const { provider, source, walletName, walletRdns, walletAddress: cdpWalletAddress, eoaAddress: cdpEoaAddress } = result;

    if (source === "cdp") {
      // CDP smart account — viem read client + native signer; no EIP-1193 provider.
      const { setCdpEmail } = await import("./wallet-cdp.ts");
      activeConnectionSource = "cdp";
      _activeWalletRdns = null;
      localStorage.setItem(LAST_WALLET_KEY, "cdp");
      if (result.email) {
        setCdpEmail(result.email);
      }
      await _finishWalletSetup(cdpWalletAddress, cdpEoaAddress, result.email || null);
    } else if (source === "walletconnect") {
      // WalletConnect provider is already connected by this point
      setWeb3Provider(provider);
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
      setWeb3Provider(provider);
      activeConnectionSource = "injected";
      _activeWalletRdns = walletRdns || null;

      const accounts = await web3Provider.request({
        method: "eth_requestAccounts",
      });
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
    // Closing the picker is a normal action, not a failure — keep it out of
    // the error log so real connection failures stand out.
    if ((err as Error).message?.includes("User cancelled")) {
      log("User cancelled wallet selection");
    } else {
      error("Wallet connection failed:", err);
      showToast({
        type: "error",
        title: "Sign In Failed",
        message: (err as Error).message || "Could not sign in.",
      });
    }
  }
}

/**
 * Return the currently active connection source.
 * @returns 'injected' | 'walletconnect' | 'cdp' | null
 */
function getActiveConnectionSource() {
  return activeConnectionSource;
}

/**
 * The injected on-chain Signer for the active connection, or null when
 * disconnected. Prefer this over the raw provider for signing/sending.
 */
function getSigner(): Signer | null {
  return signer;
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
    } else if (activeConnectionSource === "cdp") {
      // CDP cleanup — sign out from CDP session
      try {
        const { disconnectCdpWallet } = await import("./wallet-cdp.ts");
        await disconnectCdpWallet();
      } catch (cdpErr) {
        warn("[WALLET] CDP disconnect failed (non-fatal):", (cdpErr as Error).message);
      }
    } else if (web3Provider.removeListener) {
      web3Provider.removeListener("accountsChanged", () => {});
      web3Provider.removeListener("chainChanged", () => {});
    }
    web3Provider._arbeskListenersAttached = false;
  }

  activeConnectionSource = null;
  _activeWalletRdns = null;
  setWeb3Provider(null);
  signer = null;
  contract = null;
  contractAddress = null;
  walletState.reset();
  if (lowBalanceToastId) {
    dismissToast(lowBalanceToastId);
    lowBalanceToastId = null;
  }
  localStorage.removeItem(LAST_WALLET_KEY);
  const { clearCdpEmail } = await import("./wallet-cdp.ts");
  clearCdpEmail();
  emit(EVENTS.WALLET_DISCONNECTED);
}

// ─── Exports ───

/**
 * Get the active contract instance, preferring the module-level binding and
 * falling back to walletState (both are kept in sync by _initContract).
 * @returns viem contract instance, or null when not initialized
 */
function getActiveContract(): any {
  return contract || walletState.get().contract || null;
}

export {
  contract,
  initWallet,
  connectWallet,
  disconnectWallet,
  autoConnectWallet,
  authenticateUser,
  getActiveConnectionSource,
  getActiveContract,
  getSigner,
};
