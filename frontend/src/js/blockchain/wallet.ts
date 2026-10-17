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
  getActiveContract,
  getSigner,
} from "./wallet-core.ts";

// viem read client (per-chain cached)
export { getReadClient } from "./viem-clients.ts";

// Network
export { switchNetwork } from "./wallet-network.ts";

// Publishing
export {
  publishAsset,
  updateAssetURI,
  updateEditors,
  CollaboratorRole,
  burn,
} from "./wallet-publishing.ts";
