/**
 * CDP Email-OTP Wallet + Smart Account integration.
 *
 * An email OTP flow creates an embedded EOA (the signer),
 * which is wrapped in an ERC-4337 smart account (the token owner on-chain).
 * Transactions are sent as sponsored UserOperations via the CDP Paymaster.
 * Smart wallets are supported on Base Sepolia only.
 */

import { initialize, signInWithEmail, verifyEmailOTP, getCurrentUser, createEvmSmartAccount, signEvmMessage, sendUserOperation, getUserOperation, signOut, createDelegation } from "@coinbase/cdp-core";
import { log, error, warn } from "../utils/log.ts";
import { CHAIN_IDS } from "../../../../constants/chains.js";
import type { Signer } from "@arbesk/wallet/types.js";

// ─── Module-level state ─────────────────────────────────────────────────────

let _cdpInitialized = false;

/** The embedded EOA account object (user.evmAccountObjects[0]) */
let _currentEoaAccount: any = null;

/** Smart account address (user.evmSmartAccountObjects?.[0]?.address) */
let _smartAccountAddress: string | null = null;

/** Native Signer built from the current session (the de-shim target). */
let _signer: Signer | null = null;

// ─── Constants ───────────────────────────────────────────────────────────────

/** CDP network name for Base Sepolia */
const CDP_NETWORK_BASE_SEPOLIA = "base-sepolia";

/** localStorage key holding the verified CDP email, for header display across reloads */
const CDP_EMAIL_KEY = "arbesk-cdp-email";

// ─── Verified email persistence ─────────────────────────────────────────────

/**
 * @returns the verified CDP email stored from a previous session
 */
export function getCdpEmail(): string | null {
  return localStorage.getItem(CDP_EMAIL_KEY);
}

export function setCdpEmail(email: string) {
  localStorage.setItem(CDP_EMAIL_KEY, email);
}

export function clearCdpEmail() {
  localStorage.removeItem(CDP_EMAIL_KEY);
}

// ─── Initialization ──────────────────────────────────────────────────────────

/**
 * Initialize the CDP SDK with a project ID.
 * Must be called once before any other CDP functions.
 * @param projectId - CDP project ID from the Coinbase Developer Platform
 */
export async function initCdpClient(projectId: string): Promise<void> {
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
 * Fire-and-forget CDP warmup: fetch backend config and initialize the SDK.
 * Memoized so app-init can kick it off at page load (overlapping the ~800ms
 * CDP token-refresh round trip with UI setup) and autoConnectWallet can await
 * the same in-flight promise instead of re-running the chain serially.
 * @returns true when the SDK ended up initialized
 */
let _warmupPromise: Promise<boolean> | null = null;
export function warmupCdpClient(): Promise<boolean> {
  if (!_warmupPromise) {
    _warmupPromise = (async () => {
      try {
        const { getConfig } = await import("../services/api.ts");
        const config = await getConfig();
        if (!config?.cdpProjectId) return false;
        await initCdpClient(config.cdpProjectId);
        return true;
      } catch (err) {
        warn("CDP", "warmup failed:", (err as Error).message);
        return false;
      }
    })();
  }
  return _warmupPromise;
}

/**
 * Wipe CDP/Coinbase browser state (localStorage keys, IndexedDB databases)
 * and sign out. Stale state from a previous session causes "User is already
 * authenticated" or "EVM account not found" errors on the next login.
 * Best-effort — failures are swallowed since this is a pre-login cleanup.
 */
export async function resetCdpStorage(): Promise<void> {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.toLowerCase().startsWith("cdp") || key.toLowerCase().startsWith("coinbase")) {
        localStorage.removeItem(key);
      }
    }
    // Also clear the app-level CDP email key so a stale header/display value
    // does not survive into the next login attempt.
    clearCdpEmail();
    if (window.indexedDB) {
      const dbs = await window.indexedDB.databases?.();
      for (const db of dbs ?? []) {
        if (db.name?.toLowerCase().includes("cdp") || db.name?.toLowerCase().includes("coinbase")) {
          window.indexedDB.deleteDatabase(db.name);
        }
      }
    }
    await disconnectCdpWallet();
  } catch {
    // Best-effort cleanup; ignore failures here.
  }
}

