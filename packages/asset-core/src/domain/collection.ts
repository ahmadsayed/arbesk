/**
 * Domain: Collection — collection-context state commands.
 * @remarks Owns reads/writes of activeCollectionTokenId and selectedCollectionId.
 */
import { assetStore } from "./asset-store.ts";
import {
  deriveDefaultCollectionId,
  mergeAssetIntoCollection,
} from "../utils/collections.ts";

export function getActiveCollectionTokenId(): string | null {
  return assetStore.get().activeCollectionTokenId || null;
}

export function getSelectedCollectionId(): string | null {
  return assetStore.get().selectedCollectionId || null;
}

/**
 * Adopt a collection as the active collection context.
 */
export function adoptOpenedCollection(
  tokenId: string | number,
  { clearSelectedCollection = false }: { clearSelectedCollection?: boolean } = {}
) {
  const patch: Record<string, any> = { activeCollectionTokenId: String(tokenId) };
  if (clearSelectedCollection) patch.selectedCollectionId = null;
  assetStore.set(patch);
}

/**
 * Selects a target collection for the next publish.
 */
export function selectCollection(tokenId: string | number | null) {
  assetStore.set({
    selectedCollectionId: tokenId ? String(tokenId) : null,
  });
}

/** Clear the selected-collection hint. */
export function clearSelectedCollection() {
  assetStore.set({ selectedCollectionId: null });
}

/** Clears the active collection context entirely. */
export function clearActiveCollection() {
  assetStore.set({
    activeCollectionTokenId: null,
    selectedCollectionId: null,
  });
}

/**
 * Publish succeeded: the token is now the active collection.
 */
export function adoptPublishedCollection(tokenId: string | number) {
  assetStore.set({ activeCollectionTokenId: String(tokenId) });
}

export interface PublishCollectionDeps {
  getOwnerOf: Function;
  getTokenURI: Function;
  getCollectionManifest: Function;
  writeJSONToIPFS: Function;
  /** (tokenId, collectionCid, walletAddr, assetID?) — assetID identifies the changed entry. */
  republishCollection: Function;
  publishNewToken: Function;
  onAdoptIdentity?: (ctx: {
    tokenId: string;
    assetId: string;
    isNew: boolean;
  }) => void | Promise<void>;
}

export interface PublishCollectionResult {
  tokenId: string;
  collectionCid: string;
  isNew: boolean;
}

/**
 * Resolves which collection token this publish targets: the selected/active
 * one when it still resolves on-chain, otherwise the wallet's default
 * collection (only when the wallet actually owns it).
 */
async function resolveTargetCollection(
  walletAddr: string,
  deps: PublishCollectionDeps
): Promise<{ tokenId: string | null; manifest: Record<string, any> | null }> {
  const preferredCollectionId =
    getSelectedCollectionId() || getActiveCollectionTokenId();

  if (preferredCollectionId) {
    try {
      const manifest = await deps.getCollectionManifest(preferredCollectionId);
      if (manifest) return { tokenId: preferredCollectionId, manifest };
    } catch {
      // tokenURI reverted or IPFS fetch failed; treat as new collection
    }
  }

  const defaultTokenId = deriveDefaultCollectionId(walletAddr);
  const [ownerResult, manifestResult] = await Promise.allSettled([
    deps.getOwnerOf(defaultTokenId),
    deps.getCollectionManifest(defaultTokenId),
  ]);
  if (ownerResult.status === "fulfilled" && ownerResult.value) {
    return {
      tokenId: defaultTokenId,
      manifest: manifestResult.status === "fulfilled" ? manifestResult.value : null,
    };
  }
  return { tokenId: null, manifest: null };
}

/**
 * Builds the next collection manifest for the asset, writes it to IPFS, and
 * anchors it on-chain.
 * @remarks This is the canonical publish path.
 */
export async function publishCollection(
  assetCid: string,
  assetID: string,
  walletAddr: string,
  deps: PublishCollectionDeps
): Promise<PublishCollectionResult> {
  const target = await resolveTargetCollection(walletAddr, deps);
  const existingCollectionTokenId = target.tokenId;
  const collectionManifest = target.manifest;

  const mergedCollection: Record<string, any> = mergeAssetIntoCollection(
    collectionManifest,
    assetID,
    assetCid
  );
  mergedCollection.version = (mergedCollection.version || 0) + 1;
  mergedCollection.prev_asset_manifest_cid = existingCollectionTokenId
    ? await deps.getTokenURI(existingCollectionTokenId)
    : null;
  mergedCollection.timestamp = Date.now();

  const collectionCid = await deps.writeJSONToIPFS(mergedCollection, null, {
    type: "collection",
    assetId: mergedCollection.asset_id,
  });

  let tokenId: string;
  let isNew: boolean;

  if (existingCollectionTokenId) {
    await deps.republishCollection(
      existingCollectionTokenId,
      collectionCid,
      walletAddr,
      // The token is the collection; the assetID says WHICH entry changed so
      // live-update viewers can reload precisely that asset.
      assetID
    );
    tokenId = String(existingCollectionTokenId);
    isNew = false;
  } else {
    const newTokenId = deriveDefaultCollectionId(walletAddr);
    if (!newTokenId) throw new Error("Cannot derive default collection id");
    tokenId = newTokenId;
    await deps.publishNewToken(collectionCid, tokenId, walletAddr);
    isNew = true;
  }

  adoptPublishedCollection(tokenId);

  if (typeof deps.onAdoptIdentity === "function") {
    await deps.onAdoptIdentity({ tokenId, assetId: assetID, isNew });
  }

  return { tokenId, collectionCid, isNew };
}
