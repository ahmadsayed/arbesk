/**
 * Re-export barrel for the wallet domain.
 * @remarks All wallet functionality lives in domain-specific modules; this
 *   file re-exports them for backward compatibility.
 */

// Core (shared state contract + connection lifecycle)
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
} from "./wallet-core.ts";

// Shared live provider + network definitions (leaf module)
export { web3Provider, NETWORKS } from "./wallet-provider.ts";

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
