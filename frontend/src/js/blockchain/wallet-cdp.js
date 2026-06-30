// @ts-nocheck
/**
 * CDP Email-OTP Wallet + Smart Account integration.
 *
 * Provides an EIP-1193 provider shim so the rest of the app can keep using
 * Web3.js unchanged. An email OTP flow creates an embedded EOA (the signer),
 * which is wrapped in an ERC-4337 smart account (the token owner on-chain).
 * Transactions are sent as sponsored UserOperations via the CDP Paymaster.
 * Smart wallets are supported on Base Sepolia only.
 *
 * Follows the same structural pattern as the removed wallet-thirdweb.js.
 */

import { initialize, signInWithEmail, verifyEmailOTP, getCurrentUser, createEvmSmartAccount, signEvmMessage, sendUserOperation, getUserOperation, signOut } from "@coinbase/cdp-core";
import { log, error, warn } from "../utils/log.js";
import { CHAIN_IDS } from "../../../../constants/chains.js";
import {
  isSmartWalletSupported,
  SMART_WALLET_SUPPORTED_CHAIN_IDS,
} from "./smart-wallet-support.js";

export { isSmartWalletSupported, SMART_WALLET_SUPPORTED_CHAIN_IDS };

// ─── Module-level state ─────────────────────────────────────────────────────

let _cdpInitialized = false;

/** @type {object|null} The embedded EOA account object (user.evmAccountObjects[0]) */
let _currentEoaAccount = null;

/** @type {string|null} Smart account address (user.evmSmartAccountObjects?.[0]?.address) */
let _smartAccountAddress = null;

/** @type {{ request: (args: object) => Promise<unknown> } | null} */
let _provider = null;

// ─── Constants ───────────────────────────────────────────────────────────────

/** Base Sepolia chain ID in hex */
const BASE_SEPOLIA_CHAIN_ID_HEX = "0x" + CHAIN_IDS.BASE_TESTNET.toString(16); // "0x14a34"

/** CDP network name for Base Sepolia */
const CDP_NETWORK_BASE_SEPOLIA = "base-sepolia";

/** Public Base Sepolia RPC endpoint (for read-only passthrough calls) */
const BASE_SEPOLIA_RPC_URL = "https://base-sepolia-rpc.publicnode.com";

// ─── Initialization ──────────────────────────────────────────────────────────

/**
 * Initialize the CDP SDK with a project ID.
 * Must be called once before any other CDP functions.
 * @param {string} projectId - CDP project ID from the Coinbase Developer Platform
 * @returns {Promise<void>}
 */
export async function initCdpClient(projectId) {
  if (_cdpInitialized) {
    log("CDP", "already initialized, skipping");
    return;
  }
  try {
    await initialize({
      projectId,
      ethereum: {
        createOnLogin: "smart", // Creates an EOA + ERC-4337 Smart Account on login
      },
      disableAnalytics: true, // Avoids extra CSP/connectivity overhead
    });
    _cdpInitialized = true;
    log("CDP", "initialized with project ID:", projectId.slice(0, 8) + "…");
  } catch (err) {
    error("CDP", "initialization failed:", err);
    throw err;
  }
}

/**
 * @returns {boolean} true if the CDP SDK has been initialized
 */
export function isCdpInitialized() {
  return _cdpInitialized;
}

// ─── Authentication ──────────────────────────────────────────────────────────

/**
 * Start the email OTP flow. Sends a one-time code to the user's email.
 * @param {string} email
 * @returns {Promise<{ flowId: string }>}
 */
export async function requestEmailOtp(email) {
  if (!_cdpInitialized) {
    throw new Error("CDP not initialized. Call initCdpClient first.");
  }
  try {
    log("CDP", "requesting OTP for email:", email);
    const { flowId } = await signInWithEmail({ email });
    log("CDP", "OTP sent, flowId:", flowId);
    return { flowId };
  } catch (err) {
    error("CDP", "signInWithEmail failed:", err);
    throw err;
  }
}

/**
 * Complete the email OTP flow with the user-provided code.
 * Populates module-level state (_currentEoaAccount, _smartAccountAddress, _provider).
 * @param {string} flowId - from requestEmailOtp
 * @param {string} otp - the code the user entered
 * @returns {Promise<{ eoaAddress: string, smartAccountAddress: string }>}
 */
