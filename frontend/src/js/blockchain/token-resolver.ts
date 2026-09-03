/**
 * Resolves on-chain token references (child_ref) to manifest CIDs, for the
 * local ArbeskAsset contract and external ERC-721 contracts.
 */

import { getFromRemoteIPFS } from "../ipfs/remote-ipfs.ts";
import { normalizeTokenURI } from "./uri-utils.ts";
import { walletState } from "../state/wallet-state.ts";
import { getReadClient } from "./viem-clients.ts";

/**
 * Prefers the current deployment and falls back to the manifest's embedded
 * address only when the token isn't on the current contract.
 * @remarks Survives a contract redeploy without a static old→new map: a
 *   migrated token lives on the current contract, while an unmigrated legacy
 *   token resolves via its manifest's embedded address.
 */
async function resolveContractForToken(
  chainId: number | null,
  currentAddress: string | null,
  embeddedAddress: string | null,
  tokenId: string
): Promise<string | null> {
  if (!embeddedAddress) return currentAddress;
  if (!currentAddress) return embeddedAddress;
  if (currentAddress.toLowerCase() === embeddedAddress.toLowerCase()) {
    return currentAddress;
  }
  // Token may have migrated to the current contract — check there first.
  try {
    await readTokenURI(chainId, currentAddress, tokenId);
    return currentAddress;
  } catch {
    return embeddedAddress;
  }
}

const resolutionCache = new Map<string, { manifestCid: string; timestamp: number }>();

const RESOLUTION_CACHE_TTL_MS = 30_000; // 30 seconds

export interface ChildRef {
  type: "token";
  chainId: number;
  contractAddress: string;
  tokenId: string;
  standard: "ERC721";
  resolution: "latest";
}

export interface ResolutionResult {
  /** Resolved IPFS CID */
  manifestCid: string | null;
  /** The parsed manifest (null if fetch fails) */
  manifest: any;
  /** Whether resolution succeeded */
  resolved: boolean;
  /** Error message if resolution failed */
  error: string | null;
  /** Whether the result came from cache */
  fromCache: boolean;
  /** Token ref for nested collections */
  nestedCollectionRef?: any;
}

function _resolveError(message: string): ResolutionResult {
  return {
    manifestCid: null,
    manifest: null,
    resolved: false,
    error: message,
    fromCache: false,
  };
}

/** Subset of a child_ref needed to build a cache key. */
interface CacheKeyRef {
  chainId: any;
  contractAddress: string;
  tokenId: any;
}

/**
 * Build a deterministic cache key for a child reference.
 */
function buildCacheKey(childRef: CacheKeyRef) {
  return `${childRef.chainId}:${childRef.contractAddress.toLowerCase()}:${
    childRef.tokenId
  }`;
}

/**
 * Get a cached resolution if still valid.
 */
