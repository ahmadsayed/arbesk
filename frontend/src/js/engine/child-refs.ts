import { state } from "./state.ts";

/** BigInt-safe token id comparison so hex payloads match decimal refs. */
export function sameTokenId(a: any, b: any): boolean {
  try {
    return BigInt(a) === BigInt(b);
  } catch {
    return String(a) === String(b);
  }
}

/**
 * Extract the collection ref from a child_ref, normalizing the legacy flat
 * shape into the collection envelope. Returns null for "self" refs.
 */
export function childRefCollection(ref: any): { chainId: number; contractAddress: string; tokenId: string } | null {
  if (!ref) return null;
  const chainId = Number(ref.collection?.chainId ?? ref.chainId ?? 0);
  const contractAddress = ref.collection?.contractAddress ?? ref.contractAddress ?? "";
  const tokenId = String(ref.collection?.tokenId ?? ref.tokenId ?? "");
  return chainId && contractAddress && tokenId ? { chainId, contractAddress, tokenId } : null;
}

/**
 * Every child_ref currently rendered in the scene, at any nesting depth.
 * loadNode tags anchors for root-manifest nodes and nested ones alike, so
 * this sees grandchildren the root manifest cannot.
 */
export function collectSceneChildRefs(): { nodeId: string; ref: any; anchor: any }[] {
  const out: { nodeId: string; ref: any; anchor: any }[] = [];
  for (const [nodeId, anchor] of state.nodeAnchors) {
    const ref = (anchor?.metadata as any)?.childRef;
    if (ref) out.push({ nodeId, ref, anchor });
  }
  return out;
}

/** True when a child_ref anchor matches an ASSET_URI_UPDATED payload. */
export function childRefMatchesUpdate(ref: any, payload: any): boolean {
  const col = childRefCollection(ref);
  if (!col) return false;
  if (col.chainId !== Number(payload.chainId)) return false;
  const payloadContract = payload.contractAddress?.toLowerCase?.() || null;
  if (payloadContract && col.contractAddress.toLowerCase() !== payloadContract) return false;
  if (!sameTokenId(col.tokenId, payload.tokenId)) return false;
  // The token identifies the collection; when the notice names the changed
  // asset, reload only refs to THAT asset. Notices without an assetId (older
  // publishers) fall back to collection-wide reload.
  if (payload.assetId && ref.assetID && ref.assetID !== payload.assetId) return false;
  return true;
}

/**
 * True when an ancestor of `anchor` is also in `matchedIds` — an ancestor's
 * reload recursively re-resolves its descendants, so covered nodes must not
 * reload on their own (disposeNodeSubtree is tearing them down concurrently).
 */
export function coveredByMatchedAncestor(anchor: any, matchedIds: Set<string>): boolean {
  let p = anchor?.parent;
  while (p) {
    const pId = (p.metadata as any)?.nodeId;
    if (pId && matchedIds.has(pId)) return true;
    p = p.parent;
  }
  return false;
}