/**
 * Set (or clear, when `eoaAccount` is null) the module-level CDP session
 * state and rebuild the EIP-1193 provider from it.
 */
function _applyCdpSession(
  eoaAccount: any,
  smartAccountAddress: string | null
): void {
  _currentEoaAccount = eoaAccount;
  _smartAccountAddress = smartAccountAddress;
  _signer = eoaAccount ? createCdpSigner(eoaAccount, smartAccountAddress) : null;
}

/** The native CDP Signer for the current session, or null when signed out. */
export function getCdpSigner(): Signer | null {
  return _signer;
}

/**
 * Grant the one-time delegation so the backend can relay writes for this
 * embedded wallet without the browser being present. Best-effort.
 */
export async function grantDelegation(days = 30): Promise<void> {
  if (!_cdpInitialized) {
    warn("CDP", "grantDelegation skipped — client not initialized");
    return;
  }
  try {
    const expiresAt = new Date(
      Date.now() + days * 24 * 60 * 60 * 1000,
    ).toISOString();
    await createDelegation({ expiresAt });
    log("CDP", "delegation granted until", expiresAt);
  } catch (err) {
    warn("CDP", "delegation grant failed (non-fatal):", (err as Error).message);
  }
}

// ─── Authentication ──────────────────────────────────────────────────────────

/**
 * Start the email OTP flow. Sends a one-time code to the user's email.
 */
