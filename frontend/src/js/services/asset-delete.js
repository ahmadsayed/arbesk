/**
 * Shared collection asset deletion helper.
 *
 * Removes a single asset from a collection manifest, saves the updated
 * collection, and updates the on-chain tokenURI. The NFT token itself is
 * never burned.
 */

import { contract as walletContract } from "../blockchain/wallet.js";
import { updateAssetURI, CollaboratorRole } from "../blockchain/wallet.js";
import { getProof } from "../gltf/merkle-editors.js";
import { getFromRemoteIPFS } from "../ipfs/remote-ipfs.js";
import { saveManifest } from "./api.js";
import { showConfirmDialog } from "../ui/dialog.js";
import { showToast } from "../ui/toasts.js";
import { emit, EVENTS } from "../events/bus.js";
import { assetState } from "../state/asset-state.js";
import { walletState } from "../state/wallet-state.js";

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
  const c = walletContract || walletState.get().contract;
  if (!c) {
    throw new Error("Wallet or contract not ready");
  }

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

  const newCollection = {
    ...collection,
    assets: { ...collection.assets },
    prev_asset_manifest_cid: collectionCid,
  };
  delete newCollection.assets[assetId];
  newCollection.version = (newCollection.version || 0) + 1;

  const { cid: newCollectionCid } = await saveManifest(newCollection, {
    publishContext: null,
  });

  const walletAddr = walletState.get().walletAddress;
  let editorList = await loadEditorList(tokenId);
  if (!editorList) {
    editorList = [{ address: walletAddr, role: CollaboratorRole.Editor }];
  }
  const currentVersion = await getEditorSetVersion(tokenId);
  const proofResult = getProof(editorList, walletAddr, tokenId, currentVersion);
  if (!proofResult) throw new Error("Not an authorized editor");

  const txHash = await updateAssetURI(tokenId, newCollectionCid, proofResult.proof);
  if (!txHash) throw new Error("Update tokenURI transaction failed");

  if (
    String(assetState.get().activeAssetTokenId) === String(tokenId) &&
    String(assetState.get().activeAssetId) === String(assetId)
  ) {
    emit(EVENTS.ASSET_CLEARED);
  }

  showToast({
    type: "info",
    title: "Asset Deleted",
    message: `"${assetName || assetId}" removed from collection #${tokenId}.`,
  });

  if (typeof onAfterDelete === "function") {
    onAfterDelete();
  }

  return newCollectionCid;
}
