// @ts-nocheck
/**
 * Merkle Editor Tree - JS library
 *
 * Builds Merkle trees and proofs compatible with OpenZeppelin's
 * MerkleProof.sol (used in ArbeskAssetBase._requireEditor).
 *
 * Uses window.Web3.utils.soliditySha3 (static, available from CDN before
 * wallet connection) for leaf hashing and @openzeppelin/merkle-tree for
 * tree construction/proof generation.
 */

import { SimpleMerkleTree } from "@openzeppelin/merkle-tree";

/**
 * Client-side safety cap mirroring the on-chain MAX_EDITORS_PER_TOKEN
 * constant. The Merkle design keeps proof cost O(log n) at any size, so this
 * is not a security boundary — it guards against runaway lists that would
 * hang the browser during tree building or bloat the IPFS editor document.
 * Enforced at root-computation time (publish/update paths); proof generation
 * for existing lists is intentionally NOT capped, so members of an
 * oversized-but-live set can still act (burn, comment, republish). Note that
 * editor-set mutations on such a set (including removals that still leave it
 * above the cap) will fail the cap check — proof-only operations remain the
 * escape path.
 */
export const MAX_EDITORS_PER_TOKEN = 5000;

function _soliditySha3(...args) {
  const W3 = window.Web3;
  if (!W3 || !W3.utils || !W3.utils.soliditySha3) {
    throw new Error("Web3.js not loaded from CDN");
  }
  return W3.utils.soliditySha3(...args);
}

/**
 * Build a leaf hash matching ArbeskAssetBase._requireEditor.
 *
 * @param {string}  address    - Ethereum address (0x...)
 * @param {number}  role       - CollaboratorRole enum (0=None, 1=Viewer, 2=Editor)
 * @param {number|string|BigInt} tokenId
 * @param {number|string|BigInt} setVersion
 * @returns {string} bytes32 hex string
 */
export function makeLeaf(address, role, tokenId, setVersion) {
  return _soliditySha3(
    { type: "address", value: address },
    { type: "uint8", value: role },
    { type: "uint256", value: tokenId },
    { type: "uint256", value: setVersion }
  );
}

/**
 * Build a SimpleMerkleTree from a list of editor leaves.
 *
 * @param {string[]} leaves - Array of bytes32 hex leaf hashes
 * @returns {SimpleMerkleTree|null}
 */
function buildTree(leaves) {
  if (!leaves || leaves.length === 0) return null;
  return SimpleMerkleTree.of(leaves);
}

/**
 * Compute the Merkle root for an editor list.
 *
 * @param {Array<{address: string, role: number}>} editorList
 * @param {number|string|BigInt} tokenId
 * @param {number|string|BigInt} setVersion
 * @returns {string} bytes32 hex root, or zero bytes for an empty list
 */
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
  const tree = buildTree(leaves);
  return tree.root;
}

/**
 * Build a Merkle proof for a target editor.
 *
 * @param {Array<{address: string, role: number}>} editorList
 * @param {string} targetAddress
 * @param {number|string|BigInt} tokenId
 * @param {number|string|BigInt} setVersion
 * @returns {{proof: string[], role: number}|null}
 */
export function getProof(editorList, targetAddress, tokenId, setVersion) {
  if (!editorList || editorList.length === 0) return null;
  const entry = editorList.find(
    (e) => e.address.toLowerCase() === targetAddress.toLowerCase()
  );
  if (!entry) return null;

  const leaves = editorList.map((e) =>
    makeLeaf(e.address, e.role, tokenId, setVersion)
  );
  const tree = buildTree(leaves);
  const leaf = makeLeaf(targetAddress, entry.role, tokenId, setVersion);
  const proof = tree.getProof(leaf);
  return { proof, role: entry.role };
}

/**
 * Verify a Merkle proof against a root and leaf.
 *
 * @param {string} root   - bytes32 hex root
 * @param {string} leaf   - bytes32 hex leaf
 * @param {string[]} proof - array of bytes32 hex sibling hashes
 * @returns {boolean}
 */
export function verifyProof(root, leaf, proof) {
  if (!root || root === "0x0000000000000000000000000000000000000000000000000000000000000000") {
    return false;
  }
  return SimpleMerkleTree.verify(root, leaf, proof);
}
