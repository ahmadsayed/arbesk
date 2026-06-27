// @ts-nocheck
/**
 * Library operations - create collections and upload desktop files.
 *
 * These helpers run in the browser, reuse the existing IPFS writers, and
 * anchor changes on-chain via the wallet contract. They deliberately do not
 * import the Studio save module so the Library page stays lightweight.
 */

import { writeToIPFS, writeJSONToIPFS } from "../ipfs/write-to-ipfs.js";
import {
  publishAsset,
  CollaboratorRole,
} from "../blockchain/wallet.js";
import { computeRoot } from "../gltf/merkle-editors.js";
import { updateCollectionManifest } from "./asset-delete.js";
import { walletState } from "../state/wallet-state.js";
import {
  deriveNamedCollectionId,
  identityMatrix,
} from "../utils/collections.js";
import { log, warn } from "../utils/log.js";

const EDITOR_LIST_PREFIX = "arbesk_editor_list_";
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(["glb", "gltf"]);

function editorListKey(tokenId) {
  return EDITOR_LIST_PREFIX + tokenId;
}

function saveEditorListLocally(tokenId, editorList, ipfsCid = null) {
  try {
    localStorage.setItem(
      editorListKey(tokenId),
      JSON.stringify({
        list: editorList,
        cid: ipfsCid,
        saved: Date.now(),
      })
    );
  } catch (e) {
    warn("[LIBRARY-OPS] failed to cache editor list:", e.message);
  }
  return ipfsCid || "";
}

function getContract() {
  return walletState.get().contract;
}

function requireWallet() {
  const { walletAddress } = walletState.get();
  if (!walletAddress) throw new Error("Wallet not connected");
  return walletAddress;
}

/**
 * Create a new named collection for the current wallet.
 *
 * @param {string} name
 * @returns {Promise<{tokenId: string, manifestCid: string, isNew: boolean}>}
 */
export async function createNamedCollection(name) {
  const trimmed = (name || "").trim();
  if (!trimmed) throw new Error("Collection name is required");

  const walletAddr = requireWallet();
  const c = getContract();
  if (!c) throw new Error("Contract not ready");

  const tokenIdHex = deriveNamedCollectionId(walletAddr, trimmed);
  // Library state stores token ids as decimal strings (matching on-chain event values).
  const tokenId = BigInt(tokenIdHex).toString();

  // If this wallet+name collection was already minted, return the existing one
  // instead of failing with TokenAlreadyMinted.
  try {
    await c.methods.ownerOf(tokenId).call();
    const existingCid = await c.methods.tokenURI(tokenId).call();
    return { tokenId, manifestCid: existingCid, isNew: false };
  } catch {
    // Token does not exist - proceed to mint.
  }

  const collectionManifest = {
    type: "collection",
    name: trimmed,
    asset_id: `collection_${Date.now()}`,
    version: 1,
    timestamp: Date.now(),
    assets: {},
    prev_asset_manifest_cid: null,
  };

  const collectionCid = await writeJSONToIPFS(collectionManifest, null, {
    type: "collection",
    assetId: collectionManifest.asset_id,
  });
  log(`[LIBRARY-OPS] collection manifest → ${collectionCid}`);

  const editorList = [{ address: walletAddr, role: CollaboratorRole.Editor }];
  const editorRoot = computeRoot(editorList, tokenId, 1);
  const editorListUri = saveEditorListLocally(tokenId, editorList, null);

  const txHash = await publishAsset(
    collectionCid,
    tokenId,
    editorRoot,
    editorListUri
  );
  if (!txHash) throw new Error("Publish collection transaction failed");

  log(`[LIBRARY-OPS] minted collection token ${tokenId} (hex ${tokenIdHex}) → ${txHash}`);
  return { tokenId, manifestCid: collectionCid, isNew: true };
}

function fileExtension(filename) {
  const parts = (filename || "").split(".");
  return parts.length > 1 ? parts.pop().toLowerCase() : "";
}

function baseNameWithoutExtension(filename) {
  const ext = fileExtension(filename);
  if (!ext) return filename || "Uploaded Asset";
  return filename.slice(0, -ext.length - 1) || "Uploaded Asset";
}

function validateUploadFile(file) {
  if (!file) throw new Error("No file selected");
  const ext = fileExtension(file.name);
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported file type .${ext}. Please upload .glb or .gltf.`);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`File is too large. Maximum size is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);
  }
  return ext;
}

/**
 * Upload a desktop glTF/GLB file into an existing collection.
 *
 * @param {File} file
 * @param {string|number} collectionTokenId
 * @returns {Promise<{assetId: string, assetManifestCid: string, newCollectionCid: string}>}
 */
export async function uploadFileToCollection(file, collectionTokenId) {
  if (!collectionTokenId) throw new Error("Open a collection first to upload into it");

  requireWallet();
  const c = getContract();
  if (!c) throw new Error("Contract not ready");

  const format = validateUploadFile(file);
  const assetId = `asset_${Date.now()}`;
  const assetName = baseNameWithoutExtension(file.name);

  const arrayBuffer = await file.arrayBuffer();
  const sourceCid = await writeToIPFS(
    new Uint8Array(arrayBuffer),
    file.name
  );
  log(`[LIBRARY-OPS] uploaded source asset → ${sourceCid}`);

  const assetManifest = {
    type: "asset",
    name: assetName,
    asset_id: assetId,
    version: 1,
    timestamp: Date.now(),
    scene: {
      nodes: [
        {
          node_id: "node_1",
          type: "source_asset",
          name: assetName,
          source: {
            cid: sourceCid,
            path: file.name,
            format,
          },
          transform_matrix: identityMatrix(),
          post_processor: {
            color: null,
            scale: { x: 1, y: 1, z: 1 },
          },
        },
      ],
    },
  };

  const assetManifestCid = await writeJSONToIPFS(assetManifest, null, {
    type: "asset",
    assetId,
  });
  log(`[LIBRARY-OPS] uploaded asset manifest → ${assetManifestCid}`);

  const newCollectionCid = await updateCollectionManifest(
    collectionTokenId,
    (col) => {
      col.assets = { ...(col.assets || {}) };
      col.assets[assetId] = assetManifestCid;
      return col;
    },
    { label: "upload asset" }
  );

  log(`[LIBRARY-OPS] added ${assetId} to collection ${collectionTokenId} → ${newCollectionCid}`);

  return { assetId, assetManifestCid, newCollectionCid };
}
