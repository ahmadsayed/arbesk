/**
 * Editor / collaborator helpers for publish and republish.
 *
 * Wraps Merkle editor-list operations: authorization checks, proof generation,
 * and persistence of the initial editor list for a new token.
 */

import { computeRoot, getProof, makeLeaf } from "../../gltf/merkle-editors.js";
import * as wallet from "../../blockchain/wallet.js";
import { CollaboratorRole } from "../../blockchain/wallet.js";
import {
  loadEditorList,
  saveEditorList,
  getEditorSetVersion,
} from "../../domain/editors.js";
import { isOwner } from "../team.js";
import { writeJSONToIPFS } from "../../ipfs/write-to-ipfs.js";

/** @param {string|number} tokenId */
async function getEditorRoot(tokenId) {
  if (!wallet.contract) return null;
  try {
    return await wallet.contract.methods.editorRoot(tokenId).call();
  } catch (err) {
    console.warn("[EDITOR-PUBLISH] failed to read editorRoot:", /** @type {Error} */ (err).message);
    return null;
  }
}

/**
 * Build a proof for the current wallet against the current editor set.
 * Falls back to a single-editor owner proof when the editor list cannot be
 * fetched from IPFS/chain/localStorage but the on-chain root proves the owner
 * is the only editor. This keeps existing tokens editable by their owners
 * without changing the smart contract.
 */
/**
 * @param {string|number} tokenId
 * @param {string} walletAddr
 */
async function buildWalletProof(tokenId, walletAddr) {
  // Version and editor list are independent; resolve them in parallel.
  const tokenIdStr = /** @type {string} */ (tokenId);
  const [versionResult, editorListResult] = await Promise.allSettled([
    getEditorSetVersion(tokenIdStr),
    loadEditorList(tokenIdStr),
  ]);

  const currentVersion =
    versionResult.status === "fulfilled" ? versionResult.value : 1;
  const editorList =
    editorListResult.status === "fulfilled" ? editorListResult.value : [];

  // Normal path: wallet is in the fetched editor list.
  const proofFromList = getProof(editorList, walletAddr, tokenId, currentVersion);
  if (proofFromList) return proofFromList;

  // Fallback path: the wallet owns the token and the on-chain Merkle root
  // matches a tree containing only the owner as Editor. This is the default
  // tree created by prepareInitialEditors, so it resolves cases where the
  // editor list CID is unreachable or localStorage has been cleared.
  const [ownerResult, rootResult] = await Promise.allSettled([
    isOwner(tokenId),
    getEditorRoot(tokenId),
  ]);

  if (ownerResult.status === "fulfilled" && ownerResult.value) {
    const root = rootResult.status === "fulfilled" ? rootResult.value : null;
    const ownerLeaf = makeLeaf(
      walletAddr,
      CollaboratorRole.Editor,
      tokenId,
      currentVersion
    );
    if (root && root.toLowerCase() === ownerLeaf.toLowerCase()) {
      return { proof: [], role: CollaboratorRole.Editor };
    }
  }

  return null;
}

/**
 * Throw if the connected wallet is not an authorized editor of the token.
 */
/**
 * @param {string|number} tokenId
 * @param {string} walletAddr
 */
export async function verifyCanEdit(tokenId, walletAddr) {
  const proofResult = await buildWalletProof(tokenId, walletAddr);
  if (!proofResult) {
    const owner = await isOwner(tokenId);
    if (owner) {
      throw new Error(
        "Token owner is not in the current editor list. Add this wallet as an editor in the Team panel, or update the smart contract to allow owner bypass."
      );
    }
    throw new Error("Not an authorized editor");
  }
}

/**
 * Republish a collection manifest CID for an existing token, producing a
 * Merkle editor proof for the current wallet.
 * Returns the transaction hash.
 */
/**
 * @param {string|number} tokenId
 * @param {string} collectionCid
 * @param {string} walletAddr
 */
export async function republishCollection(tokenId, collectionCid, walletAddr) {
  const proofResult = await buildWalletProof(tokenId, walletAddr);
  if (!proofResult) {
    const owner = await isOwner(tokenId);
    if (owner) {
      throw new Error(
        "Token owner is not in the current editor list. Add this wallet as an editor in the Team panel, or update the smart contract to allow owner bypass."
      );
    }
    throw new Error("Not an authorized editor");
  }
  const txHash = await wallet.updateAssetURI(tokenId, collectionCid, proofResult.proof);
  if (!txHash) throw new Error("Republish transaction failed");
  return txHash;
}

/**
 * Build the initial editor list, Merkle root, and on-chain URI for a brand
 * new token. Persists the editor list to IPFS and localStorage.
 * Returns { editorList, editorRoot, editorListUri }.
 */
/**
 * @param {string|number} tokenId
 * @param {string} walletAddr
 */
export async function prepareInitialEditors(tokenId, walletAddr) {
  const editorList = [{ address: walletAddr, role: CollaboratorRole.Editor }];
  const editorRoot = computeRoot(editorList, tokenId, 1);
  const editorListUri =
    (await writeJSONToIPFS(editorList, /** @type {any} */ (null), {
      compress: true,
      type: "editors",
      assetId: `token_${tokenId}_v1`,
    })) || "";
  saveEditorList(/** @type {string} */ (tokenId), editorList, editorListUri || null);
  return { editorList, editorRoot, editorListUri };
}

/**
 * Publish a brand new token with the given collection manifest CID.
 * Returns the transaction hash.
 */
/**
 * @param {string} collectionCid
 * @param {string|number} tokenId
 * @param {string} walletAddr
 */
export async function publishNewToken(
  collectionCid,
  tokenId,
  walletAddr
) {
  const { editorRoot, editorListUri } = await prepareInitialEditors(
    tokenId,
    walletAddr
  );
  const txHash = await wallet.publishAsset(
    collectionCid,
    tokenId,
    editorRoot,
    editorListUri
  );
  if (!txHash) throw new Error("Publish transaction failed");
  return txHash;
}
