/**
 * Domain: AssetRef — one asset referencing another (the tree edge).
 * @remarks Wraps the persisted `child_ref` manifest shape; IO-free — resolution
 *   goes through an injected resolver.
 */

export interface AssetRefCollection {
  chainId: number;
  contractAddress: string;
  tokenId: string;
}

export interface AssetRef {
  collection: AssetRefCollection | "self";
  assetID: string | null;
}

/**
 * Normalize the persisted child_ref shapes (current collection form and the
 * legacy flat token form) into a canonical AssetRef.
 */
export function normalizeAssetRef(childRef: any): AssetRef | null {
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
 * Builds the canonical identity key chainId:contract:tokenId:assetID
 * (contract lowercased).
 * @remarks Self refs key as self:<assetID> — meaningful only within the open
 *   collection.
 */
export function assetRefKey(ref: AssetRef): string {
  if (ref.collection === "self") return `self:${ref.assetID ?? ""}`;
  const c = ref.collection;
  return `${c.chainId}:${c.contractAddress.toLowerCase()}:${c.tokenId}:${ref.assetID ?? ""}`;
}

export function assetRefsEqual(a: AssetRef | null, b: AssetRef | null): boolean {
  if (!a || !b) return a === b;
  return assetRefKey(a) === assetRefKey(b);
}

/**
 * Resolves a ref to the manifest CID it currently points at.
 * @remarks The resolver is injected (keeps the module IO-free).
 * @returns The resolver's {resolved, manifestCid?, error?} result.
 */
export function resolveAssetRef(
  ref: AssetRef,
  deps: {
    resolve: (childRef: any, selfAssets: any) => Promise<any>;
    selfAssets?: any;
  }
): Promise<any> {
  const childRef =
    ref.collection === "self"
      ? { collection: "self", assetID: ref.assetID }
      : { collection: ref.collection, assetID: ref.assetID };
  return deps.resolve(
    childRef,
    ref.collection === "self" ? deps.selfAssets ?? null : null
  );
}
