/**
 * Arbesk Token Resolver
 *
 * Resolves on-chain token references (child_ref) to manifest CIDs.
 * Supports the local ArbeskAsset contract and external ERC-721 contracts.
 *
 * Resolution path:
 *   1. Look up the token contract by chainId + contractAddress
 *   2. Call tokenURI(tokenId) to get the current manifest CID
 *   3. Fetch the manifest from IPFS
 *   4. Return the manifest CID and metadata
 */

import { getFromRemoteIPFS } from "../ipfs/remote-ipfs.js";
import { normalizeTokenURI } from "./uri-utils.js";
import { web3 as walletWeb3 } from "./wallet.js";

/** @type {Map<string, {manifestCid: string, timestamp: number}>} */
const resolutionCache = new Map();

const RESOLUTION_CACHE_TTL_MS = 30_000; // 30 seconds

// Well-known RPC endpoints for common chains
const KNOWN_RPC_ENDPOINTS = {
  31415822: "http://127.0.0.1:8545", // Hardhat local dev node
  1: "https://eth.llamarpc.com", // Ethereum mainnet (public fallback)
  11155111: "https://ethereum-sepolia.publicnode.com", // Sepolia testnet
};

/**
 * @typedef {Object} ChildRef
 * @property {"token"} type
 * @property {number} chainId
 * @property {string} contractAddress
 * @property {string} tokenId
 * @property {"ERC721"} standard
 * @property {"latest"} resolution
 */

/**
 * @typedef {Object} ResolutionResult
 * @property {string} manifestCid - Resolved IPFS CID
 * @property {Object|null} manifest - The parsed manifest (null if fetch fails)
 * @property {boolean} resolved - Whether resolution succeeded
 * @property {string|null} error - Error message if resolution failed
 * @property {boolean} fromCache - Whether the result came from cache
 */

/**
 * Build a deterministic cache key for a child reference.
 */
function buildCacheKey(childRef) {
  return `${childRef.chainId}:${childRef.contractAddress.toLowerCase()}:${
    childRef.tokenId
  }`;
}

/**
 * Get a cached resolution if still valid.
 */
function getCachedResolution(childRef) {
  const key = buildCacheKey(childRef);
  const cached = resolutionCache.get(key);
  if (cached && Date.now() - cached.timestamp < RESOLUTION_CACHE_TTL_MS) {
    return cached.manifestCid;
  }
  return null;
}

/**
 * Set a resolution in the cache.
 */
function setCachedResolution(childRef, manifestCid) {
  const key = buildCacheKey(childRef);
  resolutionCache.set(key, {
    manifestCid,
    timestamp: Date.now(),
  });
}

