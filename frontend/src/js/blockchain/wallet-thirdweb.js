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

import { createThirdwebClient, prepareTransaction } from "thirdweb";
import { inAppWallet } from "thirdweb/wallets/in-app";
import { smartWallet } from "thirdweb/wallets";
import { defineChain } from "thirdweb/chains";
import { sendTransaction } from "thirdweb/transaction";
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

/** @type {Set<{ event: string, handler: Function }>} */
const listeners = new Set();

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
 * Wrap an EOA account in a sponsored smart account and build the EIP-1193 adapter.
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
  const provider = createEip1193Adapter(smartAccount, resolvedEoaAccount, chain);
  return {
    eoaAddress: resolvedEoaAccount.address,
    smartAccountAddress: smartAccount.address,
    provider,
  };
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
  listeners.clear();
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
}

/**
 * Create an EIP-1193 compatible provider from a Thirdweb smart account.
 *
 * @param {import("thirdweb/wallets").Account} account
 * @param {import("thirdweb/wallets").Account} personalAccount
 * @param {import("thirdweb/chains").Chain} chain
 * @returns {import("thirdweb/wallets").EIP1193Provider}
 */
function createEip1193Adapter(account, personalAccount, chain) {
  const smartAccountAddress = account.address;
  const personalAddress = personalAccount.address;

  return {
    request: async ({ method, params = [] }) => {
      switch (method) {
        case "eth_accounts":
        case "eth_requestAccounts":
          return [smartAccountAddress];

        case "eth_chainId":
          return `0x${chain.id.toString(16)}`;

        case "eth_sendTransaction": {
          const tx = Array.isArray(params) ? params[0] : params;
          const transaction = prepareTransaction({
            to: tx.to,
            data: tx.data,
            value: tx.value ? BigInt(tx.value) : undefined,
            chain,
            client: thirdwebClient,
          });
          const result = await sendTransaction({
            transaction,
            account,
          });
          return result.transactionHash;
        }

        case "personal_sign": {
          const message = Array.isArray(params) ? params[0] : params;
          const from = Array.isArray(params) ? params[1] : undefined;
          // If the caller asks to sign with the personal/EOA address, use the
          // embedded EOA wallet instead of the smart account. This is required
          // for SIWE session creation because Thirdweb smart accounts restrict
          // isValidSignature to approved targets, making ERC-6492 off-chain
          // verification fail.
          if (from && from.toLowerCase() === personalAddress.toLowerCase()) {
            const signature = await personalAccount.signMessage({
              message: normalizeMessage(message),
            });
            return signature;
          }
          const signature = await account.signMessage({
            message: normalizeMessage(message),
          });
          return signature;
        }

        case "eth_signTypedData_v4":
        case "eth_signTypedData": {
          const typedData = Array.isArray(params) ? params[1] : params;
          const signature = await account.signTypedData(
            typeof typedData === "string" ? JSON.parse(typedData) : typedData
          );
          return signature;
        }

        case "wallet_switchEthereumChain":
          // AA flows are pinned to MegaETH Testnet; ignore switch requests.
          return null;

        case "wallet_addEthereumChain":
          return null;

        default:
          // Forward read calls to the chain's public RPC.
          return fetchRpc(chain.rpc, method, params);
      }
    },

    on: (event, handler) => {
      listeners.add({ event, handler });
    },

    removeListener: (event, handler) => {
      for (const entry of listeners) {
        if (entry.event === event && entry.handler === handler) {
          listeners.delete(entry);
          break;
        }
      }
    },

    // Some consumers check for these directly.
    isMetaMask: false,
    isWalletConnect: false,
    isThirdweb: true,
  };
}

/**
 * Normalize a sign-message payload to a string.
 * @param {string | Uint8Array | object} message
 * @returns {string}
 */
function normalizeMessage(message) {
  if (typeof message === "string") return message;
  if (message instanceof Uint8Array) {
    return new TextDecoder().decode(message);
  }
  if (message && typeof message === "object" && "toString" in message) {
    return message.toString();
  }
  return String(message);
}

/**
 * Forward a JSON-RPC request to the chain's public RPC.
 * @param {string} rpcUrl
 * @param {string} method
 * @param {any[]} params
 * @returns {Promise<any>}
 */
async function fetchRpc(rpcUrl, method, params) {
  const id = Math.floor(Math.random() * 1e9);
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const json = await res.json();
  if (json.error) {
    const err = new Error(json.error.message || "RPC error");
    err.code = json.error.code;
    throw err;
  }
  return json.result;
}
