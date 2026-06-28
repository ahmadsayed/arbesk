// @ts-nocheck
/**
 * Thirdweb In-App Wallet + Smart Account integration.
 *
 * Provides an EIP-1193 provider shim so the rest of the app can keep using
 * Web3.js unchanged. Google OAuth creates an embedded EOA (address X), which
 * is then wrapped in an ERC-4337 smart account (address Y). Transactions are
 * sent as sponsored UserOperations on MegaETH Testnet.
 */

import { createThirdwebClient, prepareTransaction } from "thirdweb";
import { inAppWallet } from "thirdweb/wallets/in-app";
import { smartWallet } from "thirdweb/wallets";
import { defineChain } from "thirdweb/chains";
import { sendTransaction } from "thirdweb/transaction";
import { log, error } from "../utils/log.js";
import { CHAIN_IDS } from "../../../../constants/chains.js";

const MEGAETH_RPC = "https://carrot.megaeth.com/rpc";

const megaethTestnet = defineChain({
  id: CHAIN_IDS.MEGAETH_TESTNET,
  rpc: MEGAETH_RPC,
});

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
 * Connect a Google In-App Wallet and wrap it in a sponsored smart account.
 * @returns {Promise<{ eoaAddress: string, smartAccountAddress: string, provider: Object }>}
 */
export async function connectGoogleWallet() {
  if (!thirdwebClient) {
    throw new Error("Thirdweb client not initialized. Call initThirdwebClient first.");
  }

  // Diagnostic: log any postMessage arriving from thirdweb.com domains
  const _diagHandler = (ev) => {
    if (ev.origin && ev.origin.includes("thirdweb.com")) {
      log("[THIRDWEB-MSG] from:", ev.origin, "data:", JSON.stringify(ev.data));
    }
  };
  window.addEventListener("message", _diagHandler);

  // Diagnostic: log hidden iframes injected by the SDK
  const _observer = new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.tagName === "IFRAME") log("[THIRDWEB-IFRAME] added:", n.src);
      }
    }
  });
  _observer.observe(document.body, { childList: true, subtree: true });

  const _cleanup = () => {
    window.removeEventListener("message", _diagHandler);
    _observer.disconnect();
  };

  try {
    // 1. Connect embedded EOA via Google OAuth.
    log("[THIRDWEB] opening Google OAuth popup");
    eoaWallet = inAppWallet({
      auth: {
        mode: "popup",
        redirectUrl: window.location.origin + window.location.pathname,
      },
    });
    eoaAccount = await eoaWallet.connect({
      client: thirdwebClient,
      chain: megaethTestnet,
      strategy: "google",
    });
    _cleanup();
    log("[THIRDWEB] Google EOA connected:", eoaAccount.address);

    // 2. Wrap the EOA in a sponsored smart account on MegaETH Testnet.
    smartWalletInstance = smartWallet({
      chain: megaethTestnet,
      sponsorGas: true,
    });
    smartAccount = await smartWalletInstance.connect({
      client: thirdwebClient,
      personalAccount: eoaAccount,
    });
    log("[THIRDWEB] smart account connected:", smartAccount.address);

    const provider = createEip1193Adapter(smartAccount, eoaAccount, megaethTestnet);

    return {
      eoaAddress: eoaAccount.address,
      smartAccountAddress: smartAccount.address,
      provider,
    };
  } catch (err) {
    _cleanup();
    error("[THIRDWEB] connectGoogleWallet failed:", err);
    throw err;
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
          const signature = await personalAccount.signMessage({
            message: normalizeMessage(message),
          });
          return signature;
        }

        case "eth_signTypedData_v4":
        case "eth_signTypedData": {
          const typedData = Array.isArray(params) ? params[1] : params;
          const signature = await personalAccount.signTypedData(
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
          // Forward read calls to the public MegaETH RPC.
          return fetchRpc(method, params);
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
 * Forward a JSON-RPC request to the MegaETH RPC.
 * @param {string} method
 * @param {any[]} params
 * @returns {Promise<any>}
 */
async function fetchRpc(method, params) {
  const id = Math.floor(Math.random() * 1e9);
  const res = await fetch(MEGAETH_RPC, {
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
