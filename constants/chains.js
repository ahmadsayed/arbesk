/**
 * Chain ID constants (shared between frontend and backend)
 *
 * Centralizes EVM chain identifiers so the codebase does not rely on
 * scattered magic numbers. Update this file when adding a new chain.
 */

export const CHAIN_IDS = {
  HARDHAT_LOCAL: 31415822,
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
  [CHAIN_IDS.BASE_TESTNET]: 46254847,
};

/**
 * Number of blocks to request per eth_getLogs call — the initial chunk and
 * the growth ceiling for the indexer's adaptive chunking (token-indexer.ts
 * self-adjusts downward when the RPC rejects a range).
 *
 * RPCs vary in how wide a range they accept. Hardhat local can handle huge
 * ranges since it's a single node. Base Sepolia's public endpoint tightens
 * its unpublished cap under load: seen at 2000, then 1000 (2026-10-01),
 * then 500 (2026-10-05). 1000 stays the ceiling so the indexer can grow
 * back if the provider relaxes; the adaptive path handles the rejections.
 */
export const LOG_CHUNK_SIZES = {
  [CHAIN_IDS.HARDHAT_LOCAL]: 10000,
  [CHAIN_IDS.BASE_TESTNET]: 1000,
};
