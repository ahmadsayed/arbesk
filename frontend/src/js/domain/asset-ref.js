// @ts-check
/**
 * Domain: AssetRef — one asset referencing another (the tree edge).
 * Wraps the persisted `child_ref` manifest shape. IO-free: resolution goes
 * through an injected resolver.
 */

/**
 * @typedef {Object} AssetRefCollection
 * @property {number} chainId
 * @property {string} contractAddress
 * @property {string} tokenId
 */

/**
 * @typedef {Object} AssetRef
 * @property {AssetRefCollection|"self"} collection
 * @property {string|null} assetID
 */

/**
 * Normalize the persisted child_ref shapes (current collection form and the
 * legacy flat token form) into a canonical AssetRef.
 * @param {any} childRef
 * @returns {AssetRef|null}
 */
export function normalizeAssetRef(childRef) {
  if (!childRef || typeof childRef !== "object") return null;
  if (childRef.collection === "self") {
    return { collection: "self", assetID: childRef.assetID ?? null };
  }
  const c =
    childRef.collection && typeof childRef.collection === "object"
      ? childRef.collection
      : childRef.tokenId != null && childRef.chainId != null && childRef.contractAddress
        ? childRef // legacy flat shape: {tokenId, chainId, contractAddress, resolution}
        : null;
  if (!c) return null;
  return {
    collection: {
      chainId: Number(c.chainId),
      contractAddress: String(c.contractAddress || ""),
      tokenId: String(c.tokenId),
    },
    assetID: childRef.assetID ?? null,
  };
}

/**
 * Canonical identity key: chainId:contract:tokenId:assetID (contract
 * lowercased). Self refs key as self:<assetID> — meaningful only within the
 * currently open collection.
 * @param {AssetRef} ref
 * @returns {string}
 */
export function assetRefKey(ref) {
  if (ref.collection === "self") return `self:${ref.assetID ?? ""}`;
  const c = ref.collection;
  return `${c.chainId}:${c.contractAddress.toLowerCase()}:${c.tokenId}:${ref.assetID ?? ""}`;
}

/**
 * @param {AssetRef|null} a
 * @param {AssetRef|null} b
 * @returns {boolean}
 */
export function assetRefsEqual(a, b) {
  if (!a || !b) return a === b;
  return assetRefKey(a) === assetRefKey(b);
}

/**
 * Resolve a ref to the manifest CID it currently points at. The resolver is
 * injected (`resolveCollectionChildRef` from blockchain/token-resolver.js in
 * the app, a fake in tests).
 * @param {AssetRef} ref
 * @param {{resolve: (childRef: any, selfAssets: any) => Promise<any>, selfAssets?: any}} deps
 * @returns {Promise<any>} the resolver's {resolved, manifestCid?, error?} result
 */
export function resolveAssetRef(ref, deps) {
  const childRef =
    ref.collection === "self"
      ? { collection: "self", assetID: ref.assetID }
      : { collection: ref.collection, assetID: ref.assetID };
  return deps.resolve(
    childRef,
    ref.collection === "self" ? deps.selfAssets ?? null : null
  );
}