export async function requestEmailOtp(email: string): Promise<{ flowId: string }> {
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
 * Populates module-level state (_currentEoaAccount, _smartAccountAddress, _signer).
 * @param flowId - from requestEmailOtp
 * @param otp - the code the user entered
 */
export async function verifyEmailOtp(
  flowId: string,
  otp: string
): Promise<{ eoaAddress: string; smartAccountAddress: string }> {
  if (!_cdpInitialized) {
    throw new Error("CDP not initialized. Call initCdpClient first.");
  }
  try {
    log("CDP", "verifying OTP…");
    const { user, isNewUser } = await verifyEmailOTP({ flowId, otp });
    log("CDP", isNewUser ? "new user created" : "existing user signed in");

    let eoaAccount = user.evmAccountObjects?.[0];
    let smartAccountAddress = user.evmSmartAccountObjects?.[0]?.address ?? null;

    log("CDP", "post-OTP accounts:", { eoa: eoaAccount?.address, smartAccount: smartAccountAddress });

    if (!eoaAccount || !smartAccountAddress) {
      log("CDP", "no EVM accounts after OTP; creating smart account manually");
      try {
        smartAccountAddress = await createEvmSmartAccount();
        log("CDP", "createEvmSmartAccount returned:", smartAccountAddress);
      } catch (createErr) {
        error("CDP", "createEvmSmartAccount failed:", createErr);
        throw createErr;
      }
      const updatedUser = (await getCurrentUser()) as any;
      log("CDP", "post-create accounts:", {
        eoa: updatedUser?.evmAccountObjects?.[0]?.address,
        smartAccount: updatedUser?.evmSmartAccountObjects?.[0]?.address,
      });
      eoaAccount = updatedUser.evmAccountObjects?.[0] ?? eoaAccount;
      smartAccountAddress = updatedUser.evmSmartAccountObjects?.[0]?.address ?? smartAccountAddress;
    }

    if (!eoaAccount) {
      throw new Error("CDP user has no EVM account after OTP verification");
    }

    if (!smartAccountAddress) {
      warn("CDP", "user has no smart account — will use EOA address as wallet address");
    }

    _applyCdpSession(eoaAccount, smartAccountAddress);

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
 */
export async function autoConnectCdpWallet(): Promise<{
  eoaAddress: string;
  smartAccountAddress: string;
  email: string | null;
} | null> {
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

    _applyCdpSession(eoaAccount, smartAccountAddress);

    log("CDP", "autoConnect: restored EOA", eoaAccount.address);

    return {
      eoaAddress: eoaAccount.address,
      smartAccountAddress: smartAccountAddress ?? eoaAccount.address,
      email: (user as any).email || null,
    };
  } catch (err) {
    // getCurrentUser() throws when no session exists — that's expected, not an error
    log("CDP", "autoConnect: no session available:", (err as Error).message);
    _applyCdpSession(null, null);
    return null;
  }
}

/**
 * Sign out and clear all CDP state.
 */
export async function disconnectCdpWallet(): Promise<void> {
  try {
    await signOut();
    log("CDP", "signed out");
  } catch (err) {
    warn("CDP", "signOut failed (non-fatal):", (err as Error).message);
  } finally {
    _applyCdpSession(null, null);
  }
}

// ─── UserOperation Helpers ───────────────────────────────────────────────────

/**
 * Poll CDP until a UserOperation is mined and return its on-chain txHash.
 * Web3.js expects eth_sendTransaction to return an EVM transaction hash, not a
 * UserOperation hash, so we block here until CDP reports the real txHash.
 */
async function _waitForUserOperationTransaction(
  userOpHash: string,
  smartAccountAddress: any
): Promise<string> {
  const maxAttempts = 60;
  const delayMs = 1000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    let op: any;
    try {
      op = await getUserOperation({
        evmSmartAccount: smartAccountAddress as any,
        userOperationHash: userOpHash as any,
        network: CDP_NETWORK_BASE_SEPOLIA,
      });
    } catch (err) {
      // Transient fetch error — retry, unless this was the last attempt.
      if (attempt === maxAttempts) {
        throw new Error(`Timed out waiting for UserOperation ${userOpHash}: ${(err as Error).message}`);
      }
      continue;
    }

    log("CDP:EIP1193", `UserOperation status (attempt ${attempt}):`, op.status);

    // transactionHash is set as soon as the op is broadcast and included in
    // a block — this can happen before CDP's status string reaches
    // "complete", so check it directly instead of waiting on status.
    if (op.transactionHash) {
      return op.transactionHash;
    }

    // "failed"/"dropped" are terminal — surface them immediately rather than
    // retrying for the full polling window.
    if (op.status === "failed" || op.status === "dropped") {
      const revertMsg = op.receipts?.[0]?.revert?.message || op.status;
      throw new Error(`UserOperation ${op.status}: ${revertMsg}`);
    }
  }

  throw new Error(`Timed out waiting for UserOperation ${userOpHash}`);
}

// ─── Native Signer (the de-shim target) ─────────────────────────────────────

/**
 * Build a native `Signer` over the CDP SDK — no EIP-1193 shim. The on-chain
 * owner is the smart account (or the EOA when none); the signer is the
 * embedded EOA. `sendTransaction` resolves on broadcast (UserOperation hash)
 * and `wait()` blocks until the op is mined, returning the real tx hash.
 */
export function createCdpSigner(
  eoaAccount: any,
  smartAccountAddress: string | null
): Signer {
  const effectiveAddress = smartAccountAddress ?? eoaAccount.address;

  return {
    source: "cdp",
    getAddress: () => effectiveAddress,
    getSignerAddress: () => eoaAccount.address,
    getChainId: async () => CHAIN_IDS.BASE_TESTNET,
    signMessage: async (message: string) => {
      const result = await signEvmMessage({
        evmAccount: eoaAccount.address,
        message,
      });
      return result.signature;
    },
    sendTransaction: async (tx) => {
      let valueBigInt: bigint;
      try {
        valueBigInt = BigInt(tx.value ?? 0n);
      } catch {
        valueBigInt = 0n;
      }

      const result = await sendUserOperation({
        evmSmartAccount: smartAccountAddress as any,
        network: CDP_NETWORK_BASE_SEPOLIA,
        calls: [
          {
            to: tx.to as any,
            value: valueBigInt,
            data: (tx.data ?? "0x") as any,
          },
        ],
        // Use CDP's project-scoped paymaster. For production deployments that
        // need to hide a custom paymaster API key, switch to paymasterUrl
        // pointing at a public HTTPS backend proxy.
        useCdpPaymaster: true,
      });

      const userOpHash = result.userOperationHash;
      log("CDP", "UserOperation submitted, hash:", userOpHash);

      return {
        hash: userOpHash,
        wait: async () => {
          const transactionHash = await _waitForUserOperationTransaction(
            userOpHash,
            smartAccountAddress
          );
          return { transactionHash, status: true };
        },
      };
    },
  };
}
