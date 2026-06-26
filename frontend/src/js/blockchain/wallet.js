/**
 * Arbesk Wallet — Re-export Barrel
 *
 * All wallet functionality has been split into domain-specific modules.
 * This file re-exports everything for backward compatibility.
 *
 * Modules:
 *   wallet-core.js      — init, connect, disconnect, autoConnect, auth
 *   wallet-network.js   — network switching
 *   wallet-payments.js  — USDC + free-tier generation payments
 *   wallet-publishing.js — NFT mint, tokenURI update, editor set, burn
 */

// Core (shared state web3/contract + connection lifecycle)
export {
  web3,
  web3Provider,
  contract,
  initWallet,
  connectWallet,
  disconnectWallet,
  autoConnectWallet,
  authenticateUser,
  walletWeb3,
  NETWORKS,
} from "./wallet-core.js";

// Network
export { switchNetwork } from "./wallet-network.js";

// Payments
export {
  payForGenerationWithUSDC,
  recordGeneration,
  isFreeTierContract,
} from "./wallet-payments.js";

// Publishing
export {
  publishAsset,
  updateAssetURI,
  updateEditors,
  CollaboratorRole,
  burn,
} from "./wallet-publishing.js";

// Backward-compat alias
export { contract as walletContract } from "./wallet-core.js";