export async function verifyEmailOtp(flowId, otp) {
  if (!_cdpInitialized) {
    throw new Error("CDP not initialized. Call initCdpClient first.");
  }
  try {
    log("CDP", "verifying OTP…");
    const { user, isNewUser } = await verifyEmailOTP({ flowId, otp });
    log("CDP", isNewUser ? "new user created" : "existing user signed in");

    let eoaAccount = user.evmAccountObjects?.[0];
    let smartAccountAddress = user.evmSmartAccountObjects?.[0]?.address ?? null;

    log("CDP", "post-OTP user keys:", Object.keys(user ?? {}).join(","));
    log("CDP", "post-OTP evmAccountObjects:", JSON.stringify(user?.evmAccountObjects?.map((a) => a?.address)));
    log("CDP", "post-OTP evmAccounts:", JSON.stringify(user?.evmAccounts));
    log("CDP", "post-OTP evmSmartAccountObjects:", JSON.stringify(user?.evmSmartAccountObjects?.map((a) => a?.address)));
    log("CDP", "post-OTP evmSmartAccounts:", JSON.stringify(user?.evmSmartAccounts));

    if (!eoaAccount || !smartAccountAddress) {
      log("CDP", "no EVM accounts after OTP; creating smart account manually");
      try {
        smartAccountAddress = await createEvmSmartAccount();
        log("CDP", "createEvmSmartAccount returned:", smartAccountAddress);
      } catch (createErr) {
        error("CDP", "createEvmSmartAccount failed:", createErr);
        throw createErr;
      }
      const updatedUser = await getCurrentUser();
      log("CDP", "post-create user keys:", Object.keys(updatedUser ?? {}).join(","));
      log("CDP", "post-create evmAccountObjects:", JSON.stringify(updatedUser?.evmAccountObjects?.map((a) => a?.address)));
      log("CDP", "post-create evmAccounts:", JSON.stringify(updatedUser?.evmAccounts));
      log("CDP", "post-create evmSmartAccountObjects:", JSON.stringify(updatedUser?.evmSmartAccountObjects?.map((a) => a?.address)));
      log("CDP", "post-create evmSmartAccounts:", JSON.stringify(updatedUser?.evmSmartAccounts));
      eoaAccount = updatedUser.evmAccountObjects?.[0] ?? eoaAccount;
      smartAccountAddress = updatedUser.evmSmartAccountObjects?.[0]?.address ?? smartAccountAddress;
    }

    if (!eoaAccount) {
      throw new Error("CDP user has no EVM account after OTP verification");
    }

    if (!smartAccountAddress) {
      warn("CDP", "user has no smart account — will use EOA address as wallet address");
    }

    _currentEoaAccount = eoaAccount;
    _smartAccountAddress = smartAccountAddress;
    _provider = buildCdpEip1193Provider(eoaAccount, smartAccountAddress);

    log("CDP", "EOA:", eoaAccount.address);
    log("CDP", "Smart account:", smartAccountAddress);

    return {
      eoaAddress: eoaAccount.address,
      smartAccountAddress: smartAccountAddress ?? eoaAccount.address,
    };
  } catch (err) {
    error("CDP", "verifyEmailOTP failed:", err);
    throw err;
  }
}

// ─── Connection state ────────────────────────────────────────────────────────

/**
 * Attempt to restore a previous CDP session silently.
 * Returns null if no session is available (user must sign in again).
 * @returns {Promise<{ eoaAddress: string, smartAccountAddress: string, provider: object }|null>}
 */
export async function autoConnectCdpWallet() {
  if (!_cdpInitialized) {
    return null;
  }
  try {
    const user = await getCurrentUser();
    if (!user) {
      log("CDP", "autoConnect: no current user");
      return null;
    }

    const eoaAccount = user.evmAccountObjects?.[0];
    if (!eoaAccount) {
      log("CDP", "autoConnect: user has no EVM account — clearing stale session");
      await disconnectCdpWallet();
      return null;
    }

    const smartAccountAddress = user.evmSmartAccountObjects?.[0]?.address ?? null;

    _currentEoaAccount = eoaAccount;
    _smartAccountAddress = smartAccountAddress;
    _provider = buildCdpEip1193Provider(eoaAccount, smartAccountAddress);

    log("CDP", "autoConnect: restored EOA", eoaAccount.address);

    return {
      eoaAddress: eoaAccount.address,
      smartAccountAddress: smartAccountAddress ?? eoaAccount.address,
      provider: _provider,
    };
  } catch (err) {
    // getCurrentUser() throws when no session exists — that's expected, not an error
    log("CDP", "autoConnect: no session available:", err.message);
    _currentEoaAccount = null;
    _smartAccountAddress = null;
    _provider = null;
    return null;
  }
}

/**
 * Sign out and clear all CDP state.
 * @returns {Promise<void>}
 */
