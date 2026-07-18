/**
 * Merkle Editor Tree - Node backend version
 *
 * Leaf encoding and proof verification compatible with
 * ArbeskAssetBase._requireEditor, using OpenZeppelin's reference Merkle-tree
 * implementation. Root/proof construction happens client-side
 * (frontend/src/js/gltf/merkle-editors.js); the backend only verifies.
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
