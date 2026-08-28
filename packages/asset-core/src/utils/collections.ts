/**
 * Shared collection/asset ID helpers.
 *
 * Pure functions used by Studio save/publish, the Library page, and the
 * create-panel collection selector. Keeping them in one place prevents the
 * duplicated derivations that previously drifted across modules.
 */

import { getRuntime } from "../runtime.ts";
import type { HashPort } from "../types.ts";

/**
 * The injected HashPort, or null when the runtime is uninitialized / has no
 * hash port (mirrors the historical `window.Web3` guard: callers treat null
 * as "cannot derive right now").
 */
function _hashPort(): HashPort | null {
  try {
    return getRuntime().hash;
  } catch {
    return null;
  }
}

/**
 * Derive a deterministic default collection token ID from a wallet address.
 * Uses keccak256(soliditySha3(address)) so the contract can recompute and
 * verify ownership. One wallet = one default collection.
 *
 * @returns hex token id, or null if inputs are missing
 */
export function deriveDefaultCollectionId(walletAddr: string): string | null {
  const hash = _hashPort();
  if (!walletAddr || !hash) return null;
  return hash.soliditySha3({
    type: "address",
    value: walletAddr,
  });
}

/**
 * Derive a deterministic named collection token ID from wallet + name.
 *
 * @returns hex token id, or null if inputs are missing
 */
export function deriveNamedCollectionId(walletAddr: string, name: string): string | null {
  const hash = _hashPort();
  if (!walletAddr || !hash) return null;
  return hash.soliditySha3(
    { type: "address", value: walletAddr },
    { type: "string", value: name }
  );
}

/**
 * Merge an asset CID into a collection manifest's `assets` map.
 * Pure function - does not touch IPFS or chain state.
 *
 * @returns new collection manifest object
 */
export function mergeAssetIntoCollection(
  collectionManifest: Record<string, any> | null,
  assetID: string,
  assetCid: string
): Record<string, any> {
  const base = collectionManifest
    ? { ...collectionManifest }
    : {
        type: "collection",
        asset_id: `collection_${Date.now()}`,
        version: 0,
        assets: {},
      };
  const assets = { ...((base.assets || {}) as Record<string, string>) };
  assets[assetID] = assetCid;
  return {
    ...base,
    type: "collection",
    assets,
  };
}

/**
 * Derive the assetID an asset occupies within its collection.
 */
export function deriveDefaultAssetId(existingAssetId: string | null, fallbackAssetId: string | null): string {
  return existingAssetId || fallbackAssetId || `asset_${Date.now()}`;
}

/**
 * 4x4 identity transform matrix.
 */
export function identityMatrix(): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/**
 * Build the canonical v1 collection manifest literal. The ONE place this
 * shape is constructed — Studio (library-ops) and the besk CLI both call it.
 */
export function buildCollectionManifest(name: string): Record<string, any> {
  return {
    type: "collection",
    name,
    asset_id: `collection_${Date.now()}`,
    version: 1,
    timestamp: Date.now(),
    assets: {},
    prev_asset_manifest_cid: null,
  };
}

/**
 * Apply a mutation to a collection manifest following the immutable-chain
 * convention: the mutation runs on a shallow copy, `version` is bumped, and
 * `prev_asset_manifest_cid` links back to the manifest this one replaces.
 *
 * Mirrors the Studio's updateCollectionManifest (asset-delete.ts) exactly —
 * every collection write (Studio or CLI) MUST go through this so the chain
 * stays walkable.
 *
 * @returns the new manifest (input is not mutated)
 */
export function applyCollectionMutation(
  collection: Record<string, any>,
  currentCid: string,
  mutate: (draft: Record<string, any>) => void
): Record<string, any> {
  const next: Record<string, any> = { ...collection, assets: { ...(collection.assets ?? {}) } };
  mutate(next);
  next.version = (next.version || 0) + 1;
  next.prev_asset_manifest_cid = currentCid;
  return next;
}
