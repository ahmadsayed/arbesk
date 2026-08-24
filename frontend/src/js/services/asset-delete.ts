/**
 * Shared collection asset deletion helper.
 *
 * Removes a single asset from a collection manifest, saves the updated
 * collection, and updates the on-chain tokenURI. The NFT token itself is
 * never burned.
 */

import {
  updateAssetURI,
  CollaboratorRole,
  burn,
} from "../blockchain/wallet.ts";
import { requireWallet } from "../blockchain/wallet-guard.ts";
import { loadEditorList, getEditorSetVersion } from "@arbesk/asset-core/domain/editors.js";
import { getProof } from "@arbesk/asset-core/gltf/merkle-editors.js";
import { getFromRemoteIPFS } from "../ipfs/remote-ipfs.ts";
import { writeJSONToIPFS } from "../ipfs/write-to-ipfs.ts";
import { unpinAssetCids } from "./api.ts";
import { showConfirmDialog } from "../ui/dialog.ts";
import { showToast } from "../ui/toasts.ts";
import { emit, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { getActiveAssetTokenId, getActiveAssetId } from "@arbesk/asset-core/domain/asset.js";
import { walletState } from "../state/wallet-state.ts";
import { identityMatrix } from "@arbesk/asset-core/utils/collections.js";

/**
 * Remove an asset from its parent collection.
 * @returns New collection CID on success, null on cancel.
 */
export async function deleteAssetFromCollection({
  tokenId,
  assetId,
  assetName,
  onAfterDelete,
}: {
  /** Collection token ID. */
  tokenId: string;
  /** Asset ID inside the collection. */
  assetId: string;
  /** Display name for toasts/dialogs. */
  assetName: string;
  /** Optional callback after success. */
  onAfterDelete?: Function;
}): Promise<string | null> {
  const { contract: c } = requireWallet() as any;

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
  const newCollectionCid = await writeJSONToIPFS(newCollection, null as any, {
    type: "collection",
    assetId: newCollection.asset_id,
  });

  const walletAddr = walletState.get().walletAddress as string;
  let editorList = await loadEditorList(tokenId);
  if (!editorList || editorList.length === 0) {
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
  // the backend verifies ownership/editor rights on-chain (token still live)
  // and checks the orphaned CID against the collection's previous version
  // (prev_asset_manifest_cid), then walks the chain and unpins the manifest,
  // source glTF, and thumbnail CIDs. Failures are non-fatal (the asset is
  // already detached).
  if (deletedAssetManifestCid) {
    const capturedCid = deletedAssetManifestCid;
    unpinAssetCids(capturedCid, {
      tokenId,
      chainId: Number(walletState.get().chainId),
      contractAddress: walletState.get().contractAddress,
      proof: proofResult.proof,
    })
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
    String(getActiveAssetTokenId()) === String(tokenId) &&
    String(getActiveAssetId()) === String(assetId)
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
 * @returns txHash on success, null on failure.
 */
export async function burnCollection(tokenId: string): Promise<string | null> {
  const { walletAddress: walletAddr } = requireWallet();
  let editorList = await loadEditorList(tokenId);
  if (!editorList || editorList.length === 0) {
    editorList = [{ address: walletAddr, role: CollaboratorRole.Editor }];
  }
  const currentVersion = await getEditorSetVersion(tokenId);
  const proofResult = getProof(editorList, walletAddr, tokenId, currentVersion);
  if (!proofResult) throw new Error("Not authorized to burn this collection");

  return burn(tokenId, proofResult.proof);
}

/**
 * Load a collection manifest, apply a mutation, write the new manifest to IPFS,
 * and update the on-chain tokenURI. Reuses editor-list/proof logic from delete.
 *
 * @param mutate - Receives the collection manifest; should mutate and return it.
 * @returns New collection CID.
 */
export async function updateCollectionManifest(
  tokenId: string | number,
  mutate: (collection: any) => any,
  options: { label?: string; onAfterUpdate?: Function } = {}
): Promise<string> {
  const { contract: c } = requireWallet() as any;

  const currentCid = await c.methods.tokenURI(tokenId).call();
  const collection = await getFromRemoteIPFS(currentCid);

  const newCollection = mutate({ ...collection });
  newCollection.version = (newCollection.version || 0) + 1;
  newCollection.prev_asset_manifest_cid = currentCid;

  const newCollectionCid = await writeJSONToIPFS(newCollection, null as any, {
    type: "collection",
    assetId: newCollection.asset_id,
  });

  const walletAddr = walletState.get().walletAddress as string;
  const tokenIdStr = tokenId as string;
  let editorList = await loadEditorList(tokenIdStr);
  if (!editorList || editorList.length === 0) {
    editorList = [{ address: walletAddr, role: CollaboratorRole.Editor }];
  }
  const currentVersion = await getEditorSetVersion(tokenIdStr);
  const proofResult = getProof(editorList, walletAddr, tokenIdStr, currentVersion);
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
 */
export async function sendAssetToCollection({
  sourceTokenId,
  targetTokenId,
  assetId,
  assetName,
  mode,
  onAfterSend,
}: {
  sourceTokenId: string;
  targetTokenId: string;
  assetId: string;
  assetName: string;
  mode: "fork" | "live-ref";
  onAfterSend?: Function;
}): Promise<void> {
  const { contract: c } = requireWallet() as any;
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
    targetAssetCid = await writeJSONToIPFS(refManifest, null as any, {
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
