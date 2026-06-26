// @ts-nocheck
/**
 * Shared collection/asset ID helpers.
 *
 * Pure functions used by Studio save/publish, the Library page, and the
 * create-panel collection selector. Keeping them in one place prevents the
 * duplicated derivations that previously drifted across modules.
 */

/**
 * Derive a deterministic default collection token ID from a wallet address.
 * Uses keccak256(soliditySha3(address)) so the contract can recompute and
 * verify ownership. One wallet = one default collection.
 *
 * @param {string} walletAddr
 * @returns {string|null} hex token id, or null if inputs are missing
 */
export function deriveDefaultCollectionId(walletAddr) {
  if (!walletAddr || !window.Web3?.utils?.soliditySha3) return null;
  return window.Web3.utils.soliditySha3({
    type: "address",
    value: walletAddr,
  });
}

/**
 * Derive a deterministic named collection token ID from wallet + name.
 *
 * @param {string} walletAddr
 * @param {string} name
 * @returns {string|null} hex token id, or null if inputs are missing
 */
export function deriveNamedCollectionId(walletAddr, name) {
  if (!walletAddr || !window.Web3?.utils?.soliditySha3) return null;
  return window.Web3.utils.soliditySha3(
    { type: "address", value: walletAddr },
    { type: "string", value: name }
  );
}

/**
 * Merge an asset CID into a collection manifest's `assets` map.
 * Pure function - does not touch IPFS or chain state.
 *
 * @param {Object|null} collectionManifest
 * @param {string} assetID
 * @param {string} assetCid
 * @returns {Object} new collection manifest object
 */
export function mergeAssetIntoCollection(collectionManifest, assetID, assetCid) {
  const base = collectionManifest
    ? { ...collectionManifest }
    : {
        type: "collection",
        asset_id: `collection_${Date.now()}`,
        version: 0,
        assets: {},
      };
  const assets = { ...(base.assets || {}) };
  assets[assetID] = assetCid;
  return {
    ...base,
    type: "collection",
    assets,
  };
}

/**
 * Derive the assetID an asset occupies within its collection.
 *
 * @param {string|null} existingAssetId
 * @param {string|null} fallbackAssetId
 * @returns {string}
 */
export function deriveDefaultAssetId(existingAssetId, fallbackAssetId) {
  return existingAssetId || fallbackAssetId || `asset_${Date.now()}`;
}

/**
 * 4x4 identity transform matrix.
 * @returns {number[]}
 */
export function identityMatrix() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}
