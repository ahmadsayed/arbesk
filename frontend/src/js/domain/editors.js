// @ts-nocheck
/**
 * Domain: Editors — Merkle editor-list operations and local cache.
 *
 * Centralizes the editor list localStorage cache, Merkle root computation,
 * proof generation, and on-chain version lookup used by publish, team,
 * delete, library, and comment flows.
 */
import { SimpleMerkleTree } from "@openzeppelin/merkle-tree";
// eslint-disable-next-line no-unused-vars
import { CollaboratorRole } from "../blockchain/wallet.js";
// eslint-disable-next-line no-unused-vars
import { getActiveContract } from "../blockchain/wallet.js";
// eslint-disable-next-line no-unused-vars
import { getFromRemoteIPFS } from "../ipfs/remote-ipfs.js";

// eslint-disable-next-line no-unused-vars
const EDITOR_LIST_PREFIX = "arbesk_editor_list_";

export const MAX_EDITORS_PER_TOKEN = 5000;

function _soliditySha3(...args) {
  const W3 = window.Web3;
  if (!W3 || !W3.utils || !W3.utils.soliditySha3) {
    throw new Error("Web3.js not loaded from CDN");
  }
  return W3.utils.soliditySha3(...args);
}

export function makeLeaf(address, role, tokenId, setVersion) {
  return _soliditySha3(
    { type: "address", value: address },
    { type: "uint8", value: role },
    { type: "uint256", value: tokenId },
    { type: "uint256", value: setVersion }
  );
}

function _buildTree(leaves) {
  if (!leaves || leaves.length === 0) return null;
  return SimpleMerkleTree.of(leaves);
}

export function computeRoot(editorList, tokenId, setVersion) {
  if (!editorList || editorList.length === 0) {
    return "0x0000000000000000000000000000000000000000000000000000000000000000";
  }
  if (editorList.length > MAX_EDITORS_PER_TOKEN) {
    throw new Error(
      `Editor list has ${editorList.length} members; the maximum is ${MAX_EDITORS_PER_TOKEN}`
    );
  }
  const leaves = editorList.map((e) =>
    makeLeaf(e.address, e.role, tokenId, setVersion)
  );
  const tree = _buildTree(leaves);
  return tree.root;
}

export function getProof(editorList, targetAddress, tokenId, setVersion) {
  if (!editorList || editorList.length === 0) return null;
  const entry = editorList.find(
    (e) => e.address.toLowerCase() === targetAddress.toLowerCase()
  );
  if (!entry) return null;

  const leaves = editorList.map((e) =>
    makeLeaf(e.address, e.role, tokenId, setVersion)
  );
  const tree = _buildTree(leaves);
  const leaf = makeLeaf(targetAddress, entry.role, tokenId, setVersion);
  const proof = tree.getProof(leaf);
  return { proof, role: entry.role };
}

export function verifyProof(root, leaf, proof) {
  if (
    !root ||
    root === "0x0000000000000000000000000000000000000000000000000000000000000000"
  ) {
    return false;
  }
  return SimpleMerkleTree.verify(root, leaf, proof);
}
