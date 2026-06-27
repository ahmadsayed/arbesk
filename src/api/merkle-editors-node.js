/**
 * Merkle Editor Tree - Node backend version
 *
 * Builds and verifies Merkle proofs compatible with ArbeskAssetBase._requireEditor
 * using OpenZeppelin's reference Merkle-tree implementation.
 */

import { SimpleMerkleTree } from "@openzeppelin/merkle-tree";
import { soliditySha3 } from "web3-utils";

/**
 * Build a leaf hash matching ArbeskAssetBase._requireEditor.
 *
 * @param {string} address    - Ethereum address (0x...)
 * @param {number} role       - CollaboratorRole enum (1=Viewer, 2=Editor)
 * @param {string|number|BigInt} tokenId
 * @param {string|number|BigInt} setVersion
 * @returns {string} bytes32 hex string
 */
export function makeLeaf(address, role, tokenId, setVersion) {
  return /** @type {string} */ (
    soliditySha3(
      { type: "address", value: address },
      { type: "uint8", value: role },
      { type: "uint256", value: tokenId.toString() },
      { type: "uint256", value: setVersion.toString() },
    )
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
 * @param {string|number|BigInt} tokenId
 * @param {string|number|BigInt} setVersion
 * @returns {string} bytes32 hex root, or zero bytes for an empty list
 */
export function computeRoot(editorList, tokenId, setVersion) {
  if (!editorList || editorList.length === 0) {
    return "0x0000000000000000000000000000000000000000000000000000000000000000";
  }
  const leaves = editorList.map((e) =>
    makeLeaf(e.address, e.role, tokenId, setVersion),
  );
  const tree = /** @type {import("@openzeppelin/merkle-tree").SimpleMerkleTree} */ (
    buildTree(leaves)
  );
  return tree.root;
}

/**
 * Build a Merkle proof for a target editor.
 *
 * @param {Array<{address: string, role: number}>} editorList
 * @param {string} targetAddress
 * @param {string|number|BigInt} tokenId
 * @param {string|number|BigInt} setVersion
 * @returns {{proof: string[], role: number}|null}
 */
export function getProof(editorList, targetAddress, tokenId, setVersion) {
  if (!editorList || editorList.length === 0) return null;
  const entry = editorList.find(
    (e) => e.address.toLowerCase() === targetAddress.toLowerCase(),
  );
  if (!entry) return null;

  const leaves = editorList.map((e) =>
    makeLeaf(e.address, e.role, tokenId, setVersion),
  );
  const tree = /** @type {import("@openzeppelin/merkle-tree").SimpleMerkleTree} */ (
    buildTree(leaves)
  );
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