export async function disconnectCdpWallet() {
  try {
    await signOut();
    log("CDP", "signed out");
  } catch (err) {
    warn("CDP", "signOut failed (non-fatal):", err.message);
  } finally {
    _currentEoaAccount = null;
    _smartAccountAddress = null;
    _provider = null;
  }
}

/**
 * @returns {boolean} true if a CDP user is currently signed in
 */
export function isCdpConnected() {
  return _currentEoaAccount !== null;
}

// ─── UserOperation Helpers ───────────────────────────────────────────────────

/**
 * Poll CDP until a UserOperation is mined and return its on-chain txHash.
 * Web3.js expects eth_sendTransaction to return an EVM transaction hash, not a
 * UserOperation hash, so we block here until CDP reports the real txHash.
 *
 * @param {string} userOpHash
 * @param {string} smartAccountAddress
 * @returns {Promise<string>}
 */
async function _waitForUserOperationTransaction(userOpHash, smartAccountAddress) {
  const maxAttempts = 60;
  const delayMs = 1000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    try {
      const op = await getUserOperation({
        evmSmartAccount: smartAccountAddress,
        userOperationHash: userOpHash,
        network: CDP_NETWORK_BASE_SEPOLIA,
      });

      log("CDP:EIP1193", `UserOperation status (attempt ${attempt}):`, op.status);

      if (op.status === "complete" && op.transactionHash) {
        return op.transactionHash;
      }

      if (op.status === "failed") {
        const revertMsg = op.receipts?.[0]?.revert?.message || "unknown";
        throw new Error(`UserOperation failed: ${revertMsg}`);
      }
    } catch (err) {
      // On the last attempt, surface the error. Otherwise keep polling.
      if (attempt === maxAttempts) {
        throw new Error(`Timed out waiting for UserOperation ${userOpHash}: ${err.message}`);
      }
    }
  }

  throw new Error(`Timed out waiting for UserOperation ${userOpHash}`);
}

// ─── EIP-1193 Provider Shim ──────────────────────────────────────────────────

/**
 * Decode a hex-encoded UTF-8 string (e.g. "0x68656c6c6f") to its plain-text
 * form. If the string is not 0x-prefixed, return it as-is.
 * Web3.js encodes the SIWE message as a hex string before calling personal_sign.
 * @param {string} hexOrPlain
 * @returns {string}
 */
function hexToUtf8OrKeepHex(hexOrPlain) {
  if (typeof hexOrPlain !== "string" || !hexOrPlain.startsWith("0x")) {
    return hexOrPlain;
  }
  try {
    const hex = hexOrPlain.slice(2);
    const bytes = new Uint8Array(hex.match(/.{1,2}/g).map((b) => parseInt(b, 16)));
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    // If decoding fails, return the original hex (e.g. for raw binary data)
    return hexOrPlain;
  }
}

/**
 * Build an EIP-1193 provider object that wraps the CDP SDK.
 * Existing Web3.js contract code (contract.methods.X().send(), etc.) uses
 * this provider transparently — no changes needed in callers.
 *
 * Routing:
 *  - eth_accounts / eth_requestAccounts → [smartAccountAddress]
 *  - eth_chainId                        → "0x14a34" (Base Sepolia, 84532)
 *  - personal_sign(message, account)    → signEvmMessage(eoaAccount.address, message)
 *  - eth_sign(account, message)         → signEvmMessage(eoaAccount.address, message)
 *  - eth_sendTransaction({ to, value, data }) → sendUserOperation → userOpHash
 *  - all other methods                  → forwarded to Base Sepolia public RPC
 *
 * @param {object} eoaAccount - user.evmAccountObjects[0] from CDP
 * @param {string|null} smartAccountAddress - user.evmSmartAccountObjects[0].address from CDP
 * @returns {{ request: (args: object) => Promise<unknown> }}
 */
