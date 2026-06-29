// @ts-nocheck
/**
 * Thirdweb In-App Wallet + Smart Account integration.
 *
 * Provides an EIP-1193 provider shim so the rest of the app can keep using
 * Web3.js unchanged. Google OAuth creates an embedded EOA (address X), which
 * is then wrapped in an ERC-4337 smart account (address Y). Transactions are
 * sent as sponsored UserOperations. Smart wallets are supported on Monad
 * Testnet by default; MegaETH Testnet requires an EOA wallet.
 */

import { createThirdwebClient } from "thirdweb";
import { inAppWallet } from "thirdweb/wallets/in-app";
import { smartWallet, EIP1193 } from "thirdweb/wallets";
import { defineChain } from "thirdweb/chains";
import { log, error, warn } from "../utils/log.js";
import { CHAIN_IDS } from "../../../../constants/chains.js";
import {
  isSmartWalletSupported,
  SMART_WALLET_SUPPORTED_CHAIN_IDS,
} from "./smart-wallet-support.js";

export { isSmartWalletSupported, SMART_WALLET_SUPPORTED_CHAIN_IDS };

const RPC_URLS = {
  [CHAIN_IDS.MEGAETH_TESTNET]: "https://carrot.megaeth.com/rpc",
  [CHAIN_IDS.MONAD_TESTNET]: "https://testnet-rpc.monad.xyz/",
};

/**
 * Get the Thirdweb chain definition for the active or preferred network.
 * Defaults to Monad Testnet (the smart-wallet-friendly default).
 * @returns {import("thirdweb/chains").Chain}
 */
function getThirdwebChain() {
  const preferred = localStorage.getItem("arbesk-preferred-network") || "monadTestnet";
  const keyMap = {
    hardhat: CHAIN_IDS.HARDHAT_LOCAL,
    megaethTestnet: CHAIN_IDS.MEGAETH_TESTNET,
    monadTestnet: CHAIN_IDS.MONAD_TESTNET,
  };
  const chainId = keyMap[preferred] || CHAIN_IDS.MONAD_TESTNET;
  return defineChain({
    id: chainId,
    rpc: RPC_URLS[chainId] || RPC_URLS[CHAIN_IDS.MONAD_TESTNET],
  });
}

/** @type {ReturnType<createThirdwebClient> | null} */
let thirdwebClient = null;

/** @type {ReturnType<inAppWallet> | null} */
let eoaWallet = null;

/** @type {ReturnType<smartWallet> | null} */
let smartWalletInstance = null;

/** @type {import("thirdweb/wallets").Account | null} */
let eoaAccount = null;

/** @type {import("thirdweb/wallets").Account | null} */
let smartAccount = null;

/**
 * The wrapped EIP-1193 provider for the active smart account, retained so the
 * background pre-warm can issue JSON-RPC calls (eth_getCode, eth_sendTransaction).
 * @type {{ request: (args: object) => Promise<unknown> } | null}
 */
let currentProvider = null;

/**
 * Initialize the shared Thirdweb client.
 * @param {string} clientId
 */
export function initThirdwebClient(clientId) {
  if (!thirdwebClient) {
    thirdwebClient = createThirdwebClient({ clientId });
  }
  return thirdwebClient;
}

/**
 * @returns {boolean}
 */
export function isThirdwebConnected() {
  return smartAccount !== null;
}

/**
 * Wrap an EOA account in a sponsored smart account and expose it through
 * Thirdweb's built-in EIP-1193 adapter.
 * @param {import("thirdweb/wallets").Account} resolvedEoaAccount
 * @param {import("thirdweb/chains").Chain} chain
 * @returns {Promise<{ eoaAddress: string, smartAccountAddress: string, provider: Object }>}
 */
async function wrapInSmartAccount(resolvedEoaAccount, chain) {
  smartWalletInstance = smartWallet({ chain, sponsorGas: true });
  smartAccount = await smartWalletInstance.connect({
    client: thirdwebClient,
    personalAccount: resolvedEoaAccount,
  });
  log("[THIRDWEB] smart account connected:", smartAccount.address);
  // Thirdweb's EIP-1193 adapter lets Web3.js drive the smart wallet unchanged:
  // transactions route through the smart account as sponsored UserOperations,
  // and reads fall through to the chain's RPC. We don't need the old EOA-vs-
  // smart-account signing split because Thirdweb wallets authenticate to the
  // backend via a JWT (getThirdwebAuthToken), not SIWE personal_sign.
  //
  // Thirdweb's internal RPC client returns BigInt for numeric JSON-RPC fields
  // (e.g. eth_estimateGas → 83856n). Web3.js expects hex strings. Wrap the
  // provider's request method to recursively convert any BigInt to "0x…".
  const rawProvider = EIP1193.toProvider({
    wallet: smartWalletInstance,
    chain,
    client: thirdwebClient,
  });
  const provider = {
    ...rawProvider,
    request: async (args) => bigIntToHex(await rawProvider.request(args)),
  };
  currentProvider = provider;

  // Kick off background deployment so the first sponsored UserOperation the user
  // triggers (e.g. creating a collection) doesn't also pay the account-creation
  // cost. Fire-and-forget: never block connect on it, and never await it on the
  // critical path (awaiting could serialize two UserOperations and regress a
  // fast user). When the deploy lands during idle time, the first real action is
  // a single, cheaper UserOperation with no initCode.
  void prewarmSmartAccount();

  return {
    eoaAddress: resolvedEoaAccount.address,
    smartAccountAddress: smartAccount.address,
    provider,
  };
}

