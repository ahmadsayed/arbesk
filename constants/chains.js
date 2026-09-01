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
 * Number of blocks to request per eth_getLogs call.
 *
 * RPCs vary in how wide a range they accept. Hardhat local can handle huge
 * ranges since it's a single node. Base Sepolia handles moderately wide ranges.
 */
export const LOG_CHUNK_SIZES = {
  [CHAIN_IDS.HARDHAT_LOCAL]: 10000,
  // sepolia.base.org rejects eth_getLogs spanning more than 2000 blocks
  // ("query exceeds max block range 2000").
  [CHAIN_IDS.BASE_TESTNET]: 2000,
};

/**
 * Contract address migrations (old → new) for chains that have been
 * redeployed. Existing immutable manifests embed the OLD address in
 * `child_ref.collection.contractAddress`; resolution remaps it to the current
 * address so nested references keep resolving after a redeploy.
 *
 * Keys are lowercased for case-insensitive lookup; values are the current
 * checksummed addresses.
 */
export const CONTRACT_MIGRATIONS = {
  [CHAIN_IDS.BASE_TESTNET]: {
    "0xa39effc859b326ccceb177cfbbef00c1876e18d8":
      "0x2D323Db44D022601885e2e34f0767293d02B704C",
  },
};
