// @ts-nocheck
/**
 * Wallet readiness guard - shared by services that require a connected wallet.
 *
 * Consolidates scattered "Wallet not connected" / "Wallet or contract not ready"
 * checks from team.js, asset-delete.js, and other service layers.
 */

import { walletState } from "../state/wallet-state.js";

/**
 * Assert the wallet is connected and return web3 + contract + address.
 * Throws with a consistent error message if the wallet is not ready.
 *
 * @returns {{ web3: object, contract: object, walletAddress: string }}
 * @throws {Error} if wallet is not connected or contract is not initialized
 */
export function requireWallet() {
  const { contract, walletAddress } = walletState.get();
  if (!contract || !walletAddress) {
    throw new Error("Not signed in");
  }
  return { contract, walletAddress };
}
