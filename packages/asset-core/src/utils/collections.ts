/**
 * Shared collection/asset ID helpers.
 * @remarks Centralized to prevent duplicated derivations drifting across
 *   modules.
 */

import { getRuntime } from "../runtime.ts";
import type { HashPort } from "../types.ts";

/**
 * Returns the injected HashPort, or null when the runtime is uninitialized or
 * has no hash port.
 * @remarks Callers treat null as "cannot derive right now".
 */
function _hashPort(): HashPort | null {
  try {
    return getRuntime().hash;
  } catch {
    return null;
  }
}

/**
 * Derives a deterministic default collection token ID from a wallet address.
 * @remarks Uses keccak256(soliditySha3(address)) so the contract can recompute
 *   and verify ownership; one wallet maps to one default collection.
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
 * Derives a deterministic named collection token ID from wallet + name.
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
 * Merges an asset CID into a collection manifest's `assets` map.
 * @remarks Pure: does not touch IPFS or chain state, returns a new manifest.
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
 * Builds the canonical v1 collection manifest literal.
 * @remarks This is the single place the shape is constructed.
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
 * Applies a mutation to a collection manifest, following the immutable-chain
 * convention (version bumped, prev_asset_manifest_cid links back).
 * @remarks Every collection write MUST go through this so the chain stays
 *   walkable; the input is not mutated.
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
