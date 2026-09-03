/**
 * Editor / collaborator helpers for publish and republish.
 */

import { computeRoot, getProof, makeLeaf } from "@arbesk/asset-core/formats/gltf/merkle-editors.js";
import * as wallet from "../../blockchain/wallet.ts";
import { CollaboratorRole } from "../../blockchain/wallet.ts";
import {
  loadEditorList,
  saveEditorList,
  getEditorSetVersion,
} from "@arbesk/asset-core/domain/editors.js";
import { isOwner } from "../team.ts";
import { writeJSONToIPFS } from "../../ipfs/write-to-ipfs.ts";

async function getEditorRoot(tokenId: string | number) {
  if (!wallet.contract) return null;
  try {
    return await wallet.contract.read.editorRoot([BigInt(tokenId)]);
  } catch (err) {
    console.warn("[EDITOR-PUBLISH] failed to read editorRoot:", (err as Error).message);
    return null;
  }
}

/**
 * Build a proof for the current wallet against the current editor set.
 * @remarks Falls back to a single-editor owner proof when the editor list
 *   cannot be fetched but the on-chain root proves the owner is the only
 *   editor, keeping existing tokens editable without changing the contract.
 */
async function buildWalletProof(tokenId: string | number, walletAddr: string) {
  // Version and editor list are independent; resolve them in parallel.
  const tokenIdStr = (tokenId as string);
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
 * Builds the wallet's Merkle editor proof for the token, or throws.
 * @throws {Error} authorization error when the wallet is not an editor; the
 *   message is specific when the owner is missing from the editor list.
 */
async function requireEditorProof(tokenId: string | number, walletAddr: string) {
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
  return proofResult;
}

/**
 * @throws {Error} when the connected wallet is not an authorized editor of the
 *   token.
 */
export async function verifyCanEdit(tokenId: string | number, walletAddr: string) {
  await requireEditorProof(tokenId, walletAddr);
}

/**
 * Republishes a collection manifest CID for an existing token.
 * @returns the transaction hash
 */
export async function republishCollection(
  tokenId: string | number,
  collectionCid: string,
  walletAddr: string
) {
  const proofResult = await requireEditorProof(tokenId, walletAddr);
  const txHash = await wallet.updateAssetURI(tokenId, collectionCid, proofResult.proof);
  if (!txHash) throw new Error("Republish transaction failed");
  return txHash;
}

/**
 * Builds the initial editor list, Merkle root, and on-chain URI for a new token.
 * @returns { editorList, editorRoot, editorListUri }
 */
export async function prepareInitialEditors(
  tokenId: string | number,
  walletAddr: string
) {
  const editorList = [{ address: walletAddr, role: CollaboratorRole.Editor }];
  const editorRoot = computeRoot(editorList, tokenId, 1);
  const editorListUri =
    (await writeJSONToIPFS(editorList, (null as any), {
      compress: true,
      type: "editors",
      assetId: `token_${tokenId}_v1`,
    })) || "";
  saveEditorList((tokenId as string), editorList, editorListUri || null);
  return { editorList, editorRoot, editorListUri };
}

/**
 * Publishes a brand new token with the given collection manifest CID.
 * @returns the transaction hash
 */
export async function publishNewToken(
  collectionCid: string,
  tokenId: string | number,
  walletAddr: string
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