/**
 * Deploy the smart account in the background if it isn't already on-chain.
 * No-op (and no UserOperation) when the account is already deployed, so
 * returning users never pay for a redundant sponsored transaction.
 * @returns {Promise<void>}
 */
async function prewarmSmartAccount() {
  if (!smartAccount || !currentProvider) return;
  const address = smartAccount.address;
  try {
    const code = await currentProvider.request({
      method: "eth_getCode",
      params: [address, "latest"],
    });
    if (code && code !== "0x" && code !== "0x0") {
      log("[THIRDWEB] smart account already deployed; skipping pre-warm");
      return;
    }
    log("[THIRDWEB] pre-warming: deploying smart account in background");
    // A no-op self-call with empty data; the bundler includes the factory
    // initCode automatically because the account isn't deployed yet.
    await currentProvider.request({
      method: "eth_sendTransaction",
      params: [{ from: address, to: address, value: "0x0", data: "0x" }],
    });
    log("[THIRDWEB] smart account deployment pre-warmed");
  } catch (err) {
    warn("[THIRDWEB] pre-warm failed (non-fatal):", err.message);
  }
}

/**
 * Recursively convert any BigInt value to a "0x…" hex string so Web3.js can
 * process JSON-RPC responses from Thirdweb's internal RPC client.
 * @param {unknown} value
 * @returns {unknown}
 */
function bigIntToHex(value) {
  if (typeof value === "bigint") return "0x" + value.toString(16);
  if (Array.isArray(value)) return value.map(bigIntToHex);
  if (value !== null && typeof value === "object") {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = bigIntToHex(v);
    return out;
  }
  return value;
}

/**
 * Connect a Google In-App Wallet and wrap it in a sponsored smart account.
 * @returns {Promise<{ eoaAddress: string, smartAccountAddress: string, provider: Object }>}
 */
export async function connectGoogleWallet() {
  if (!thirdwebClient) {
    throw new Error("Thirdweb client not initialized. Call initThirdwebClient first.");
  }

  const chain = getThirdwebChain();
  if (!isSmartWalletSupported(chain.id)) {
    warn(`[THIRDWEB] Smart wallets are not supported on chain ${chain.id}`);
    throw new Error(
      `Google smart wallets are only supported on Monad Testnet. Please select Monad Testnet in the network dropdown and try again.`
    );
  }

  try {
    // 1. Connect embedded EOA via Google OAuth (popup mode).
    // We use popup mode because Thirdweb's redirect-mode resume is unreliable
    // and produced an infinite Google <-> localhost redirect loop. The backend
    // now sets Cross-Origin-Opener-Policy: same-origin-allow-popups so the
    // OAuth popup can communicate back to the opener.
    log(`[THIRDWEB] Google OAuth connecting via popup on chain ${chain.id}`);
    eoaWallet = inAppWallet({
      auth: {
        mode: "popup",
      },
    });

    eoaAccount = await eoaWallet.connect({
      client: thirdwebClient,
      chain,
      strategy: "google",
    });
    log("[THIRDWEB] Google EOA connected:", eoaAccount.address);

    // 2. Wrap the EOA in a sponsored smart account on the selected chain.
    return await wrapInSmartAccount(eoaAccount, chain);
  } catch (err) {
    error("[THIRDWEB] connectGoogleWallet failed:", err);
    throw err;
  }
}

/**
 * Attempt to silently restore a previous Thirdweb in-app wallet session.
 * Returns null if no session is available (user must sign in again).
 * @returns {Promise<{ eoaAddress: string, smartAccountAddress: string, provider: Object }|null>}
 */
export async function autoConnectThirdwebWallet() {
  if (!thirdwebClient) {
    throw new Error("Thirdweb client not initialized. Call initThirdwebClient first.");
  }

  const chain = getThirdwebChain();
  if (!isSmartWalletSupported(chain.id)) {
    return null;
  }

  try {
    eoaWallet = inAppWallet({
      auth: {
        mode: "popup",
      },
    });

    if (!eoaWallet.autoConnect) {
      return null;
    }

    eoaAccount = await eoaWallet.autoConnect({
      client: thirdwebClient,
      chain,
    });

    if (!eoaAccount) {
      return null;
    }

    log("[THIRDWEB] Google EOA auto-restored:", eoaAccount.address);

    return await wrapInSmartAccount(eoaAccount, chain);
  } catch (err) {
    log("[THIRDWEB] auto-connect failed:", err.message);
    eoaWallet = null;
    eoaAccount = null;
    smartAccount = null;
    smartWalletInstance = null;
    return null;
  }
}

/**
 * Get the Thirdweb in-app wallet auth token (JWT).
 * This is the canonical way to authenticate Thirdweb social/email wallets
 * on a backend, because the wallet address is decoupled from the signer.
 * @returns {Promise<string|null>}
 */
export async function getThirdwebAuthToken() {
  if (!eoaWallet) {
    error("[THIRDWEB] cannot get auth token - wallet not connected");
    return null;
  }
  try {
    const token = await eoaWallet.getAuthToken();
    if (!token) {
      error("[THIRDWEB] getAuthToken returned empty");
      return null;
    }
    log("[THIRDWEB] auth token retrieved");
    return token;
  } catch (err) {
    error("[THIRDWEB] getAuthToken failed:", err);
    return null;
  }
}

/**
 * Disconnect and clear Thirdweb state.
 */
export function disconnectThirdwebWallet() {
  try {
    eoaWallet?.disconnect?.();
  } catch {
    // ignore
  }
  try {
    smartWalletInstance?.disconnect?.();
  } catch {
    // ignore
  }
  eoaWallet = null;
  smartWalletInstance = null;
  eoaAccount = null;
  smartAccount = null;
  currentProvider = null;
}