function getCachedResolution(childRef: CacheKeyRef) {
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
function setCachedResolution(childRef: CacheKeyRef, manifestCid: string) {
  const key = buildCacheKey(childRef);
  resolutionCache.set(key, {
    manifestCid,
    timestamp: Date.now(),
  });
}

/** Drops a cached resolution so the next read re-resolves on-chain. */
export function invalidateResolution(
  chainId: number,
  contractAddress: string,
  tokenId: string
): void {
  const key = buildCacheKey({ chainId, contractAddress, tokenId });
  resolutionCache.delete(key);
}

/** Test-only seam: writes a cache entry directly (jest reaches the internal map). */
export function _setCachedForTest(
  chainId: number,
  contractAddress: string,
  tokenId: string,
  cid: string
): void {
  setCachedResolution({ chainId, contractAddress, tokenId }, cid);
}

/** Test-only seam: reads the cached CID directly (jest reaches the internal map). */
export function _getCachedForTest(
  chainId: number,
  contractAddress: string,
  tokenId: string
): string | null {
  return getCachedResolution({ chainId, contractAddress, tokenId });
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
] as const;

/**
 * Reads a token's tokenURI from an ERC-721 contract via a per-chain cached
 * viem public client.
 */
async function readTokenURI(
  chainId: number | null,
  contractAddress: string,
  tokenId: string
): Promise<string> {
  return (await getReadClient(chainId ?? undefined).readContract({
    address: contractAddress as `0x${string}`,
    abi: minERC721ABI,
    functionName: "tokenURI",
    args: [BigInt(tokenId)],
  })) as string;
}

// Re-export normalizeTokenURI for backward compatibility - prefer importing
// directly from "./uri-utils.ts" in new code.
export { normalizeTokenURI } from "./uri-utils.ts";

/**
 * Resolves a child_ref token reference to a manifest CID.
 * @remarks options.validate controls whether to fetch and validate the manifest.
 */
export async function resolveChildRef(
  childRef: ChildRef,
  options: { validate?: boolean } = {}
): Promise<ResolutionResult> {
  if (!childRef || childRef.type !== "token") {
    return _resolveError("Invalid child_ref: must have type 'token'");
  }

  if (!childRef.tokenId) {
    return _resolveError("Invalid child_ref: missing tokenId");
  }

  // Fall back to connected wallet's chain/contract when not provided.
  const { chainId: walletChainId, contractAddress: walletContractAddress } =
    walletState.get();
  const chainId = Number(childRef.chainId || walletChainId) || null;
  const contractAddress = await resolveContractForToken(
    chainId,
    walletContractAddress || null,
    childRef.contractAddress || null,
    childRef.tokenId
  );

  // Check cache using resolved values
  const resolvedRef = { ...childRef, chainId, contractAddress } as any;
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

  if (!contractAddress) {
    const err = `No contract address to resolve token #${childRef.tokenId}`;
    console.error(`[TOKEN] ${err}`);
    return _resolveError(err);
  }

  // Call tokenURI
  let rawURI;
  try {
    rawURI = await readTokenURI(chainId, contractAddress, childRef.tokenId);
  } catch (err) {
    const errMsg = `tokenURI call failed for token #${childRef.tokenId}: ${(err as Error).message}`;
    console.error(`[TOKEN] ${errMsg}`);
    return _resolveError(errMsg);
  }

  if (!rawURI) {
    const err = `Token #${childRef.tokenId} has no tokenURI`;
    console.warn(`[TOKEN] ${err}`);
    return _resolveError(err);
  }

  // Normalize the URI to a plain CID
  const manifestCid = normalizeTokenURI(rawURI);
  if (!manifestCid) {
    const err = `Could not extract CID from tokenURI: "${rawURI}"`;
    console.warn(`[TOKEN] ${err}`);
    return _resolveError(err);
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

/** Result of looking up an assetID inside a collection's `assets` map. */
export type AssetIdLookup =
  | { kind: "missing"; value: null }
  | { kind: "cid"; value: string }
  | { kind: "collection"; value: Record<string, any> };

/**
 * Looks up an assetID inside a collection's `assets` map.
 * @param assetsMap - the collection manifest's `assets` field.
 */
export function resolveAssetIdFromCollection(
  assetsMap: Record<string, any> | null,
  assetID: string
): AssetIdLookup {
  if (!assetsMap || typeof assetsMap !== "object") {
    return { kind: "missing", value: null };
  }
  const entry = assetsMap[assetID];
  if (entry === undefined || entry === null) {
    return { kind: "missing", value: null };
  }
  if (typeof entry === "string") {
    return { kind: "cid", value: entry };
  }
  if (
    typeof entry === "object" &&
    entry.tokenId !== undefined &&
    entry.contractAddress
  ) {
    return { kind: "collection", value: entry };
  }
  return { kind: "missing", value: null };
}

/** Generalized collection child reference: `{ collection, assetID }`. */
export interface CollectionChildRef {
  /** "self" or `{chainId, contractAddress, tokenId}` */
  collection: "self" | any;
  assetID: string;
}

/**
 * Resolves a generalized collection child reference.
 * @remarks `collection` is either `"self"` (resolve against the loaded
 *   collection's assets map) or `{chainId, contractAddress, tokenId}`
 *   (resolve that token's collection manifest first, then look up assetID).
 * @param activeCollectionAssets - assets map of the collection currently
 *   being loaded; required when `collection` is `"self"`.
 */
export async function resolveCollectionChildRef(
  childRef: CollectionChildRef,
  activeCollectionAssets: Record<string, any> | null
): Promise<ResolutionResult> {
  if (!childRef || !childRef.assetID) {
    return _resolveError("Invalid collection child_ref: missing assetID");
  }

  let assetsMap = activeCollectionAssets;

  if (childRef.collection && childRef.collection !== "self") {
    const collectionResolution = await resolveChildRef(
      {
        type: "token",
        chainId: childRef.collection.chainId,
        contractAddress: childRef.collection.contractAddress,
        tokenId: childRef.collection.tokenId,
        standard: "ERC721",
        resolution: "latest",
      },
      { validate: true }
    );
    if (!collectionResolution.resolved || !collectionResolution.manifest) {
      return _resolveError(
        `Could not resolve cross-collection reference: ${collectionResolution.error}`
      );
    }
    assetsMap = collectionResolution.manifest.assets;
  }

  const lookup = resolveAssetIdFromCollection(assetsMap, childRef.assetID);
  if (lookup.kind === "missing") {
    return _resolveError(
      `assetID "${childRef.assetID}" not found in collection`
    );
  }
  if (lookup.kind === "collection") {
    // Nested collection: caller is responsible for recursing - surface the
    // token ref so scene-graph.js can treat it as a nested collection load.
    return {
      manifestCid: null,
      manifest: null,
      resolved: true,
      nestedCollectionRef: lookup.value,
      error: null,
      fromCache: false,
    };
  }

  const manifest = await fetchManifestSafe(lookup.value);
  return {
    manifestCid: lookup.value,
    manifest,
    resolved: true,
    error: null,
    fromCache: false,
  };
}

/**
 * Safely fetch a manifest from IPFS, returning null on failure.
 */
async function fetchManifestSafe(cid: string) {
  try {
    return await getFromRemoteIPFS(cid);
  } catch (err) {
    console.warn(`[TOKEN] manifest validation failed for ${cid}:`, (err as Error).message);
    return null;
  }
}

/**
 * Clear the resolution cache.
 */
export function clearResolutionCache() {
  resolutionCache.clear();
}