export function buildCdpEip1193Provider(eoaAccount, smartAccountAddress) {
  // The on-chain token owner is the smart account; fall back to EOA if absent
  const effectiveAddress = smartAccountAddress ?? eoaAccount.address;

  let _rpcCallId = 1;

  /**
   * Forward a JSON-RPC call to the Base Sepolia public RPC endpoint.
   * @param {string} method
   * @param {unknown[]} params
   * @returns {Promise<unknown>}
   */
  async function forwardToRpc(method, params) {
    const id = _rpcCallId++;
    const body = JSON.stringify({ jsonrpc: "2.0", method, params: params ?? [], id });
    const res = await fetch(BASE_SEPOLIA_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (!res.ok) {
      throw new Error(`RPC HTTP error ${res.status} for method ${method}`);
    }
    const json = await res.json();
    if (json.error) {
      const msg = json.error.message || JSON.stringify(json.error);
      throw new Error(`RPC error for ${method}: ${msg}`);
    }
    return json.result;
  }

  return {
    /**
     * EIP-1193 request method.
     * @param {{ method: string, params?: unknown[] }} args
     * @returns {Promise<unknown>}
     */
    async request({ method, params }) {
      log("CDP:EIP1193", method, params);

      switch (method) {
        // ── Account / network identity ─────────────────────────────
        case "eth_accounts":
        case "eth_requestAccounts":
          return [effectiveAddress];

        case "eth_chainId":
          return BASE_SEPOLIA_CHAIN_ID_HEX;

        case "net_version":
          return String(CHAIN_IDS.BASE_TESTNET);

        // ── Signing ───────────────────────────────────────────────
        case "personal_sign": {
          // Web3.js passes (hexEncodedMessage, address)
          const [rawMessage] = params ?? [];
          const message = hexToUtf8OrKeepHex(rawMessage);
          log("CDP:EIP1193", "personal_sign message (decoded):", message.slice(0, 80));
          const personalSignResult = await signEvmMessage({ evmAccount: eoaAccount.address, message });
          return personalSignResult.signature;
        }

        case "eth_sign": {
          // Legacy eth_sign passes (address, message) — note reversed order
          const [, rawMessage] = params ?? [];
          const message = hexToUtf8OrKeepHex(rawMessage);
          const ethSignResult = await signEvmMessage({ evmAccount: eoaAccount.address, message });
          return ethSignResult.signature;
        }

        // ── Transactions ──────────────────────────────────────────
        case "eth_sendTransaction": {
          const txParams = params?.[0] ?? {};
          const { to, value, data } = txParams;

          if (!to) {
            throw new Error("eth_sendTransaction: missing 'to' field");
          }

          let valueBigInt;
          try {
            valueBigInt = BigInt(value ?? "0x0");
          } catch {
            valueBigInt = 0n;
          }

          log("CDP:EIP1193", "eth_sendTransaction → sendUserOperation", { to, valueBigInt, data });

          const result = await sendUserOperation({
            evmSmartAccount: smartAccountAddress,
            network: CDP_NETWORK_BASE_SEPOLIA,
            calls: [
              {
                to,
                value: valueBigInt,
                data: data ?? "0x",
              },
            ],
            // Use CDP's project-scoped paymaster. For production deployments that
            // need to hide a custom paymaster API key, switch to paymasterUrl
            // pointing at a public HTTPS backend proxy.
            useCdpPaymaster: true,
          });

          const userOpHash = result.userOperationHash;
          log("CDP:EIP1193", "UserOperation submitted, hash:", userOpHash);

          // CDP returns a UserOperation hash, but Web3.js expects an EVM transaction
          // hash so it can poll eth_getTransactionReceipt. Poll CDP until the
          // UserOperation is mined and we have the on-chain txHash, then return it.
          const txHash = await _waitForUserOperationTransaction(userOpHash, smartAccountAddress);
          log("CDP:EIP1193", "UserOperation mined, txHash:", txHash);
          return txHash;
        }

        // ── Everything else → public RPC passthrough ──────────────
        default:
          return forwardToRpc(method, params ?? []);
      }
    },

    // EIP-1193 event emitter shims. CDP smart accounts are fixed to Base Sepolia
    // and a single address, so there are no account/chain changes to broadcast.
    // Wallet-core attaches these listeners unconditionally for EIP-1193 providers.
    on() {},
    removeListener() {},
  };
}

// ─── SIWE Signing Helper ─────────────────────────────────────────────────────

/**
 * Sign a SIWE message using the embedded EOA (not the smart account).
 *
 * SIWE requires the signer to be the EOA that owns the smart account.
 * The backend's siwe-verify.js handles the ERC-6492/EIP-1271 + eoaAddress
 * fallback path so the session is bound to the smart account address.
 *
 * Equivalent to web3.eth.personal.sign(message, eoaAddress, "").
 *
 * @param {string} message - plain-text SIWE message (not hex-encoded)
 * @returns {Promise<string>} hex signature
 */
export async function signSiweMessageWithCdp(message) {
  if (!_currentEoaAccount) {
    throw new Error("CDP wallet not connected. Call verifyEmailOtp or autoConnectCdpWallet first.");
  }
  try {
    log("CDP", "signing SIWE message with EOA:", _currentEoaAccount.address);
    const result = await signEvmMessage({ evmAccount: _currentEoaAccount.address, message });
    log("CDP", "SIWE message signed");
    return result.signature;
  } catch (err) {
    error("CDP", "signSiweMessageWithCdp failed:", err);
    throw err;
  }
}
