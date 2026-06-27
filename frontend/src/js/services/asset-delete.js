// @ts-nocheck
/**
 * Shared collection asset deletion helper.
 *
 * Removes a single asset from a collection manifest, saves the updated
 * collection, and updates the on-chain tokenURI. The NFT token itself is
 * never burned.
 */

import { contract as walletContract } from "../blockchain/wallet.js";
import {
  updateAssetURI,
  CollaboratorRole,
  burn,
} from "../blockchain/wallet.js";
import { requireWallet } from "../blockchain/wallet-guard.js";
import { getProof } from "../gltf/merkle-editors.js";
import { getFromRemoteIPFS } from "../ipfs/remote-ipfs.js";
import { writeJSONToIPFS } from "../ipfs/write-to-ipfs.js";
import { unpinAssetCids } from "./api.js";
import { showConfirmDialog } from "../ui/dialog.js";
import { showToast } from "../ui/toasts.js";
import { emit, EVENTS } from "../events/bus.js";
import { assetState } from "../state/asset-state.js";
import { walletState } from "../state/wallet-state.js";
import { identityMatrix } from "../utils/collections.js";

const EDITOR_LIST_PREFIX = "arbesk_editor_list_";

function editorListKey(tokenId) {
  return EDITOR_LIST_PREFIX + tokenId;
}

async function loadEditorList(tokenId) {
  try {
    const stored = localStorage.getItem(editorListKey(tokenId));
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.cid) {
        try {
          const fresh = await getFromRemoteIPFS(parsed.cid);
          if (Array.isArray(fresh)) return fresh;
        } catch {
          // IPFS fetch failed, use cached
        }
      }
      if (Array.isArray(parsed.list)) return parsed.list;
    }
  } catch {
    // localStorage unavailable or corrupted
  }
  return null;
}

async function getEditorSetVersion(tokenId) {
  try {
    const c = walletContract || walletState.get().contract;
    if (!c) return 1;
    const version = await c.methods.editorSetVersion(tokenId).call();
    return Number(version);
  } catch {
    return 1;
  }
}

/**
 * Remove an asset from its parent collection.
 * @param {Object} opts
 * @param {string} opts.tokenId - Collection token ID.
 * @param {string} opts.assetId - Asset ID inside the collection.
 * @param {string} opts.assetName - Display name for toasts/dialogs.
 * @param {Function} [opts.onAfterDelete] - Optional callback after success.
 * @returns {Promise<string|null>} New collection CID on success, null on cancel.
 */
export async function deleteAssetFromCollection({
  tokenId,
  assetId,
  assetName,
  onAfterDelete,
}) {
  const { contract: c } = requireWallet();

  const confirmed = await showConfirmDialog(
    "Delete Asset",
    `Delete "${assetName || assetId}" from this collection?`,
    [
      { text: "Cancel", value: "cancel" },
      { text: "Delete", value: "delete", className: "btn btn-danger" },
    ]
  );
  if (confirmed !== "delete") return null;

  const collectionCid = await c.methods.tokenURI(tokenId).call();
  const collection = await getFromRemoteIPFS(collectionCid);

  if (!collection.assets || !(assetId in collection.assets)) {
    showToast({
      type: "warning",
      title: "Already removed",
      message: "Asset was not found in the collection.",
    });
    return null;
  }

  // Capture the deleted asset's manifest CID before removing it from the
  // collection so we can unpin its IPFS footprint after the on-chain pointer
  // has moved to the new collection manifest.
  const deletedAssetManifestCid = collection.assets[assetId];

  const newCollection = {
    ...collection,
    assets: { ...collection.assets },
    prev_asset_manifest_cid: collectionCid,
  };
  delete newCollection.assets[assetId];
  newCollection.version = (newCollection.version || 0) + 1;

  // Write updated collection directly to IPFS - no backend middleman.
  const newCollectionCid = await writeJSONToIPFS(newCollection, null, {
    type: "collection",
    assetId: newCollection.asset_id,
  });

  const walletAddr = walletState.get().walletAddress;
  let editorList = await loadEditorList(tokenId);
  if (!editorList) {
    editorList = [{ address: walletAddr, role: CollaboratorRole.Editor }];
  }
  const currentVersion = await getEditorSetVersion(tokenId);
  const proofResult = getProof(editorList, walletAddr, tokenId, currentVersion);
  if (!proofResult) throw new Error("Not an authorized editor");

  const txHash = await updateAssetURI(
    tokenId,
    newCollectionCid,
    proofResult.proof
  );
  if (!txHash) throw new Error("Update tokenURI transaction failed");

  // The on-chain tokenURI now points at the new collection, so the deleted
  // asset's manifest chain is orphaned. Unpin it best-effort, non-blocking -
  // the backend walks the chain and unpins the manifest, source glTF, and
  // thumbnail CIDs. Failures are non-fatal (the asset is already detached).
  if (deletedAssetManifestCid) {
    const capturedCid = deletedAssetManifestCid;
    unpinAssetCids(capturedCid, walletAddr)
      .then((result) => {
        console.log(
          `[DELETE] unpinned ${result.count} CIDs for asset ${assetId}`
        );
        if (result.errors?.length)
          console.warn(`[DELETE] unpin errors:`, result.errors);
      })
      .catch((err) =>
        console.warn(`[DELETE] unpin failed (non-fatal):`, err.message)
      );
  }

  if (
    String(assetState.get().activeAssetTokenId) === String(tokenId) &&
    String(assetState.get().activeAssetId) === String(assetId)
  ) {
    emit(EVENTS.ASSET_CLEARED);
  }

  showToast({
    type: "info",
    title: "Asset Deleted",
    message: `"${assetName || assetId}" removed from collection.`,
  });

  if (typeof onAfterDelete === "function") {
    onAfterDelete();
  }

  return newCollectionCid;
}

