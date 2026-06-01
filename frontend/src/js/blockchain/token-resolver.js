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

/** @type {Map<string, {manifestCid: string, timestamp: number}>} */
const resolutionCache = new Map();

const RESOLUTION_CACHE_TTL_MS = 30_000; // 30 seconds

// Well-known RPC endpoints for common chains
const KNOWN_RPC_ENDPOINTS = {
  314159: "http://127.0.0.1:8545", // Filecoin Calibration (local Hardhat)
  314: "https://api.calibration.node.glif.io/rpc/v1", // Filecoin Calibration
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
  let provider = (typeof web3 !== "undefined" && web3) || window.web3 || null;

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
 * Normalize a tokenURI response to a plain CID string.
 * Handles:
 *   - Plain CID: "QmABC123..."
 *   - ipfs:// URI: "ipfs://QmABC123..."
 *   - ipfs:// with path: "ipfs://QmABC123/path/to/manifest.json"
 *   - HTTP gateway URL: "http://127.0.0.1:8080/ipfs/QmABC123..."
 *   - Full URL: "https://ipfs.io/ipfs/QmABC123..."
 *
 * @param {string} uri
 * @returns {string} Plain CID
 */
export function normalizeTokenURI(uri) {
  if (!uri || typeof uri !== "string") return "";

  let normalized = uri.trim();

  // Remove ipfs:// or ipfs/ prefix
  if (normalized.startsWith("ipfs://")) {
    normalized = normalized.slice(7);
  }

  // Remove HTTP gateway prefix
  const ipfsPathMatch = normalized.match(/\/ipfs\/([A-Za-z0-9]{46,})/);
  if (ipfsPathMatch) {
    normalized = ipfsPathMatch[1];
  }

  // Remove any trailing path or query
  const cidMatch = normalized.match(/^([A-Za-z0-9]{46,})/);
  if (cidMatch) {
    normalized = cidMatch[1];
  }

  return normalized;
}

/**
 * Resolve a child_ref token reference to a manifest CID.
 *
 * Resolution steps:
 *   1. Check in-memory cache
 *   2. Call tokenURI() on the contract
 *   3. Normalize the returned URI to a plain CID
 *   4. Optionally validate that the CID resolves to a valid manifest
 *   5. Cache the result
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

  // Check cache first
  const cachedCid = getCachedResolution(childRef);
  if (cachedCid) {
    console.log(
      `[TOKEN] cache hit for token #${childRef.tokenId} → ${cachedCid}`
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
    `[TOKEN] resolving child_ref token #${childRef.tokenId} at ${childRef.contractAddress} chain ${childRef.chainId}`
  );

  // Get contract instance
  const tokenContract = getTokenContract(
    childRef.chainId,
    childRef.contractAddress
  );
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

  console.log(`[TOKEN] resolved token #${childRef.tokenId} → ${manifestCid}`);

  // Cache the result
  setCachedResolution(childRef, manifestCid);

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
