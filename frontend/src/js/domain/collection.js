// @ts-check
/**
 * Domain: Collection — collection-context state commands.
 *
 * Owns reads/writes of activeCollectionTokenId and selectedCollectionId.
 * The canonical publish seam is added in Task 2.
 */
import { assetStore } from "./asset-store.js";
import {
  deriveDefaultCollectionId,
  mergeAssetIntoCollection,
} from "../utils/collections.js";

/** @returns {string|null} */
export function getActiveCollectionTokenId() {
  return assetStore.get().activeCollectionTokenId || null;
}

/** @returns {string|null} */
export function getSelectedCollectionId() {
  return assetStore.get().selectedCollectionId || null;
}

/**
 * Adopt a collection as the active collection context.
 * @param {string|number} tokenId
 * @param {{clearSelectedCollection?: boolean}} [options]
 */
export function adoptOpenedCollection(
  tokenId,
  { clearSelectedCollection = false } = {}
) {
  /** @type {Record<string, any>} */
  const patch = { activeCollectionTokenId: String(tokenId) };
  if (clearSelectedCollection) patch.selectedCollectionId = null;
  assetStore.set(patch);
}

/**
 * Select a target collection for the next publish (collection dropdown).
 * @param {string|number|null} tokenId
 */
export function selectCollection(tokenId) {
  assetStore.set({
    selectedCollectionId: tokenId ? String(tokenId) : null,
  });
}

/** Clear the selected-collection hint. */
export function clearSelectedCollection() {
  assetStore.set({ selectedCollectionId: null });
}

/** Clear the active collection context entirely (library close-out / error). */
export function clearActiveCollection() {
  assetStore.set({
    activeCollectionTokenId: null,
    selectedCollectionId: null,
  });
}

/**
 * Publish succeeded: the token is now the active collection.
 * @param {string|number} tokenId
 */
export function adoptPublishedCollection(tokenId) {
  assetStore.set({ activeCollectionTokenId: String(tokenId) });
}

/**
 * Build the next collection manifest for the asset, write it to IPFS, and
 * anchor it on-chain. Canonical implementation; the thin service wrapper
 * injects chain/IPFS/editor helpers.
 *
 * @param {string} assetCid
 * @param {string} assetID
 * @param {string} walletAddr
 * @param {{
 *   getOwnerOf: Function,
 *   getTokenURI: Function,
 *   getCollectionManifest: Function,
 *   writeJSONToIPFS: Function,
 *   republishCollection: Function,
 *   publishNewToken: Function,
 *   onAdoptIdentity?: (ctx: {tokenId: string, assetId: string, isNew: boolean}) => void|Promise<void>
 * }} deps
 * @returns {Promise<{tokenId: string, collectionCid: string, isNew: boolean}>}
 */
export async function publishCollection(assetCid, assetID, walletAddr, deps) {
  const preferredCollectionId =
    getSelectedCollectionId() || getActiveCollectionTokenId();

  let existingCollectionTokenId = null;
  let collectionManifest = null;

  if (preferredCollectionId) {
    try {
      collectionManifest = await deps.getCollectionManifest(preferredCollectionId);
      if (collectionManifest) existingCollectionTokenId = preferredCollectionId;
    } catch {
      // tokenURI reverted or IPFS fetch failed; treat as new collection
    }
  }

  if (!existingCollectionTokenId) {
    const defaultTokenId = deriveDefaultCollectionId(walletAddr);
    const [ownerResult, manifestResult] = await Promise.allSettled([
      deps.getOwnerOf(defaultTokenId),
      deps.getCollectionManifest(defaultTokenId),
    ]);
    if (ownerResult.status === "fulfilled" && ownerResult.value) {
      existingCollectionTokenId = defaultTokenId;
      collectionManifest =
        manifestResult.status === "fulfilled" ? manifestResult.value : null;
    }
  }

  /** @type {Record<string, any>} */
  const mergedCollection = mergeAssetIntoCollection(
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

  let tokenId;
  let isNew;

  if (existingCollectionTokenId) {
    await deps.republishCollection(
      existingCollectionTokenId,
      collectionCid,
      walletAddr
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