/**
 * Burn a collection token and unpin its IPFS footprint.
 *
 * @param {string} tokenId
 * @returns {Promise<string|null>} txHash on success, null on failure.
 */
export async function burnCollection(tokenId) {
  const { walletAddress: walletAddr } = requireWallet();
  let editorList = await loadEditorList(tokenId);
  if (!editorList) {
    editorList = [{ address: walletAddr, role: CollaboratorRole.Editor }];
  }
  const currentVersion = await getEditorSetVersion(tokenId);
  const proofResult = getProof(editorList, walletAddr, tokenId, currentVersion);
  if (!proofResult) throw new Error("Not authorized to burn this collection");

  return burn(tokenId, proofResult.proof);
}

export async function loadEditorListForToken(tokenId) {
  return loadEditorList(tokenId);
}

export async function getEditorSetVersionForToken(tokenId) {
  return getEditorSetVersion(tokenId);
}

/**
 * Load a collection manifest, apply a mutation, write the new manifest to IPFS,
 * and update the on-chain tokenURI. Reuses editor-list/proof logic from delete.
 *
 * @param {string} tokenId
 * @param {Function} mutate - Receives the collection manifest; should mutate and return it.
 * @param {{label?: string, onAfterUpdate?: Function}} [options]
 * @returns {Promise<string>} New collection CID.
 */
export async function updateCollectionManifest(tokenId, mutate, options = {}) {
  const { contract: c } = requireWallet();

  const currentCid = await c.methods.tokenURI(tokenId).call();
  const collection = await getFromRemoteIPFS(currentCid);

  const newCollection = mutate({ ...collection });
  newCollection.version = (newCollection.version || 0) + 1;
  newCollection.prev_asset_manifest_cid = currentCid;

  const newCollectionCid = await writeJSONToIPFS(newCollection, null, {
    type: "collection",
    assetId: newCollection.asset_id,
  });

  const walletAddr = walletState.get().walletAddress;
  let editorList = await loadEditorList(tokenId);
  if (!editorList) {
    editorList = [{ address: walletAddr, role: CollaboratorRole.Editor }];
  }
  const currentVersion = await getEditorSetVersion(tokenId);
  const proofResult = getProof(editorList, walletAddr, tokenId, currentVersion);
  if (!proofResult) throw new Error("Not an authorized editor");

  const txHash = await updateAssetURI(
    tokenId,
    newCollectionCid,
    proofResult.proof
  );
  if (!txHash)
    throw new Error(
      `Update tokenURI transaction failed for ${options.label || tokenId}`
    );

  if (typeof options.onAfterUpdate === "function") {
    options.onAfterUpdate(newCollectionCid);
  }

  return newCollectionCid;
}

/**
 * Link an asset from one collection to another as either a fork (independent
 * copy of the current CID) or a live reference (child_ref pointing back at the
 * source collection asset so future edits propagate).
 *
 * @param {Object} opts
 * @param {string} opts.sourceTokenId
 * @param {string} opts.targetTokenId
 * @param {string} opts.assetId
 * @param {string} opts.assetName
 * @param {"fork"|"live-ref"} opts.mode
 * @param {Function} [opts.onAfterSend]
 * @returns {Promise<void>}
 */
export async function sendAssetToCollection({
  sourceTokenId,
  targetTokenId,
  assetId,
  assetName,
  mode,
  onAfterSend,
}) {
  const { contract: c } = requireWallet();
  if (String(sourceTokenId) === String(targetTokenId)) {
    throw new Error("Source and target collection must be different");
  }
  if (mode !== "fork" && mode !== "live-ref") {
    throw new Error(`Unsupported link mode: ${mode}`);
  }

  const sourceCid = await c.methods.tokenURI(sourceTokenId).call();
  const sourceCollection = await getFromRemoteIPFS(sourceCid);

  const assetCid = sourceCollection.assets?.[assetId];
  if (!assetCid) {
    throw new Error(`Asset ${assetId} not found in source collection`);
  }

  let targetAssetId = assetId;
  let targetAssetCid = assetCid;

  if (mode === "live-ref") {
    targetAssetId = `asset_${Date.now()}`;
    const sourceAssetManifest = await getFromRemoteIPFS(assetCid);
    const refManifest = {
      type: "asset",
      name: assetName || targetAssetId,
      asset_id: targetAssetId,
      version: 1,
      timestamp: Date.now(),
      thumbnail: sourceAssetManifest?.thumbnail || null,
      scene: {
        nodes: [
          {
            node_id: "node_1",
            child_ref: {
              collection: {
                chainId: Number(walletState.get().chainId),
                contractAddress: walletState.get().contractAddress,
                tokenId: String(sourceTokenId),
              },
              assetID: assetId,
            },
            transform_matrix: identityMatrix(),
          },
        ],
      },
    };
    targetAssetCid = await writeJSONToIPFS(refManifest, null, {
      type: "asset",
      assetId: targetAssetId,
    });
  }

  await updateCollectionManifest(
    targetTokenId,
    (col) => {
      col.assets = { ...(col.assets || {}) };
      col.assets[targetAssetId] = targetAssetCid;
      return col;
    },
    { label: "target" }
  );

  showToast({
    type: "info",
    title: mode === "fork" ? "Asset Forked" : "Live Reference Created",
    message: `"${assetName || assetId}" ${
      mode === "fork" ? "forked into" : "linked to"
    } the target collection.`,
  });

  if (typeof onAfterSend === "function") {
    onAfterSend();
  }
}