// Minimal ERC-721 ABI for tokenURI
const minERC721ABI = [
  {
    inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    name: "tokenURI",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
];

/**
 * Create a Web3 contract instance for a token at a given chain and address.
 * Uses the current provider for the connected chain, or creates a new
 * provider if the target chain is different and has a known RPC endpoint.
 *
 * @param {number} chainId
 * @param {string} contractAddress
 * @returns {Object|null} Web3 contract instance or null
 */
function getTokenContract(chainId, contractAddress) {
  let provider = walletWeb3 || window.web3 || null;

  // If the target chain differs from the connected chain, try an external RPC
  if (provider && chainId) {
    try {
      const connectedChainId = window.chainId;
      if (connectedChainId && Number(chainId) !== Number(connectedChainId)) {
        const rpcUrl = KNOWN_RPC_ENDPOINTS[chainId];
        if (rpcUrl) {
          console.log(
            `[TOKEN] using external RPC for chain ${chainId}: ${rpcUrl}`
          );
          const externalWeb3 = new window.Web3(
            new window.Web3.providers.HttpProvider(rpcUrl)
          );
          return new externalWeb3.eth.Contract(minERC721ABI, contractAddress);
        }
      }
    } catch {
      // Fall through to use connected provider
    }
  }

  if (!provider) return null;

  try {
    return new provider.eth.Contract(minERC721ABI, contractAddress);
  } catch (err) {
    console.warn(`[TOKEN] failed to create contract instance:`, err);
    return null;
  }
}

// Re-export normalizeTokenURI for backward compatibility
export { normalizeTokenURI } from "./uri-utils.js";

/**
 * Resolve a child_ref token reference to a manifest CID.
 *
 * Resolution steps:
 *   1. Fall back to connected wallet's chain/contract when not provided
 *   2. Check in-memory cache using resolved values
 *   3. Call tokenURI() on the contract
 *   4. Normalize the returned URI to a plain CID
 *   5. Optionally validate that the CID resolves to a valid manifest
 *   6. Cache the result
 *
 * @param {ChildRef} childRef
 * @param {Object} [options]
 * @param {boolean} [options.validate=false] - Whether to fetch and validate the manifest
 * @returns {Promise<ResolutionResult>}
 */
export async function resolveChildRef(childRef, options = {}) {
  if (!childRef || childRef.type !== "token") {
    return {
      manifestCid: null,
      manifest: null,
      resolved: false,
      error: "Invalid child_ref: must have type 'token'",
      fromCache: false,
    };
  }

  if (!childRef.tokenId) {
    return {
      manifestCid: null,
      manifest: null,
      resolved: false,
      error: "Invalid child_ref: missing tokenId",
      fromCache: false,
    };
  }

  // Fall back to connected wallet's chain/contract when not provided.
  // Normalize chainId to Number — getChainId() returns BigInt in Web3 v4.
  const chainId = Number(childRef.chainId || window.chainId) || null;
  const contractAddress =
    childRef.contractAddress || window.contractAddress || null;

  // Check cache using resolved values
  const resolvedRef = { ...childRef, chainId, contractAddress };
  const cachedCid = getCachedResolution(resolvedRef);
  if (cachedCid) {
    console.log(
      `[TOKEN] cache hit for token #${childRef.tokenId} -> ${cachedCid}`
    );
    const manifest = options.validate
      ? await fetchManifestSafe(cachedCid)
      : null;
    return {
      manifestCid: cachedCid,
      manifest,
      resolved: true,
      error: null,
      fromCache: true,
    };
  }

  console.log(
    `[TOKEN] resolving child_ref token #${childRef.tokenId} at ${contractAddress} chain ${chainId}`
  );

  // Get contract instance
  const tokenContract = getTokenContract(chainId, contractAddress);
  if (!tokenContract) {
    const err = `No Web3 provider available to resolve token #${childRef.tokenId}`;
    console.error(`[TOKEN] ${err}`);
    return {
      manifestCid: null,
      manifest: null,
      resolved: false,
      error: err,
      fromCache: false,
    };
  }

  // Call tokenURI
  let rawURI;
  try {
    rawURI = await tokenContract.methods.tokenURI(childRef.tokenId).call();
  } catch (err) {
    const errMsg = `tokenURI call failed for token #${childRef.tokenId}: ${err.message}`;
    console.error(`[TOKEN] ${errMsg}`);
    return {
      manifestCid: null,
      manifest: null,
      resolved: false,
      error: errMsg,
      fromCache: false,
    };
  }

  if (!rawURI) {
    const err = `Token #${childRef.tokenId} has no tokenURI`;
    console.warn(`[TOKEN] ${err}`);
    return {
      manifestCid: null,
      manifest: null,
      resolved: false,
      error: err,
      fromCache: false,
    };
  }

  // Normalize the URI to a plain CID
  const manifestCid = normalizeTokenURI(rawURI);
  if (!manifestCid) {
    const err = `Could not extract CID from tokenURI: "${rawURI}"`;
    console.warn(`[TOKEN] ${err}`);
    return {
      manifestCid: null,
      manifest: null,
      resolved: false,
      error: err,
      fromCache: false,
    };
  }

  console.log(`[TOKEN] resolved token #${childRef.tokenId} -> ${manifestCid}`);

  // Cache the result using resolved values
  setCachedResolution(resolvedRef, manifestCid);

  // Optionally validate
  const manifest = options.validate
    ? await fetchManifestSafe(manifestCid)
    : null;

  return {
    manifestCid,
    manifest,
    resolved: true,
    error: null,
    fromCache: false,
  };
}

/**
 * Safely fetch a manifest from IPFS, returning null on failure.
 */
async function fetchManifestSafe(cid) {
  try {
    return await getFromRemoteIPFS(cid);
  } catch (err) {
    console.warn(`[TOKEN] manifest validation failed for ${cid}:`, err.message);
    return null;
  }
}

/**
 * Clear the resolution cache.
 */
export function clearResolutionCache() {
  resolutionCache.clear();
}
