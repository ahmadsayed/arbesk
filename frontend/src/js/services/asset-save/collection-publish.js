// @ts-nocheck
/**
 * Collection manifest resolution and on-chain publishing.
 *
 * Determines whether to create a new default collection or update an existing
 * one, merges the asset CID into the collection's assets map, writes the
 * updated collection manifest to IPFS, and anchors it on-chain.
 */

import {
  deriveDefaultCollectionId,
  mergeAssetIntoCollection,
} from "../../utils/collections.js";
import { getOwnerOf, getTokenURI, getCollectionManifest } from "../token.js";
import { writeJSONToIPFS } from "../../ipfs/write-to-ipfs.js";
import { assetState } from "../../state/asset-state.js";
import {
  republishCollection,
  publishNewToken,
} from "./editor-publish.js";

/**
 * Find the collection token ID and manifest to update.
 * Prefers any explicitly selected collection, then probes the chain for the
 * wallet's default collection token.
 */
export async function resolveCollectionTokenId(walletAddr) {
  const preferredCollectionId =
    assetState.get().selectedCollectionId ||
    assetState.get().activeCollectionTokenId;

  if (preferredCollectionId) {
    try {
      const manifest = await getCollectionManifest(preferredCollectionId);
      if (manifest) {
        return { tokenId: preferredCollectionId, manifest };
      }
    } catch {
      // tokenURI reverted or IPFS fetch failed; treat as new collection
    }
  }

  // In-memory state is unreliable across reloads / fresh sessions / E2E
  // isolation: it can be empty even when a default collection was already
  // minted on-chain. Without this fallback the code would try to re-mint an
  // existing token and hit `TokenAlreadyMinted`. Probe the chain for the
  // derived default collection ID and, if it exists, route to republish.
  const defaultTokenId = deriveDefaultCollectionId(walletAddr);

  // ownerOf and the manifest resolution are independent; run them in parallel.
  const [ownerResult, manifestResult] = await Promise.allSettled([
    getOwnerOf(defaultTokenId),
    getCollectionManifest(defaultTokenId),
  ]);

  if (ownerResult.status === "fulfilled" && ownerResult.value) {
    return {
      tokenId: defaultTokenId,
      manifest:
        manifestResult.status === "fulfilled" ? manifestResult.value : null,
    };
  }

  return { tokenId: null, manifest: null };
}

/**
 * Build the next collection manifest for the asset, write it to IPFS, and
 * anchor it on-chain (republish an existing collection or mint a new one).
 * Returns { tokenId, collectionCid, isNew }.
 */
export async function publishCollectionForAsset(assetCid, assetID, walletAddr) {
  const { tokenId: existingCollectionTokenId, manifest: collectionManifest } =
    await resolveCollectionTokenId(walletAddr);

  const mergedCollection = mergeAssetIntoCollection(
    collectionManifest,
    assetID,
    assetCid
  );
  mergedCollection.version = (mergedCollection.version || 0) + 1;
  mergedCollection.prev_asset_manifest_cid = existingCollectionTokenId
    ? await getTokenURI(existingCollectionTokenId)
    : null;
  // Always refresh the timestamp so every published collection manifest is a
  // distinct IPFS object. This prevents Pinata (and other backends that reject
  // exact duplicates) from returning a 409 when the asset CID or version has
  // not otherwise changed.
  mergedCollection.timestamp = Date.now();

  // Write collection manifest directly to IPFS - no backend middleman.
  const collectionCid = await writeJSONToIPFS(mergedCollection, null, {
    type: "collection",
    assetId: mergedCollection.asset_id,
  });

  let tokenId;
  let isNew;

  if (existingCollectionTokenId) {
    await republishCollection(existingCollectionTokenId, collectionCid, walletAddr);
    tokenId = String(existingCollectionTokenId);
    isNew = false;
  } else {
    tokenId = deriveDefaultCollectionId(walletAddr);
    await publishNewToken(collectionCid, tokenId, walletAddr);
    isNew = true;
  }

  return { tokenId, collectionCid, isNew };
}
