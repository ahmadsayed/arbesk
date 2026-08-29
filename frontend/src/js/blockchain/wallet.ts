/**
 * Arbesk Wallet - Re-export Barrel
 *
 * All wallet functionality has been split into domain-specific modules.
 * This file re-exports everything for backward compatibility.
 *
 * Modules:
 *   wallet-core.ts      - init, connect, disconnect, autoConnect, auth
 *   wallet-network.ts   - network switching
 *   wallet-payments.ts  - USDC + free-tier generation payments
 *   wallet-publishing.ts - NFT mint, tokenURI update, editor set, burn
 */

// Core (shared state contract + connection lifecycle)
export {
  web3Provider,
  contract,
  initWallet,
  connectWallet,
  disconnectWallet,
  autoConnectWallet,
  authenticateUser,
  getActiveConnectionSource,
  getActiveContract,
  getSigner,
  NETWORKS,
} from "./wallet-core.ts";

// viem read client (per-chain cached)
export { getReadClient } from "./viem-clients.ts";

// Network
export { switchNetwork } from "./wallet-network.ts";

// Payments
export {
  payForGenerationWithUSDC,
  recordGeneration,
  isFreeTierContract,
} from "./wallet-payments.ts";

// Publishing
export {
  publishAsset,
  updateAssetURI,
  updateEditors,
  CollaboratorRole,
  burn,
} from "./wallet-publishing.ts";

// Backward-compat alias
export { contract as walletContract } from "./wallet-core.ts";
