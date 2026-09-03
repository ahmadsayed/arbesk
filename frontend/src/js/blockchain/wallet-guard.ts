/**
 * Wallet-readiness guard for services that require a connected wallet.
 * @remarks Consolidates the scattered wallet-readiness checks into one place.
 */

import { walletState } from "../state/wallet-state.ts";

/**
 * Asserts the wallet is connected and returns the contract and wallet address.
 * @throws when the wallet is not connected or the contract is not initialized.
 */
export function requireWallet(): { contract: any; walletAddress: string } {
  const { contract, walletAddress } = walletState.get();
  if (!contract || !walletAddress) {
    throw new Error("Not signed in");
  }
  return { contract, walletAddress };
}
