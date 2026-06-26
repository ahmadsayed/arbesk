/**
 * Editor / collaborator helpers for publish and republish.
 *
 * Wraps Merkle editor-list operations: authorization checks, proof generation,
 * and persistence of the initial editor list for a new token.
 */

import { computeRoot, getProof } from "../../gltf/merkle-editors.js";
import {
  CollaboratorRole,
  publishAsset,
  updateAssetURI,
} from "../../blockchain/wallet.js";
import {
  fetchEditors as fetchEditorsFromTeam,
  getEditorSetVersion,
  saveEditorListLocally,
} from "../team.js";
import { writeJSONToIPFS } from "../../ipfs/write-to-ipfs.js";

/**
 * Throw if the connected wallet is not an authorized editor of the token.
 */
export async function verifyCanEdit(tokenId, walletAddr) {
  const editorList = await fetchEditorsFromTeam(tokenId);
  const currentVersion = await getEditorSetVersion(tokenId);
  const proofResult = getProof(editorList, walletAddr, tokenId, currentVersion);
  if (!proofResult) {
    throw new Error("Not an authorized editor");
  }
}

/**
 * Republish a collection manifest CID for an existing token, producing a
 * Merkle editor proof for the current wallet.
 * Returns the transaction hash.
 */
export async function republishCollection(tokenId, collectionCid, walletAddr) {
  let editorList = await fetchEditorsFromTeam(tokenId);
  // When localStorage is empty (fresh browser context or E2E isolation),
  // fall back to a default editor list with the current wallet as Editor.
  if (!editorList || editorList.length === 0) {
    editorList = [{ address: walletAddr, role: CollaboratorRole.Editor }];
  }
  const currentVersion = await getEditorSetVersion(tokenId);
  const proofResult = getProof(editorList, walletAddr, tokenId, currentVersion);
  if (!proofResult) throw new Error("Not an authorized editor");
  const txHash = await updateAssetURI(tokenId, collectionCid, proofResult.proof);
  if (!txHash) throw new Error("Republish transaction failed");
  return txHash;
}

/**
 * Build the initial editor list, Merkle root, and on-chain URI for a brand
 * new token. Persists the editor list to IPFS and localStorage.
 * Returns { editorList, editorRoot, editorListUri }.
 */
export async function prepareInitialEditors(tokenId, walletAddr) {
  const editorList = [{ address: walletAddr, role: CollaboratorRole.Editor }];
  const editorRoot = computeRoot(editorList, tokenId, 1);
  const editorListUri =
    (await writeJSONToIPFS(editorList, null, {
      compress: true,
      type: "editors",
      assetId: `token_${tokenId}_v1`,
    })) || "";
  saveEditorListLocally(tokenId, editorList, editorListUri || null);
  return { editorList, editorRoot, editorListUri };
}

/**
 * Publish a brand new token with the given collection manifest CID.
 * Returns the transaction hash.
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
  const txHash = await publishAsset(
    collectionCid,
    tokenId,
    editorRoot,
    editorListUri
  );
  if (!txHash) throw new Error("Publish transaction failed");
  return txHash;
}
