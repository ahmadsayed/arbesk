/**
 * Chain ID constants (shared between frontend and backend)
 *
 * Centralizes EVM chain identifiers so the codebase does not rely on
 * scattered magic numbers. Update this file when adding a new chain.
 */

export const CHAIN_IDS = {
  HARDHAT_LOCAL: 31415822,
  MEGAETH_TESTNET: 6343,
  MONAD_TESTNET: 10143,
  BASE_TESTNET: 84532,
};

/**
 * Set of chain IDs supported by the platform.
 *
 * Both frontend and backend use this list for:
 * - Wallet connection validation
 * - SIWE/session validation
 * - RPC endpoint configuration
 */
export const SUPPORTED_CHAIN_IDS = Object.values(CHAIN_IDS);

/**
 * Block height at which the ArbeskAssetFree contract was deployed on each
 * chain. The asset library uses this as the scan start block for ERC-721
 * Transfer events, avoiding the need to walk from genesis on long-lived
 * public testnets whose RPCs prune or throttle old log queries.
 */
export const DEPLOYMENT_BLOCKS = {
  [CHAIN_IDS.HARDHAT_LOCAL]: 0,
  [CHAIN_IDS.MEGAETH_TESTNET]: 22359678,
  [CHAIN_IDS.MONAD_TESTNET]: 41167242,
  [CHAIN_IDS.BASE_TESTNET]: 43533265,
};

/**
 * Number of blocks to request per eth_getLogs call.
 *
 * RPCs vary in how wide a range they accept. Monad Testnet rejects wide
 * ranges (413), so it stays narrow. MegaETH handles larger ranges, so we
 * use 1000 to speed up initial backfills. Hardhat local can handle huge
 * ranges since it's a single node.
 */
export const LOG_CHUNK_SIZES = {
  [CHAIN_IDS.HARDHAT_LOCAL]: 10000,
  [CHAIN_IDS.MEGAETH_TESTNET]: 5000,
  [CHAIN_IDS.MONAD_TESTNET]: 100,
  [CHAIN_IDS.BASE_TESTNET]: 5000,
};
